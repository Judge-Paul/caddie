/**
 * A CV parsed from a DOCX and mapped to structured data. Every editable field
 * carries an anchor back to a DOCX block, so a model can say "change this title"
 * and the edit API knows exactly which run to rewrite.
 */

export type CvAnchor = {
  blockId: string
  /** Exact substring inside the block; null means the whole block. */
  find: string | null
}

export type CvBlock = {
  id: string
  index: number
  text: string
  style: string | null
  list: boolean
  inTable: boolean
}

export type CvBullet = {
  text: string
  anchor: CvAnchor | null
}

export type CvRole = {
  id: string
  company: string | null
  title: string | null
  dates: string | null
  location: string | null
  summary: string | null
  bullets: CvBullet[]
  anchors: {
    company: CvAnchor | null
    title: CvAnchor | null
    dates: CvAnchor | null
    location: CvAnchor | null
  }
}

export type CvEducation = {
  id: string
  institution: string | null
  degree: string | null
  dates: string | null
  details: string[]
  anchors: {
    institution: CvAnchor | null
    degree: CvAnchor | null
    dates: CvAnchor | null
  }
}

export type CvProject = {
  id: string
  name: string | null
  description: string | null
  url: string | null
  anchors: {
    name: CvAnchor | null
    description: CvAnchor | null
  }
}

export type CvContact = {
  name: string | null
  headline: string | null
  email: string | null
  phone: string | null
  location: string | null
  links: string[]
  anchors: {
    name: CvAnchor | null
    headline: CvAnchor | null
    email: CvAnchor | null
    phone: CvAnchor | null
    location: CvAnchor | null
  }
}

export type CvClassification = {
  contact: CvContact
  summary: string | null
  summaryAnchor: CvAnchor | null
  roles: CvRole[]
  education: CvEducation[]
  projects: CvProject[]
  skills: string[]
  skillsAnchor: CvAnchor | null
  languages: string[]
  languagesAnchor: CvAnchor | null
  certifications: string[]
  certificationsAnchor: CvAnchor | null
}

export type CvMeta = {
  model: 'clef' | 'gemma' | 'heuristic'
  modelId: string
  latencyMs: number
  attempts: number
  /** The fast structural read may be partial; the user can ask for a deep read. */
  needsDeepRead?: boolean
  usage?: Record<string, number>
}

export type CvClassificationResult = {
  data: CvClassification
  meta: CvMeta
}

export type CvClassificationResponse = CvClassificationResult & {
  blocks: CvBlock[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function nullableText(value: unknown, max: number) {
  const result = text(value, max)
  return result.length > 0 ? result : null
}

function stringList(value: unknown, max: number, maxLength = 80) {
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

function emptyContact(): CvContact {
  return {
    name: null,
    headline: null,
    email: null,
    phone: null,
    location: null,
    links: [],
    anchors: {
      name: null,
      headline: null,
      email: null,
      phone: null,
      location: null,
    },
  }
}

export function emptyCvClassification(): CvClassification {
  return {
    contact: emptyContact(),
    summary: null,
    summaryAnchor: null,
    roles: [],
    education: [],
    projects: [],
    skills: [],
    skillsAnchor: null,
    languages: [],
    languagesAnchor: null,
    certifications: [],
    certificationsAnchor: null,
  }
}

/** Keep an anchor only if it points at a real block and, when given, real text. */
function normaliseAnchor(
  value: unknown,
  blocks: CvBlock[],
  fieldText: string | null,
): CvAnchor | null {
  if (!isRecord(value)) return null

  const blockId = text(value.blockId, 40)
  const block = blocks.find((entry) => entry.id === blockId)
  if (!block) return null

  const find = text(value.find, 200)

  if (find && block.text.includes(find)) {
    return { blockId, find }
  }

  if (fieldText) {
    if (block.text === fieldText) return { blockId, find: null }
    if (block.text.includes(fieldText)) return { blockId, find: fieldText }
  }

  if (!find && !fieldText) return { blockId, find: null }
  return null
}

function normaliseBullet(value: unknown, blocks: CvBlock[]): CvBullet | null {
  if (!isRecord(value)) return null

  const bullet = text(value.text, 400)
  if (!bullet) return null

  const anchorValue = isRecord(value.anchor) ? value.anchor : value
  const anchor = normaliseAnchor(anchorValue, blocks, bullet)

  return { text: bullet, anchor }
}

function normaliseRole(value: unknown, index: number, blocks: CvBlock[]): CvRole | null {
  if (!isRecord(value)) return null

  const company = nullableText(value.company, 120)
  const title = nullableText(value.title, 120)
  const dates = nullableText(value.dates, 80)
  const location = nullableText(value.location, 80)
  const summary = nullableText(value.summary, 300)
  const anchors = isRecord(value.anchors) ? value.anchors : {}

  const bullets = Array.isArray(value.bullets)
    ? value.bullets
        .map((entry) => normaliseBullet(entry, blocks))
        .filter((entry): entry is CvBullet => Boolean(entry))
        .slice(0, 12)
    : []

  if (!company && !title && !dates && !location && bullets.length === 0) return null

  return {
    id: text(value.id, 60) || `role-${index + 1}`,
    company,
    title,
    dates,
    location,
    summary,
    bullets,
    anchors: {
      company: normaliseAnchor(anchors.company, blocks, company),
      title: normaliseAnchor(anchors.title, blocks, title),
      dates: normaliseAnchor(anchors.dates, blocks, dates),
      location: normaliseAnchor(anchors.location, blocks, location),
    },
  }
}

function normaliseEducation(
  value: unknown,
  index: number,
  blocks: CvBlock[],
): CvEducation | null {
  if (!isRecord(value)) return null

  const institution = nullableText(value.institution, 120)
  const degree = nullableText(value.degree, 120)
  const dates = nullableText(value.dates, 80)
  const details = stringList(value.details, 8, 200)
  const anchors = isRecord(value.anchors) ? value.anchors : {}

  if (!institution && !degree && !dates && details.length === 0) return null

  return {
    id: text(value.id, 60) || `education-${index + 1}`,
    institution,
    degree,
    dates,
    details,
    anchors: {
      institution: normaliseAnchor(anchors.institution, blocks, institution),
      degree: normaliseAnchor(anchors.degree, blocks, degree),
      dates: normaliseAnchor(anchors.dates, blocks, dates),
    },
  }
}

function normaliseProject(
  value: unknown,
  index: number,
  blocks: CvBlock[],
): CvProject | null {
  if (!isRecord(value)) return null

  const name = nullableText(value.name, 120)
  const description = nullableText(value.description, 400)
  const url = nullableText(value.url, 200)
  const anchors = isRecord(value.anchors) ? value.anchors : {}

  if (!name && !description && !url) return null

  return {
    id: text(value.id, 60) || `project-${index + 1}`,
    name,
    description,
    url,
    anchors: {
      name: normaliseAnchor(anchors.name, blocks, name),
      description: normaliseAnchor(anchors.description, blocks, description),
    },
  }
}

/**
 * Coerce a model answer into the CV contract. Invalid anchors become null
 * rather than pointing the edit API at the wrong paragraph.
 */
export function normaliseCvClassification(
  value: unknown,
  blocks: CvBlock[],
): CvClassification {
  const base = emptyCvClassification()
  if (!isRecord(value)) return base

  const contactValue = isRecord(value.contact) ? value.contact : {}
  const contactAnchors = isRecord(contactValue.anchors) ? contactValue.anchors : {}

  const contact: CvContact = {
    name: nullableText(contactValue.name, 120),
    headline: nullableText(contactValue.headline, 160),
    email: nullableText(contactValue.email, 160),
    phone: nullableText(contactValue.phone, 60),
    location: nullableText(contactValue.location, 120),
    links: stringList(contactValue.links, 6, 240),
    anchors: {
      name: null,
      headline: null,
      email: null,
      phone: null,
      location: null,
    },
  }

  contact.anchors.name = normaliseAnchor(contactAnchors.name, blocks, contact.name)
  contact.anchors.headline = normaliseAnchor(
    contactAnchors.headline,
    blocks,
    contact.headline,
  )
  contact.anchors.email = normaliseAnchor(contactAnchors.email, blocks, contact.email)
  contact.anchors.phone = normaliseAnchor(contactAnchors.phone, blocks, contact.phone)
  contact.anchors.location = normaliseAnchor(
    contactAnchors.location,
    blocks,
    contact.location,
  )

  const summary = nullableText(value.summary, 400)
  const summaryAnchor = normaliseAnchor(value.summaryAnchor, blocks, summary)

  const roles = Array.isArray(value.roles)
    ? value.roles
        .map((entry, index) => normaliseRole(entry, index, blocks))
        .filter((entry): entry is CvRole => Boolean(entry))
        .slice(0, 12)
    : []

  const education = Array.isArray(value.education)
    ? value.education
        .map((entry, index) => normaliseEducation(entry, index, blocks))
        .filter((entry): entry is CvEducation => Boolean(entry))
        .slice(0, 6)
    : []

  const projects = Array.isArray(value.projects)
    ? value.projects
        .map((entry, index) => normaliseProject(entry, index, blocks))
        .filter((entry): entry is CvProject => Boolean(entry))
        .slice(0, 8)
    : []

  return {
    contact,
    summary,
    summaryAnchor,
    roles,
    education,
    projects,
    skills: stringList(value.skills, 40, 60),
    skillsAnchor: normaliseAnchor(value.skillsAnchor, blocks, null),
    languages: stringList(value.languages, 20, 60),
    languagesAnchor: normaliseAnchor(value.languagesAnchor, blocks, null),
    certifications: stringList(value.certifications, 20, 120),
    certificationsAnchor: normaliseAnchor(value.certificationsAnchor, blocks, null),
  }
}
