/**
 * The shape Caddie extracts from a job description.
 *
 * This module is shared by the Bun server, the browser and the eval harness, so
 * it must stay free of runtime-specific imports. The model returns loosely
 * typed JSON; `normaliseClassification` is the single place that turns it into
 * this shape, which means every provider is judged by the same contract.
 */

export const ROLE_FAMILIES = [
  'frontend',
  'backend',
  'fullstack',
  'mobile',
  'data',
  'ml',
  'devops',
  'security',
  'design',
  'product',
  'qa',
  'other',
] as const

export const SENIORITIES = [
  'intern',
  'junior',
  'mid',
  'senior',
  'staff',
  'principal',
  'lead',
  'director',
  'unspecified',
] as const

export const WORK_MODES = ['remote', 'hybrid', 'onsite', 'unspecified'] as const

export const DOMAINS = [
  'fintech',
  'health',
  'ecommerce',
  'saas',
  'marketplace',
  'education',
  'gaming',
  'media',
  'agency',
  'developer-tools',
  'logistics',
  'other',
  'unspecified',
] as const

/**
 * Sectors are multi-label. A company can be media, consumer and AI at once; the
 * single `domain` above stays as a coarse primary for scoring and compatibility.
 */
export const SECTORS = [
  'ai',
  'media',
  'consumer',
  'design',
  'productivity',
  'saas',
  'developer-tools',
  'fintech',
  'health',
  'ecommerce',
  'marketplace',
  'education',
  'gaming',
  'agency',
  'logistics',
  'other',
] as const

export const REQUIREMENT_CATEGORIES = [
  'language',
  'framework',
  'tool',
  'platform',
  'practice',
  'domain',
  'soft-skill',
  'education',
  'experience',
  'other',
] as const

export const IMPORTANCES = ['must', 'nice'] as const

/** `any` means one of the items is enough; `all` means every item is expected. */
export const COMBINATIONS = ['any', 'all'] as const

export type RoleFamily = (typeof ROLE_FAMILIES)[number]
export type Seniority = (typeof SENIORITIES)[number]
export type WorkMode = (typeof WORK_MODES)[number]
export type Domain = (typeof DOMAINS)[number]
export type Sector = (typeof SECTORS)[number]
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number]
export type Importance = (typeof IMPORTANCES)[number]
export type Combination = (typeof COMBINATIONS)[number]

export type Requirement = {
  label: string
  category: RequirementCategory
  importance: Importance
  combination: Combination
  items: string[]
  /**
   * Concrete CV-searchable evidence for this requirement. A sentence like
   * "Shipped mobile apps people use every day" becomes ["iOS", "Android",
   * "React Native", "mobile app"]; any one of them can satisfy it.
   */
  match: string[]
  years: number | null
  evidence: string
}

/**
 * Relevant experience the posting implies but does not demand. Shown in amber
 * as "worth showing", never scored and never red.
 */
export type Signal = {
  label: string
  terms: string[]
  reason: string
  evidence: string
}

export type JdClassification = {
  role: { title: string; family: RoleFamily; seniority: Seniority; fields: string[] }
  company: { name: string | null; domain: Domain; sectors: Sector[] }
  work: {
    mode: WorkMode
    location: string | null
    employment: string | null
    timezone: string | null
  }
  compensation: { salary: string | null; equity: boolean | null }
  requirements: Requirement[]
  signals: Signal[]
  responsibilities: string[]
  benefits: string[]
  keywords: string[]
  summary: string
}

export type ClassifyModel = 'gemma' | 'jev'

export type ClassificationMeta = {
  model: ClassifyModel
  modelId: string
  latencyMs: number
  attempts: number
  cached?: boolean
  usage?: Record<string, number>
}

export type ClassificationResult = {
  data: JdClassification
  meta: ClassificationMeta
}

/** Research is public company context; it never includes the CV. */
export type Founder = { name: string; role: string | null }

export type CompanyLink = { title: string; url: string }

export type CompanyProfile = {
  name: string
  summary: string
  sectors: Sector[]
  founders: Founder[]
  stage: string | null
  funding: string | null
  links: CompanyLink[]
  signals: Signal[]
  sources: string[]
  researchedAt: string
}

export type ResearchMeta = {
  cached: boolean
  latencyMs: number
  sourceCount: number
}

export type ResearchResult = {
  profile: CompanyProfile
  meta: ResearchMeta
}

export const FAMILY_LABELS: Record<RoleFamily, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  fullstack: 'Fullstack',
  mobile: 'Mobile',
  data: 'Data',
  ml: 'ML',
  devops: 'DevOps',
  security: 'Security',
  design: 'Design',
  product: 'Product',
  qa: 'QA',
  other: 'Other',
}

export const SENIORITY_LABELS: Record<Seniority, string> = {
  intern: 'Intern',
  junior: 'Junior',
  mid: 'Mid-level',
  senior: 'Senior',
  staff: 'Staff',
  principal: 'Principal',
  lead: 'Lead',
  director: 'Director',
  unspecified: 'Unspecified',
}

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  unspecified: 'Work mode not stated',
}

export const DOMAIN_LABELS: Record<Domain, string> = {
  fintech: 'Fintech',
  health: 'Health',
  ecommerce: 'Ecommerce',
  saas: 'SaaS',
  marketplace: 'Marketplace',
  education: 'Education',
  gaming: 'Gaming',
  media: 'Media',
  agency: 'Agency',
  'developer-tools': 'Developer tools',
  logistics: 'Logistics',
  other: 'Other domain',
  unspecified: 'Domain not stated',
}

export const SECTOR_LABELS: Record<Sector, string> = {
  ai: 'AI',
  media: 'Media',
  consumer: 'Consumer',
  design: 'Design',
  productivity: 'Productivity',
  saas: 'SaaS',
  'developer-tools': 'Developer tools',
  fintech: 'Fintech',
  health: 'Health',
  ecommerce: 'Ecommerce',
  marketplace: 'Marketplace',
  education: 'Education',
  gaming: 'Gaming',
  agency: 'Agency',
  logistics: 'Logistics',
  other: 'Other',
}

export const CATEGORY_LABELS: Record<RequirementCategory, string> = {
  language: 'Language',
  framework: 'Framework',
  tool: 'Tool',
  platform: 'Platform',
  practice: 'Practice',
  domain: 'Domain',
  'soft-skill': 'Soft skill',
  education: 'Education',
  experience: 'Experience',
  other: 'Other',
}

export function emptyClassification(): JdClassification {
  return {
    role: { title: '', family: 'other', seniority: 'unspecified', fields: [] },
    company: { name: null, domain: 'unspecified', sectors: [] },
    work: { mode: 'unspecified', location: null, employment: null, timezone: null },
    compensation: { salary: null, equity: null },
    requirements: [],
    signals: [],
    responsibilities: [],
    benefits: [],
    keywords: [],
    summary: '',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pick<T extends readonly string[]>(
  options: T,
  value: unknown,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback
}

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function nullableText(value: unknown, max: number) {
  const result = text(value, max)
  return result.length > 0 ? result : null
}

function stringList(value: unknown, max: number, maxLength = 90) {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const result: string[] = []

  for (const entry of value) {
    const item = text(entry, maxLength)
    const key = item.toLowerCase()
    if (!item || seen.has(key)) continue
    seen.add(key)
    result.push(item)
    if (result.length >= max) break
  }

  return result
}

function normaliseYears(value: unknown) {
  const years = typeof value === 'string' ? Number(value) : value
  if (typeof years !== 'number' || !Number.isFinite(years)) return null
  if (years <= 0 || years > 40) return null
  return Math.round(years)
}

function normaliseRequirement(value: unknown): Requirement | null {
  if (!isRecord(value)) return null

  const items = stringList(value.items, 6, 60)
  const label = text(value.label, 120) || items.join(' or ')

  if (!label && items.length === 0) return null

  const importance = pick(IMPORTANCES, value.importance, 'must')
  const rawCombination = pick(COMBINATIONS, value.combination, 'all')
  const evidence = text(value.evidence, 180)
  const match = stringList(value.match, 8, 60)

  // "any" only means anything when the posting says so. A model that turns
  // "AWS with Docker and Kubernetes" into an either-or group is contradicted
  // by its own quote, so the quote wins.
  const saysAlternatively = /\bor\b|\//i.test(evidence) || /\bor\b|\//i.test(label)
  const combination =
    items.length > 1 && rawCombination === 'any' && saysAlternatively ? 'any' : 'all'

  return {
    label: label || items.join(' or '),
    category: pick(REQUIREMENT_CATEGORIES, value.category, 'other'),
    importance,
    combination,
    items: items.length > 0 ? items : [label],
    match: match.length > 0 ? match : items.length > 0 ? items : [label],
    years: normaliseYears(value.years),
    evidence,
  }
}

function normaliseSignal(value: unknown): Signal | null {
  if (!isRecord(value)) return null

  const label = text(value.label, 100)
  const terms = stringList(value.terms, 8, 60)
  if (!label || terms.length === 0) return null

  return {
    label,
    terms,
    reason: text(value.reason, 180),
    evidence: text(value.evidence, 180),
  }
}

function normaliseSignals(value: unknown, max = 6): Signal[] {
  if (!Array.isArray(value)) return []

  const signals: Signal[] = []
  const seen = new Set<string>()

  for (const entry of value) {
    const signal = normaliseSignal(entry)
    if (!signal) continue
    const key = signal.label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    signals.push(signal)
    if (signals.length >= max) break
  }

  return signals
}

function normaliseFields(value: unknown): string[] {
  return stringList(value, 6, 40).map((field) => field.toLowerCase())
}

function normaliseSectors(value: unknown, domain: unknown): Sector[] {
  const sectors: Sector[] = []

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== 'string') continue
      if (!(SECTORS as readonly string[]).includes(entry)) continue
      if (!sectors.includes(entry as Sector)) sectors.push(entry as Sector)
      if (sectors.length >= 4) break
    }
  }

  if (sectors.length === 0) {
    const fallback = pick(DOMAINS, domain, 'unspecified')
    if (fallback !== 'unspecified' && (SECTORS as readonly string[]).includes(fallback)) {
      sectors.push(fallback as Sector)
    }
  }

  // Canonical order, so the same set always reads the same in the UI.
  return sectors.sort(
    (left, right) => SECTORS.indexOf(left) - SECTORS.indexOf(right),
  )
}

function normaliseUrl(value: unknown) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * One requirement is either a single term or an either-or group. A `all` entry
 * holding several terms is split, so nothing can hide behind a compound.
 */
function expandRequirement(requirement: Requirement): Requirement[] {
  if (requirement.combination === 'any' || requirement.items.length < 2) {
    return [requirement]
  }

  return requirement.items.map((item) => ({
    ...requirement,
    label: item,
    combination: 'all',
    items: [item],
  }))
}

/**
 * Coerce whatever a model said into the contract. Unknown fields are dropped,
 * enums fall back to their neutral member, and nothing throws — a malformed
 * answer becomes a sparse classification rather than a broken page.
 */
export function normaliseClassification(value: unknown): JdClassification {
  const base = emptyClassification()
  if (!isRecord(value)) return base

  const role = isRecord(value.role) ? value.role : {}
  const company = isRecord(value.company) ? value.company : {}
  const work = isRecord(value.work) ? value.work : {}
  const compensation = isRecord(value.compensation) ? value.compensation : {}

  const requirements: Requirement[] = []
  const seen = new Set<string>()

  if (Array.isArray(value.requirements)) {
    for (const entry of value.requirements) {
      const requirement = normaliseRequirement(entry)
      if (!requirement) continue

      for (const part of expandRequirement(requirement)) {
        const key = `${part.importance}|${part.items
          .map((item) => item.toLowerCase())
          .sort()
          .join('+')}`
        if (seen.has(key)) continue
        seen.add(key)
        requirements.push(part)
        if (requirements.length >= 40) break
      }
      if (requirements.length >= 40) break
    }
  }

  const sectors = normaliseSectors(company.sectors, company.domain)
  const domainFromSectors = sectors.find((sector) =>
    (DOMAINS as readonly string[]).includes(sector),
  ) as Domain | undefined

  return {
    role: {
      title: text(role.title, 120),
      family: pick(ROLE_FAMILIES, role.family, 'other'),
      seniority: pick(SENIORITIES, role.seniority, 'unspecified'),
      fields: normaliseFields(role.fields),
    },
    company: {
      name: nullableText(company.name, 80),
      domain: pick(DOMAINS, company.domain, domainFromSectors ?? 'unspecified'),
      sectors,
    },
    work: {
      mode: pick(WORK_MODES, work.mode, 'unspecified'),
      location: nullableText(work.location, 80),
      employment: nullableText(work.employment, 40),
      timezone: nullableText(work.timezone, 60),
    },
    compensation: {
      salary: nullableText(compensation.salary, 80),
      equity: typeof compensation.equity === 'boolean' ? compensation.equity : null,
    },
    requirements,
    signals: normaliseSignals(value.signals),
    responsibilities: stringList(value.responsibilities, 8, 140),
    benefits: stringList(value.benefits, 8, 100),
    keywords: stringList(value.keywords, 15, 40),
    summary: text(value.summary, 240),
  }
}

/**
 * Stable lookup key for a company. Used by the identity and research caches so
 * "Cardboard, Inc." and "cardboard" resolve to the same sectors.
 */
export function companyKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function emptyCompanyProfile(name: string): CompanyProfile {
  return {
    name,
    summary: '',
    sectors: [],
    founders: [],
    stage: null,
    funding: null,
    links: [],
    signals: [],
    sources: [],
    researchedAt: new Date().toISOString(),
  }
}

/** Coerce researched company data into the profile contract. */
export function normaliseCompanyProfile(
  value: unknown,
  fallbackName: string,
): CompanyProfile {
  const profile = emptyCompanyProfile(
    (isRecord(value) && text(value.name, 80)) || fallbackName,
  )

  if (!isRecord(value)) return profile

  const founders: Founder[] = []
  if (Array.isArray(value.founders)) {
    for (const entry of value.founders) {
      const name = isRecord(entry) ? text(entry.name, 80) : text(entry, 80)
      if (!name) continue
      const role = isRecord(entry) ? nullableText(entry.role, 80) : null
      if (founders.some((founder) => founder.name.toLowerCase() === name.toLowerCase())) {
        continue
      }
      founders.push({ name, role })
      if (founders.length >= 6) break
    }
  }

  const links: CompanyLink[] = []
  if (Array.isArray(value.links)) {
    for (const entry of value.links) {
      const title = isRecord(entry) ? text(entry.title, 80) : ''
      const url = isRecord(entry) ? normaliseUrl(entry.url) : null
      if (!url) continue
      if (links.some((link) => link.url === url)) continue
      links.push({ title: title || new URL(url).hostname, url })
      if (links.length >= 5) break
    }
  }

  const sources = stringList(value.sources, 8, 300)
    .map((source) => normaliseUrl(source))
    .filter((source): source is string => Boolean(source))

  return {
    name: profile.name,
    summary: text(value.summary, 400),
    sectors: normaliseSectors(value.sectors, 'unspecified'),
    founders,
    stage: nullableText(value.stage, 80),
    funding: nullableText(value.funding, 140),
    links,
    signals: normaliseSignals(value.signals, 6),
    sources: [...new Set(sources)],
    researchedAt: new Date().toISOString(),
  }
}

/**
 * Pull the first JSON object out of a model reply. Handles fenced blocks and
 * stray prose while respecting braces inside strings.
 */
export function extractJson(reply: string): unknown {
  const start = reply.indexOf('{')
  if (start === -1) throw new Error('The model did not return JSON.')

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < reply.length; index += 1) {
    const character = reply[index]

    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }

    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        return JSON.parse(reply.slice(start, index + 1)) as unknown
      }
    }
  }

  throw new Error('The model returned incomplete JSON.')
}

/** Stable key for comparing requirement terms across models and the eval. */
export function termKey(term: string) {
  return term
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9+#.]+/g, '')
}
