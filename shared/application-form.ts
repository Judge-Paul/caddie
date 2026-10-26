/**
 * Finds the "apply here" form URL in a posting, the counterpart to
 * application-email.ts. Email stays the default channel; a confident form URL
 * on a supported board offers form-apply instead. Anything else (job boards,
 * unsupported systems) scores too low or reports unsupported so the caller
 * can fall back or say so honestly.
 */

export type SupportedAts = 'greenhouse' | 'lever' | 'ashby' | 'workable'
export type AtsKind = SupportedAts | 'unsupported'

export type ApplicationForm = {
  url: string
  ats: AtsKind
  /** True for the four boards v1 automates. */
  supported: boolean
}

const URL_PATTERN = /https?:\/\/[^\s)\]>"']+/gi
const BARE_HOST_PATTERN = /\b(?:www\.)?(?:boards\.greenhouse\.io|job-boards\.greenhouse\.io|greenhouse\.io|lever\.co|jobs\.ashbyhq\.com|ashbyhq\.com|jobs\.workable\.com|workable\.com)(?:\/[^\s)\]>"']*)?/gi

const CONTEXT_WORDS =
  /\b(apply|application|apply here|apply now|careers page|submit|form|resume|cv|cover letter|jobvite|brassring)\b/i
const CONTEXT_STRONG =
  /\b(apply|submit)\b[^.\n]{0,100}\b(here|below|online|form|link|button|now)\b/i

const SUPPORTED_HOSTS: { host: RegExp; ats: SupportedAts }[] = [
  { host: /(^|\.)(boards\.greenhouse\.io|job-boards\.greenhouse\.io|greenhouse\.io)$/i, ats: 'greenhouse' },
  { host: /(^|\.)lever\.co$/i, ats: 'lever' },
  { host: /(^|\.)(jobs\.ashbyhq\.com|ashbyhq\.com)$/i, ats: 'ashby' },
  { host: /(^|\.)(jobs\.workable\.com|workable\.com)$/i, ats: 'workable' },
]

const UNSUPPORTED_HOSTS = [
  /(^|\.)myworkdayjobs\.com$/i,
  /(^|\.)workday\.com$/i,
  /(^|\.)successfactors\.(com|eu)$/i,
  /(^|\.)icims\.com$/i,
  /(^|\.)taleo\.net$/i,
  /(^|\.)smartrecruiters\.com$/i,
  /(^|\.)adp\.com$/i,
  /(^|\.)ultipro\.com$/i,
  /(^|\.)bamboohr\.com$/i,
]

const AGGREGATOR_HOSTS = [
  /(^|\.)indeed\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)glassdoor\.com$/i,
  /(^|\.)ziprecruiter\.com$/i,
  /(^|\.)monster\.com$/i,
  /(^|\.)simplyhired\.com$/i,
]

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function classifyAts(url: string): AtsKind | null {
  const host = hostOf(url)
  if (!host) return null
  for (const entry of SUPPORTED_HOSTS) {
    if (entry.host.test(host)) return entry.ats
  }
  for (const pattern of UNSUPPORTED_HOSTS) {
    if (pattern.test(host)) return 'unsupported'
  }
  return null
}

function cleanUrl(raw: string) {
  return raw.replace(/[.,;:!?'"\])]+$/g, '')
}

function uniqueUrls(text: string) {
  const seen = new Set<string>()
  const urls: { url: string; index: number }[] = []

  const collect = (pattern: RegExp, prefix: string) => {
    for (const match of text.matchAll(pattern)) {
      const raw = match[0]
      const full = prefix && !/^https?:\/\//i.test(raw) ? `${prefix}${raw}` : raw
      const url = cleanUrl(full)
      const key = url.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      urls.push({ url, index: match.index ?? 0 })
    }
  }

  collect(URL_PATTERN, '')
  collect(BARE_HOST_PATTERN, 'https://')
  return urls
}

function companyTokens(company: string | null): string[] {
  if (!company) return []
  return company
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !['inc', 'ltd', 'llc', 'gmbh', 'labs', 'the'].includes(token))
}

function scoreFormUrl(
  url: string,
  text: string,
  index: number,
  company: string | null,
): number {
  const host = hostOf(url)
  if (!host) return -100
  if (AGGREGATOR_HOSTS.some((pattern) => pattern.test(host))) return -100

  const ats = classifyAts(url)
  let score = 0
  if (ats && ats !== 'unsupported') score += 5
  if (ats === 'unsupported') score += 5

  const window = text.slice(Math.max(0, index - 140), Math.min(text.length, index + 140))
  if (CONTEXT_STRONG.test(window)) score += 4
  if (CONTEXT_WORDS.test(window)) score += 2

  const lower = url.toLowerCase()
  for (const token of companyTokens(company)) {
    if (host.includes(token) || lower.includes(token)) {
      score += 3
      break
    }
  }
  if (/\b(apply|application|careers|jobs?)\b/i.test(url)) score += 1

  return score
}

export function findApplicationUrl(
  text: string,
  company: string | null = null,
): ApplicationForm | null {
  const candidates = uniqueUrls(text)
  if (candidates.length === 0) return null

  const scored = candidates.map(({ url, index }) => ({
    url,
    score: scoreFormUrl(url, text, index, company),
  }))
  scored.sort((left, right) => right.score - left.score)

  const best = scored[0]
  if (!best || best.score < 5) return null

  const ats = classifyAts(best.url)
  if (!ats) return null

  return {
    url: best.url,
    ats,
    supported: ats !== 'unsupported',
  }
}
