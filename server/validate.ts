import { NOT_JD_MESSAGE, guardJd } from '../shared/jd-guard'
import { runClef } from './cloudflare'
import type { ServerConfig } from './env'

const MAX_VALIDATION_CHARS = 8_000

export type ValidationResult = {
  allowed: boolean
  reason: string
  source: 'rules' | 'model'
}

/**
 * Cheap rules first. Only the uncertain middle goes to Clef, so an obvious CV or
 * link costs nothing and a valid posting never pays for an extra model call.
 */
export async function validateJd(
  text: string,
  config: ServerConfig,
): Promise<ValidationResult> {
  const guard = guardJd(text)

  if (guard.verdict === 'jd') {
    return { allowed: true, reason: '', source: 'rules' }
  }

  if (guard.verdict === 'not-jd') {
    return { allowed: false, reason: guard.message || NOT_JD_MESSAGE, source: 'rules' }
  }

  try {
    const result = await runClef(config, {
      state: text.slice(0, MAX_VALIDATION_CHARS),
      questions: {
        kind: {
          type: 'choice',
          instructions: 'What kind of text is this?',
          criteria: {
            job_description:
              'A posting advertising a role, its responsibilities, requirements or benefits.',
            cv: 'A CV or resume listing a person’s own experience, education and skills.',
            cover_letter: 'A message from a candidate applying for a job.',
            other:
              'Anything else, such as a chat message, an article, code, a link or a product page.',
          },
        },
      },
    })

    const answer = result.answers.kind

    if (answer?.type === 'choice') {
      if (answer.choice === 'job_description') {
        return { allowed: true, reason: '', source: 'model' }
      }

      const jobProbability = answer.probabilities?.job_description ?? 0
      const confidence = answer.confidence ?? 1 - jobProbability

      if (confidence >= 0.5) {
        return { allowed: false, reason: NOT_JD_MESSAGE, source: 'model' }
      }
    }
  } catch {
    // Clef is a guardrail, not a dependency. If it is unavailable, let the
    // normal classifier decide rather than blocking a valid posting.
  }

  return { allowed: true, reason: '', source: 'rules' }
}
