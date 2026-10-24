const EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi

const ROLE_LOCAL = /^(jobs?|careers?|hiring|recruit(?:ing|ment)?|talent|apply|applications?)(?:[._+-]|$)/i
const GENERAL_LOCAL = /^(people|hr)(?:[._+-]|$)/i
const CONTEXT_WORDS =
  /\b(apply|application|send|email|resume|cv|cover letter|contact|careers?|jobs?|hiring|recruit(?:ing|ment)?|talent)\b/i
const CONTEXT_STRONG = /\b(send|submit|email|apply)\b[^.\n]{0,100}\b(to|at)\b/i
const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|icloud|proton|aol)\.[a-z.]+$/i

function uniqueEmails(text: string) {
  const seen = new Set<string>()
  const emails: string[] = []

  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const email = match[0].toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }

  return emails
}

function scoreEmail(email: string, text: string, index: number) {
  const [local, domain = ''] = email.split('@')
  const window = text.slice(Math.max(0, index - 140), Math.min(text.length, index + 140))
  let score = 0

  if (ROLE_LOCAL.test(local)) score += 5
  if (GENERAL_LOCAL.test(local)) score += 2
  if (CONTEXT_STRONG.test(window)) score += 4
  if (CONTEXT_WORDS.test(window)) score += 2
  if (FREE_MAIL.test(domain)) score -= 4
  if (/(^|\.)(careers?|jobs?|hiring)\./i.test(domain)) score += 3

  return score
}

export function findApplicationEmail(text: string) {
  const emails = uniqueEmails(text)
  if (emails.length === 0) return null

  const scored = emails.map((email) => {
    const index = text.toLowerCase().indexOf(email)
    return { email, score: scoreEmail(email, text, index) }
  })

  scored.sort((left, right) => right.score - left.score)
  return scored[0]?.score >= 5 ? scored[0].email : null
}
