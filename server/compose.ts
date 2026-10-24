import type { ApplicationDetail, ComposeKind } from '../shared/account'
import type { CvStory } from '../shared/cv-fit'
import { extractJson } from '../shared/jd-classification'
import {
  AccountError,
  getApplication,
  getApplicationFile,
  listStories,
  updateApplication,
} from './account'
import { runChat } from './cloudflare'
import { composeMessages } from './compose-prompt'
import { readConfig } from './env'
import { extractPdfText } from './cv/text'

const MAX_ATTEMPTS = 2

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n/g, '\n').trim().slice(0, max)
}

function relevantStories(stories: CvStory[], terms: string[]) {
  const keys = terms.map((term) => term.toLowerCase()).filter((term) => term.length >= 3)

  return [...stories]
    .map((story) => {
      const haystack = `${story.userText} ${story.bullet ?? ''} ${story.skills.join(' ')}`.toLowerCase()
      const score = keys.reduce(
        (total, key) => (haystack.includes(key) ? total + 1 : total),
        0,
      )
      return { story, score }
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 10)
    .map((entry) => entry.story)
}

export async function composeApplication(
  userId: string,
  id: string,
  kind: ComposeKind,
): Promise<ApplicationDetail> {
  const application = await getApplication(userId, id)
  if (application.sentAt || application.completedAt) {
    throw new AccountError('This application is locked after sending or completion.', 409)
  }
  if (!application.classification) {
    throw new AccountError('Read the posting before drafting an application.', 409)
  }

  const pdf = await getApplicationFile(userId, id, 'pdf')
  const cvText = await extractPdfText(pdf.buffer)
  if (cvText.trim().length < 80) {
    throw new AccountError(
      'This CV has no selectable text, so Caddie cannot ground a draft in it.',
      422,
    )
  }

  const stories = relevantStories(
    await listStories(userId),
    application.classification.data.requirements.flatMap((item) => [
      item.label,
      ...item.match,
      ...item.items,
    ]),
  )
  const config = readConfig()
  const messages = composeMessages({
    kind,
    cvText,
    jd: application.classification.data,
    stories,
  })

  let lastError = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await runChat(config, {
      model: config.gemmaModel,
      messages:
        attempt === 1
          ? messages
          : [
              ...messages,
              {
                role: 'user',
                content:
                  'Your previous reply was not usable JSON. Return the requested JSON object only, with no prose and no code fence.',
              },
            ],
      maxTokens: 1_600,
      temperature: 0.2,
      timeoutMs: 90_000,
    })

    try {
      const parsed = extractJson(result.text) as Record<string, unknown>
      if (kind === 'cover-letter') {
        const coverLetter = text(parsed.coverLetter, 8_000)
        if (coverLetter.length < 200) throw new Error('The cover letter was too short.')
        return updateApplication(userId, id, {
          coverLetter: { text: coverLetter, updatedAt: '' },
        })
      }

      const subject = text(parsed.subject, 120).replace(/\s+/g, ' ')
      const body = text(parsed.body, 6_000)
      if (!subject || body.length < 120) {
        throw new Error('The email draft was incomplete.')
      }
      return updateApplication(userId, id, {
        emailDraft: {
          to: application.emailDraft?.to ?? '',
          subject,
          body,
          updatedAt: '',
        },
      })
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unusable draft.'
    }
  }

  console.error('[compose] model returned no usable draft', { kind, lastError })
  throw new AccountError(
    'The model did not return a usable draft. Try again in a moment.',
    502,
  )
}
