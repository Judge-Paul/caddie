import {
  DOMAINS,
  DOMAIN_LABELS,
  FAMILY_LABELS,
  ROLE_FAMILIES,
  SENIORITY_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
  emptyClassification,
  type Importance,
  type JdClassification,
} from '../../shared/jd-classification'
import { detectRequirements, type DetectedRequirement } from '@/lib/analyze'
import { runJev, type JevQuestion } from '../cloudflare'
import type { ServerConfig } from '../env'
import type { ProviderResult } from './types'

/** JEV's state window is 32k tokens; a CV-length posting fits comfortably. */
const MAX_STATE_CHARS = 24_000
const MAX_CANDIDATES = 40

const EMPLOYMENT_LABELS: Record<string, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
}

type CandidateGroup = {
  members: DetectedRequirement[]
}

/**
 * Alternatives are a lexical signal, not a judgement call: two detected terms
 * joined only by "or" (or "/") are one either-or requirement. Using the text
 * keeps that grouping explainable and free.
 */
function groupCandidates(text: string, candidates: DetectedRequirement[]) {
  const groups: CandidateGroup[] = []
  let current: CandidateGroup | null = null

  for (const candidate of candidates) {
    const previous = current?.members[current.members.length - 1]

    if (previous) {
      const gap = text
        .slice(previous.end, candidate.start)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')

      const isAlternative =
        gap.length <= 24 &&
        ['or', '/', 'and/or', ', or', 'or even', 'or equivalent', 'or similar'].includes(gap)

      if (isAlternative) {
        current!.members.push(candidate)
        continue
      }
    }

    current = { members: [candidate] }
    groups.push(current)
  }

  return groups
}

function titleFromPosting(text: string) {
  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean)

  if (!line) return ''

  return line
    .replace(/^(job title|role|position)\s*[:\-–]\s*/i, '')
    .split(/\s+(?:—|–|\||@|\bat\b)\s+/i)[0]
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    .slice(0, 120)
}

function choice(
  instructions: string,
  criteria: Record<string, string>,
): JevQuestion {
  return { type: 'choice', instructions, criteria }
}

function buildQuestions(groups: CandidateGroup[]) {
  const questions: Record<string, JevQuestion> = {
    role_family: choice(
      'What kind of role is this posting hiring for? Judge the work described, not only the title.',
      Object.fromEntries(ROLE_FAMILIES.map((family) => [family, FAMILY_LABELS[family]])) as Record<
        string,
        string
      >,
    ),
    role_seniority: choice(
      'What seniority does this posting hire for? Use the title and the years of experience it asks for.',
      {
        intern: 'An internship or placement',
        junior: 'Up to two years of experience',
        mid: 'Roughly two to four years of experience',
        senior: 'Roughly five to eight years, or "senior" in the title',
        staff: 'Staff level: several teams or a whole domain',
        principal: 'Principal level: organisation-wide technical ownership',
        lead: 'Leads a team or the function',
        director: 'Directs a department or function',
        unspecified: 'The posting does not say',
      },
    ),
    work_mode: choice(
      'What working arrangement does the posting offer?',
      Object.fromEntries(WORK_MODES.map((mode) => [mode, WORK_MODE_LABELS[mode]])) as Record<
        string,
        string
      >,
    ),
    employment: choice(
      'What employment type does the posting offer?',
      {
        'full-time': 'A permanent full-time role',
        'part-time': 'Part-time hours',
        contract: 'A fixed-term contract or freelance engagement',
        internship: 'An internship',
        unspecified: 'Not stated',
      },
    ),
    domain: choice(
      "Which industry is the employer's product in?",
      Object.fromEntries(DOMAINS.map((domain) => [domain, DOMAIN_LABELS[domain]])) as Record<
        string,
        string
      >,
    ),
  }

  groups.forEach((group, index) => {
    const mentioned = group.members.map((member) => `"${member.label}"`).join(' and ')

    questions[`req_${index}`] = choice(
      `The posting mentions ${mentioned}. Is ${group.members.length > 1 ? 'this' : 'it'} required, optional, or not actually asked for?`,
      {
        must: 'Required or clearly expected of the candidate.',
        nice: 'Optional: a bonus, plus, nice-to-have, or exposure that is not required.',
        absent: 'Mentioned only in passing, or explicitly something the employer does not require.',
      },
    )
  })

  return questions
}

function importanceFrom(value: string | undefined): Importance | null {
  if (value === 'must') return 'must'
  if (value === 'nice') return 'nice'
  return null
}

function choiceOf(
  answers: Awaited<ReturnType<typeof runJev>>['answers'],
  question: string,
) {
  const answer = answers[question]
  return answer && answer.type === 'choice' ? answer.choice : undefined
}

function pickOption<T extends readonly string[]>(
  options: T,
  value: string | undefined,
  fallback: T[number],
): T[number] {
  return value && (options as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback
}

/**
 * JEV cannot generate text: it only answers typed questions about a state. So
 * the posting is first reduced to candidate requirements with the deterministic
 * lexicon, and the model decides what each one means. Everything it cannot
 * produce (responsibilities, summary, salary) is left empty rather than faked.
 */
export async function classifyWithJev(
  jd: string,
  config: ServerConfig,
): Promise<ProviderResult> {
  const started = performance.now()
  const text = jd.trim().slice(0, MAX_STATE_CHARS)

  const candidates = detectRequirements(text).slice(0, MAX_CANDIDATES)
  if (candidates.length === 0) {
    throw new Error('No requirements were detected in this posting, so JEV has nothing to judge.')
  }

  const groups = groupCandidates(text, candidates)
  const questions = buildQuestions(groups)
  const result = await runJev(config, { state: text, questions })

  if (Object.keys(result.answers).length === 0) {
    throw new Error('JEV returned no answers for this posting.')
  }

  const data: JdClassification = emptyClassification()
  data.role.title = titleFromPosting(text)
  data.role.family = pickOption(ROLE_FAMILIES, choiceOf(result.answers, 'role_family'), 'other')
  data.role.seniority = pickOption(
    Object.keys(SENIORITY_LABELS) as (keyof typeof SENIORITY_LABELS)[],
    choiceOf(result.answers, 'role_seniority'),
    'unspecified',
  )
  data.work.mode = pickOption(WORK_MODES, choiceOf(result.answers, 'work_mode'), 'unspecified')
  data.work.employment =
    EMPLOYMENT_LABELS[choiceOf(result.answers, 'employment') ?? ''] ?? null
  data.company.domain = pickOption(DOMAINS, choiceOf(result.answers, 'domain'), 'unspecified')

  const keywords = new Set<string>()

  groups.forEach((group, index) => {
    const importance = importanceFrom(choiceOf(result.answers, `req_${index}`))
    if (!importance) return

    const items = group.members.map((member) => member.label)
    for (const item of items) keywords.add(item)

    data.requirements.push({
      label: items.join(' or '),
      category: 'other',
      importance,
      combination: items.length > 1 ? 'any' : 'all',
      items,
      years: null,
      evidence: text.slice(group.members[0].start, group.members[group.members.length - 1].end),
    })
  })

  data.keywords = [...keywords].slice(0, 15)

  if (data.requirements.length === 0) {
    throw new Error('JEV judged none of the detected requirements as required or optional.')
  }

  return {
    data,
    modelId: config.jevModel,
    latencyMs: Math.round(performance.now() - started),
    attempts: 1,
    usage: result.usage,
  }
}

/** Exposed for the eval so it can explain what the model was asked. */
export { buildQuestions, groupCandidates }
export type { CandidateGroup }
