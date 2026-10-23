/**
 * Cheap pre-check for pasted text. It lives in `shared/` so the browser can
 * block obvious non-postings instantly and the server can enforce the same rule.
 * Ambiguous text goes to Clef on the server; Gemma is never asked to classify
 * a link, a CV or a cover letter.
 */

export const NOT_JD_MESSAGE =
  'That does not look like a job description. Paste the posting text, not a link, your CV, or a cover letter.'

export type JdVerdict = 'jd' | 'unclear' | 'not-jd'

export type JdGuardResult = {
  verdict: JdVerdict
  score: number
  message: string
  reasons: string[]
}

const HEADINGS: [string, RegExp][] = [
  ['about', /^(about|overview|about us|about the role|about the team|the company)\b/],
  ['role', /^(engineering|design|product|data|the role|the job|role|position|opportunity)\b/],
  ['duties', /^(what you'?ll (do|own)|responsibilities|duties|day to day|your impact)\b/],
  [
    'requirements',
    /^(requirements|qualifications|who you are|what we'?re looking for|we'?re looking for|you have|must have|skills|experience)\b/,
  ],
  ['nice', /^(nice to have|bonus|preferred|plus)\b/],
  ['benefits', /^(benefits|what you get|perks|compensation|salary|we offer)\b/],
  ['culture', /^(how we work|our team|culture|values|life at)\b/],
  ['stack', /^(tech stack|stack|tools|technologies)\b/],
]

const SECTION_PHRASES = [
  'about the role',
  'about us',
  'responsibilities',
  'requirements',
  'qualifications',
  'what you will do',
  "what you'll do",
  'what you will own',
  "what you'll own",
  'who you are',
  "what we're looking for",
  'nice to have',
  'benefits',
  'how we work',
  'tech stack',
]

const ROLE_WORDS =
  /\b(engineer|developer|designer|manager|analyst|scientist|architect|lead|director|intern|researcher|specialist|consultant|programmer)\b/i

const EMPLOYMENT =
  /\b(full[- ]time|part[- ]time|contract|permanent|remote|hybrid|on[- ]?site|salary|equity|stock options|per year|per annum|€|\$|£)\b/i

const SKILLS =
  /\b(react native|react|typescript|javascript|python|java|golang|rust|swift|kotlin|sql|postgres|aws|gcp|azure|docker|kubernetes|figma|node|graphql|next\.js|vue|angular|terraform|redis|kafka|llm|ai agents|ai|ios|android|hdr|4k|video|camera|streaming)\b/gi

const COVER_LETTER =
  /\b(dear (hiring manager|recruiter|team|sir|madam)|i am writing to apply|i'm writing to apply|i am interested in the|please find (attached|my)|thank you for your consideration)\b/i

const CHAT_START = /^(hi|hello|hey|can you|could you|what is|how do|why (is|does)|please help)\b/i

const CODE =
  /```|^\s*(?:npm|yarn|pnpm|pip|git)\s+install\b|^\s*(?:import|const|function|class|def)\s/m

const MARKUP = /<html|<!doctype|<\/[a-z]+>/i

const RECIPE = /\b(ingredients|preheat|tablespoons?|serves \d)\b/i

const ACADEMIC = /\b(abstract|methodology|references|et al\.)\b/i

function count(text: string, pattern: RegExp) {
  return (text.match(pattern) ?? []).length
}

function messageFor(reasons: string[]) {
  const joined = reasons.join(' ')

  if (joined.includes('too short')) {
    return 'That is too short to be a job description. Paste the full posting.'
  }
  if (joined.includes('link')) {
    return 'That is a link. Paste the posting text instead.'
  }
  if (joined.includes('CV')) {
    return 'That looks like a CV. Paste the job posting instead.'
  }
  if (joined.includes('cover letter')) {
    return 'That looks like a cover letter. Paste the job posting instead.'
  }
  if (joined.includes('message')) {
    return 'That looks like a message, not a job posting. Paste the posting text instead.'
  }
  if (joined.includes('code') || joined.includes('markup')) {
    return 'That looks like code or markup. Paste the job posting text instead.'
  }
  if (joined.includes('recipe')) {
    return 'That does not look like a job posting. Paste the posting text instead.'
  }

  return NOT_JD_MESSAGE
}

export function guardJd(input: string): JdGuardResult {
  const text = input.trim()
  const lower = text.toLowerCase()
  const words = text ? text.split(/\s+/).length : 0
  const reasons: string[] = []

  if (/^(?:https?:\/\/|www\.)\S+$/i.test(text)) {
    return {
      verdict: 'not-jd',
      score: -10,
      message: messageFor(['link']),
      reasons: ['link only'],
    }
  }

  if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(text) || /^\+?[\d\s().-]{7,}$/.test(text)) {
    return {
      verdict: 'not-jd',
      score: -10,
      message: 'That is contact details, not a job posting. Paste the posting text instead.',
      reasons: ['contact details only'],
    }
  }

  if (words < 12) {
    return {
      verdict: 'not-jd',
      score: -10,
      message: messageFor(['too short']),
      reasons: ['too short'],
    }
  }

  let score = 0

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const headingKeys = new Set<string>()
  for (const line of lines.slice(0, 120)) {
    if (line.length > 80) continue
    const heading = line
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*•]\s*/, '')
      .replace(/[:.]$/, '')
      .trim()
      .toLowerCase()

    for (const [key, pattern] of HEADINGS) {
      if (pattern.test(heading)) headingKeys.add(key)
    }
  }

  score += Math.min(5, headingKeys.size)
  if (headingKeys.size >= 2) reasons.push('has job-description headings')

  const inlineSections = SECTION_PHRASES.filter((phrase) => lower.includes(phrase)).length
  if (headingKeys.size < 2 && inlineSections >= 2) {
    score += Math.min(3, inlineSections)
    reasons.push('has job-description sections')
  }

  if (ROLE_WORDS.test(lower)) score += 2
  if (
    /\b(we(?:'re| are| is)? (?:hiring|looking for|seeking)|now hiring|join (?:us|our team))\b/i.test(
      lower,
    )
  ) {
    score += 2
  }

  const employer = count(
    lower,
    /\b(you|your|yours|we|our|ours|us|candidate|team)\b/g,
  )
  const firstPerson = count(lower, /\b(i|me|my|mine|myself)\b/g)
  const density = (employer / words) * 100

  if (density >= 2.5) score += 2
  else if (density >= 1) score += 1

  const bullets = count(text, /^\s*(?:[-*•]|\d+[.)])\s+/gm)
  if (bullets >= 3) score += 1
  if (bullets >= 6) score += 1

  const skills = new Set((lower.match(SKILLS) ?? []).map((skill) => skill.toLowerCase())).size
  if (skills >= 3) score += 2
  else if (skills >= 1) score += 1

  if (EMPLOYMENT.test(lower)) score += 1

  const title = lines.slice(0, 3).join(' ')
  if (ROLE_WORDS.test(title) || /\b(hiring|job|role|position|opportunity)\b/i.test(title)) {
    score += 1
  }

  const cvHeadingKeys = [
    'education',
    'experience',
    'projects',
    'skills',
    'languages',
    'certifications',
    'awards',
    'volunteer',
  ]
  const cvHeadings = cvHeadingKeys.filter((key) =>
    new RegExp(`\\b${key}\\b`, 'i').test(text),
  ).length
  const hasContact = /@[^\s]+\.\w+/.test(text) && /(?:\+?\d[\d\s().-]{7,}\d)/.test(text)
  const dateRanges = count(
    text,
    /\b(?:19|20)\d{2}\s*[–—-]\s*(?:(?:19|20)\d{2}|present)\b/gi,
  )

  const looksLikeCv =
    cvHeadings >= 4 ||
    (cvHeadings >= 2 && hasContact && dateRanges >= 2) ||
    (cvHeadings >= 3 && dateRanges >= 3) ||
    (hasContact && dateRanges >= 2)

  if (looksLikeCv) {
    score -= 7
    reasons.push('looks like a CV')
  } else if (firstPerson >= 3 && firstPerson > employer) {
    score -= 2
    reasons.push('written in the first person')
  }

  if (COVER_LETTER.test(lower)) {
    score -= 6
    reasons.push('reads like a cover letter')
  }

  if (CHAT_START.test(lower) && words < 80) {
    score -= 5
    reasons.push('reads like a message')
  }

  if (CODE.test(text) && count(text, /[{};]/g) > 5) {
    score -= 5
    reasons.push('looks like code')
  }

  if (/```|\b(?:npm|yarn|pnpm|pip)\s+(?:install|add)\b|\bgit\s+clone\b/i.test(text)) {
    score -= 5
    reasons.push('looks like code')
  }

  if (MARKUP.test(text)) {
    score -= 6
    reasons.push('looks like markup')
  }

  if (RECIPE.test(lower)) {
    score -= 5
    reasons.push('looks like a recipe')
  }

  if (ACADEMIC.test(lower)) {
    score -= 3
    reasons.push('looks like an article or paper')
  }

  if (score >= 6) {
    return { verdict: 'jd', score, message: '', reasons }
  }

  if (score <= 0) {
    return {
      verdict: 'not-jd',
      score,
      message: messageFor(reasons),
      reasons,
    }
  }

  return { verdict: 'unclear', score, message: '', reasons }
}
