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
import { buildComposeEvidence, type ComposeEvidence } from './compose-evidence'
import {
  draftMessages,
  type ComposeStrategy,
} from './compose-draft-prompt'
import {
  strategyMessages,
  type ComposeAngle,
} from './compose-strategy-prompt'
import { readConfig } from './env'
import { extractPdfText } from './cv/text'

const MAX_ATTEMPTS = 2
const ANGLES: ComposeAngle[] = [
  'direct-match',
  'problem-solution',
  'craft',
  'transferable',
  'company',
]

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n/g, '\n').trim().slice(0, max)
}

function stringList(value: unknown, max: number, maxLength: number) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    const item = text(entry, maxLength)
    if (!item || seen.has(item.toLowerCase())) continue
    seen.add(item.toLowerCase())
    result.push(item)
    if (result.length >= max) break
  }
  return result
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

function parseStrategy(value: unknown, evidence: ComposeEvidence[]): ComposeStrategy | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const angle = text(record.angle, 40) as ComposeAngle
  const heroId = text(record.heroId, 80)
  const supportId = text(record.supportId, 80)
  const available = new Set(evidence.map((item) => item.id))

  if (!ANGLES.includes(angle)) return null
  if (!available.has(heroId)) return null
  if (supportId && (!available.has(supportId) || supportId === heroId)) return null

  const strategy: ComposeStrategy = {
    angle,
    thesis: text(record.thesis, 500),
    hook: text(record.hook, 500),
    companyInsight: text(record.companyInsight, 500),
    heroId,
    supportId: supportId || null,
    reason: text(record.reason, 500),
    avoid: stringList(record.avoid, 8, 160),
  }

  if (!strategy.thesis || !strategy.hook || !strategy.companyInsight) return null
  return strategy
}

function genericOpening(value: string) {
  const start = value.toLowerCase()
  return (
    /i am writing (to apply|because|in response)/.test(start) ||
    /i am excited to apply/.test(start) ||
    /i am passionate about (applying|the opportunity)/.test(start) ||
    /i am particularly interested/.test(start) ||
    /aligns perfectly/.test(start) ||
    /i am confident/.test(start) ||
    /i believe i would be a (great|strong) fit/.test(start)
  )
}

type ParsedDraft = { coverLetter: string } | { subject: string; body: string }

function parseDraft(
  value: unknown,
  kind: ComposeKind,
): { draft: ParsedDraft | null; reason: string } {
  if (!value || typeof value !== 'object') {
    return { draft: null, reason: 'the reply was not a JSON object' }
  }
  const record = value as Record<string, unknown>

  if (kind === 'cover-letter') {
    const coverLetter = text(record.coverLetter, 8_000)
    const words = coverLetter.split(/\s+/).filter(Boolean).length
    if (words < 180) return { draft: null, reason: `the draft was only ${words} words` }
    if (words > 400) return { draft: null, reason: 'the draft was too long' }
    if (genericOpening(coverLetter)) {
      return { draft: null, reason: 'the draft used a generic application opening' }
    }
    return { draft: { coverLetter }, reason: '' }
  }

  const subject = text(record.subject, 120).replace(/\s+/g, ' ')
  const body = text(record.body, 6_000)
  const words = body.split(/\s+/).filter(Boolean).length
  if (!subject) return { draft: null, reason: 'the email had no subject' }
  if (words < 60 || words > 220) {
    return { draft: null, reason: `the email body was ${words} words` }
  }
  if (/\b(cv|resume) is attached\b/i.test(body)) {
    return { draft: null, reason: 'the email claimed an attachment' }
  }
  return { draft: { subject, body }, reason: '' }
}

async function chooseStrategy(
  config: ReturnType<typeof readConfig>,
  kind: ComposeKind,
  evidence: ComposeEvidence[],
  jd: NonNullable<Awaited<ReturnType<typeof getApplication>>['classification']>['data'],
) {
  const messages = strategyMessages({ kind, jd, evidence })

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
                  'That was not a usable strategy. Use one of the allowed angles, use real evidence IDs from the list, and return only the requested JSON object.',
              },
            ],
      maxTokens: 500,
      temperature: 0.2,
      timeoutMs: 60_000,
    })

    try {
      const strategy = parseStrategy(extractJson(result.text), evidence)
      if (strategy) return strategy
    } catch {
      // retry
    }
  }

  throw new AccountError(
    'Caddie could not choose a grounded angle for this application. Try again.',
    502,
  )
}

async function writeDraft(
  config: ReturnType<typeof readConfig>,
  kind: ComposeKind,
  strategy: ComposeStrategy,
  evidence: ComposeEvidence[],
  jd: NonNullable<Awaited<ReturnType<typeof getApplication>>['classification']>['data'],
  candidateName: string | null,
) {
  const messages = draftMessages({
    kind,
    jd,
    strategy,
    evidence,
    candidateName,
  })

  let reply = ''
  let lastReason = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await runChat(config, {
      model: config.gemmaModel,
      messages:
        attempt === 1
          ? messages
          : [
              ...messages,
              { role: 'assistant', content: reply.slice(0, 3_000) },
              {
                role: 'user',
                content: `That draft was not usable: ${lastReason}. Keep the strategy hook, expand the selected hero evidence into concrete context, action and outcome, and ${kind === 'cover-letter' ? 'write 200–280 words without generic filler' : 'write a 90–140 word email'}. Use only the selected evidence. Return only the requested JSON object.`,
              },
            ],
      maxTokens: 1_100,
      temperature: 0.2,
      timeoutMs: 90_000,
    })
    reply = result.text

    try {
      const parsed = parseDraft(extractJson(result.text), kind)
      if (parsed.draft) return parsed.draft
      lastReason = parsed.reason
    } catch {
      lastReason = 'the reply was not usable JSON'
    }
  }

  throw new AccountError(
    'Caddie could not write a clean draft from that angle. Try again.',
    502,
  )
}

export async function composeApplication(
  userId: string,
  id: string,
  kind: ComposeKind,
  applicantName: string | null = null,
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

  const jd = application.classification.data
  const stories = relevantStories(
    await listStories(userId),
    jd.requirements.flatMap((item) => [item.label, ...item.match, ...item.items]),
  )
  const evidence = buildComposeEvidence(cvText, stories, jd)
  if (evidence.length === 0) {
    throw new AccountError('No usable evidence was found in the CV for this posting.', 422)
  }

  const config = readConfig()
  const strategy = await chooseStrategy(config, kind, evidence, jd)
  const draft = await writeDraft(
    config,
    kind,
    strategy,
    evidence,
    jd,
    applicantName,
  )

  if (kind === 'cover-letter' && 'coverLetter' in draft) {
    return updateApplication(userId, id, {
      coverLetter: { text: draft.coverLetter, updatedAt: '' },
    })
  }

  if (kind === 'email' && 'subject' in draft) {
    return updateApplication(userId, id, {
      emailDraft: {
        to: application.emailDraft?.to ?? '',
        subject: draft.subject,
        body: draft.body,
        updatedAt: '',
      },
    })
  }

  throw new AccountError('The draft did not match the requested format.', 502)
}
