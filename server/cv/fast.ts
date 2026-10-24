import type {
  CvBlock,
  CvBullet,
  CvClassification,
  CvClassificationResponse,
  CvContact,
  CvEducation,
  CvRole,
} from '../../shared/cv-classification'
import {
  emptyCvClassification,
  normaliseCvClassification,
} from '../../shared/cv-classification'
import { runClef, type ClefQuestion } from '../cloudflare'
import type { ServerConfig } from '../env'
import { parseDocx } from './docx'
import { CvClassifyError } from './errors'

export type BlockKind =
  | 'heading'
  | 'role_header'
  | 'bullet'
  | 'summary'
  | 'education'
  | 'skills'
  | 'contact'
  | 'other'

const LABELS: BlockKind[] = [
  'heading',
  'role_header',
  'bullet',
  'summary',
  'education',
  'skills',
  'contact',
  'other',
]

const CLEF_CRITERIA: Record<string, string> = {
  heading: 'A section heading such as Profile, Experience, Education, Skills or Projects.',
  role_header: 'A job title line, usually with company and/or dates.',
  bullet: 'A bullet point or achievement under a role.',
  summary: 'A prose profile or summary paragraph.',
  education: 'An education entry: institution, degree and/or dates.',
  skills: 'A list of skills, tools or languages.',
  contact: 'The name, headline, email, phone, location or links.',
  other: 'Anything else.',
}

const SECTION_HEADINGS: Record<string, string> = {
  profile: 'summary',
  summary: 'summary',
  about: 'summary',
  'about me': 'summary',
  objective: 'summary',
  experience: 'experience',
  employment: 'experience',
  'work experience': 'experience',
  'work history': 'experience',
  'professional experience': 'experience',
  career: 'experience',
  education: 'education',
  academic: 'education',
  skills: 'skills',
  technologies: 'skills',
  'technical skills': 'skills',
  tools: 'skills',
  expertise: 'skills',
  'core competencies': 'skills',
  projects: 'projects',
  'selected projects': 'projects',
  certifications: 'other',
  certificates: 'other',
  languages: 'other',
  awards: 'other',
}

const ROLE_WORDS =
  /\b(engineer|developer|designer|manager|analyst|scientist|architect|lead|director|intern|researcher|specialist|consultant|programmer|founder|officer|head|vp|president)\b/i

const DATE_RANGE =
  /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\s*[–—-]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(?:(?:19|20)\d{2}|present|current)\b/i

const SINGLE_YEAR = /\b(?:19|20)\d{2}\b/

const EMAIL = /[\w.+-]+@[\w.-]+\.\w+/i
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/
const DEGREE = /\b(?:BSc|MSc|BA|MA|MBA|PhD|Ph\.D|Bachelor|Master|Doctor|Diploma|Certificate)\b/i
const INSTITUTION = /\b(?:university|college|institute|school|academy)\b/i
const NAME = /^[\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*){1,3}$/u

const CLEF_CONFIDENCE = 0.45
const CLEF_BATCH = 64
const MAX_CV_TEXT_CHARS = 80_000

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim().replace(/^[\s·|,;—-]+|[\s·|,;—-]+$/g, '')
}

function sectionOf(text: string) {
  return SECTION_HEADINGS[clean(text).toLowerCase()] ?? null
}

function dateOf(text: string) {
  let match = DATE_RANGE.exec(text)
  if (match) return match[0]
  match = SINGLE_YEAR.exec(text)
  return match ? match[0] : null
}

function deterministicLabel(block: CvBlock): BlockKind {
  const text = block.text
  const lower = text.toLowerCase()
  const style = (block.style ?? '').toLowerCase()

  if (sectionOf(text)) return 'heading'

  if (block.list) return 'bullet'

  if (EMAIL.test(text) || PHONE.test(text) || /(?:https?:\/\/|www\.|linkedin\.com|github\.com)/i.test(text)) {
    return 'contact'
  }

  if (DATE_RANGE.test(text) && ROLE_WORDS.test(text)) return 'role_header'
  if (DATE_RANGE.test(text) && !DEGREE.test(text) && !INSTITUTION.test(text)) {
    return ROLE_WORDS.test(text) ? 'role_header' : 'other'
  }

  if (DEGREE.test(text) || INSTITUTION.test(text)) return 'education'

  if (/^(heading|title)/.test(style)) return 'heading'
  if (/experience|employment|work/i.test(lower) && /heading|title/.test(style)) {
    return 'heading'
  }

  return 'other'
}

type ClefLabels = {
  labels: Map<number, BlockKind>
  used: boolean
  usage?: Record<string, number>
}

async function labelWithClef(
  blocks: CvBlock[],
  config: ServerConfig,
): Promise<ClefLabels> {
  const visible = blocks
    .map((block, index) => ({ block, index }))
    .filter((entry) => entry.block.text)

  // Rules already handle headings, lists, dates, contact and education. Ask
  // Clef only about the blocks that remain ambiguous.
  const candidates = visible.filter(({ block }) => {
    const base = deterministicLabel(block)
    return base === 'other' || (base === 'heading' && !sectionOf(block.text))
  })

  if (candidates.length === 0) {
    return { labels: new Map(), used: false }
  }

  const state = visible
    .map(
      ({ block, index }) =>
        `[b${index}]${block.style ? ` (${block.style})` : ''}${
          block.list ? ' (list)' : ''
        } ${block.text}`,
    )
    .join('\n')

  const labels = new Map<number, BlockKind>()
  let used = false
  let inputTokens = 0
  let outputTokens = 0

  for (let start = 0; start < candidates.length; start += CLEF_BATCH) {
    const batch = candidates.slice(start, start + CLEF_BATCH)
    const questions: Record<string, ClefQuestion> = {}

    for (const entry of batch) {
      questions[`b${entry.index}`] = {
        type: 'choice',
        instructions: `What is block b${entry.index} in this CV? Use the surrounding blocks for context.`,
        criteria: CLEF_CRITERIA,
      }
    }

    try {
      const result = await runClef(config, { state, questions })
      const usage = result.usage
      if (usage) {
        inputTokens += Number(usage.input_tokens ?? usage.prompt_tokens ?? 0)
        outputTokens += Number(usage.output_tokens ?? usage.completion_tokens ?? 0)
      }

      for (const entry of batch) {
        const answer = result.answers[`b${entry.index}`]
        if (answer?.type !== 'choice') continue
        if (!LABELS.includes(answer.choice as BlockKind)) continue
        if ((answer.confidence ?? 1) < CLEF_CONFIDENCE) continue
        labels.set(entry.index, answer.choice as BlockKind)
        used = true
      }
    } catch (error) {
      console.error(
        '[cv-classify] Clef block labeling failed; using rules',
        error instanceof Error ? error.message : error,
      )
      break
    }
  }

  return {
    labels,
    used,
    usage:
      inputTokens + outputTokens > 0
        ? {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
          }
        : undefined,
  }
}

function mergeLabels(blocks: CvBlock[], clef: ClefLabels) {
  return blocks.map((block, index) => {
    const base = deterministicLabel(block)
    const next = clef.labels.get(index)

    if (!next) return base

    if (base === 'heading' && sectionOf(block.text)) return base
    if (base === 'bullet') return base
    if (base === 'role_header') return base
    if (base === 'contact') return base
    if (base === 'education') return base

    return next
  })
}

function contactFrom(blocks: CvBlock[], labels: BlockKind[]): CvContact {
  const contact: CvContact = {
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

  const contactIndexes = labels
    .map((label, index) => (label === 'contact' ? index : -1))
    .filter((index) => index >= 0)

  const candidateIndexes = new Set(contactIndexes)
  const first = blocks.findIndex((block) => block.text)
  if (first >= 0) candidateIndexes.add(first)

  for (const index of [...candidateIndexes].sort((a, b) => a - b)) {
    const block = blocks[index]
    if (!block?.text) continue
    const segments = block.text.split(/\s*[·|•]\s*/).map(clean).filter(Boolean)

    if (!contact.name) {
      const candidate = segments[0] ?? block.text
      if (
        NAME.test(candidate) &&
        !ROLE_WORDS.test(candidate) &&
        !EMAIL.test(candidate)
      ) {
        contact.name = candidate
        contact.anchors.name = { blockId: block.id, find: null }
      }
    }

    for (const segment of segments) {
      const email = EMAIL.exec(segment)?.[0]
      if (email && !contact.email) {
        contact.email = email
        contact.anchors.email = { blockId: block.id, find: email }
        continue
      }

      const phone = PHONE.exec(segment)?.[0]
      if (phone && !contact.phone) {
        contact.phone = phone
        contact.anchors.phone = { blockId: block.id, find: phone }
        continue
      }

      if (/(?:https?:\/\/|www\.|linkedin\.com|github\.com)/i.test(segment)) {
        if (!contact.links.includes(segment)) contact.links.push(segment)
        continue
      }

      if (ROLE_WORDS.test(segment) && !contact.headline) {
        contact.headline = segment
        contact.anchors.headline = { blockId: block.id, find: segment }
        continue
      }

      if (
        segment !== contact.name &&
        !contact.location &&
        !ROLE_WORDS.test(segment) &&
        !/\d/.test(segment) &&
        segment.length <= 60
      ) {
        contact.location = segment
        contact.anchors.location = { blockId: block.id, find: segment }
      }
    }
  }

  return contact
}

function roleFrom(
  block: CvBlock,
  index: number,
): CvRole | null {
  const text = block.text
  const dates = dateOf(text)
  let core = dates ? text.replace(dates, ' ') : text
  core = clean(core)

  let location: string | null = null
  const segments = core.split(/\s*[·|]\s*/).map(clean).filter(Boolean)
  if (segments.length > 1) {
    const last = segments[segments.length - 1]
    if (
      !ROLE_WORDS.test(last) &&
      !EMAIL.test(last) &&
      !/\d{4}/.test(last) &&
      last.length <= 50
    ) {
      location = last
      segments.pop()
    }
  }

  core = clean(segments.join(' · '))

  const parts = core
    .split(/\s*[—–]\s*|\s+\bat\b\s+|\s*\|\s*|\s*,\s*/)
    .map(clean)
    .filter(Boolean)

  let company: string | null = null
  let title: string | null = null

  const titlePart = parts.find((part) => ROLE_WORDS.test(part))
  if (titlePart) {
    title = titlePart
    company = parts.find((part) => part !== titlePart) ?? null
  } else if (parts.length > 1) {
    company = parts[0]
    title = parts.slice(1).join(' · ')
  } else {
    title = core || null
  }

  if (!title && !company) return null

  return {
    id: `role-${index + 1}`,
    company,
    title,
    dates,
    location,
    summary: null,
    bullets: [],
    anchors: {
      company:
        company && text.includes(company)
          ? { blockId: block.id, find: company }
          : null,
      title:
        title && text.includes(title)
          ? { blockId: block.id, find: title }
          : null,
      dates: dates ? { blockId: block.id, find: dates } : null,
      location:
        location && text.includes(location)
          ? { blockId: block.id, find: location }
          : null,
    },
  }
}

function educationFrom(block: CvBlock, index: number): CvEducation | null {
  const text = block.text
  const dates = dateOf(text)
  let core = dates ? text.replace(dates, ' ') : text
  core = clean(core)

  const parts = core
    .split(/\s*[—–]\s*|\s*\|\s*|\s*,\s*/)
    .map(clean)
    .filter(Boolean)

  const degreePart = parts.find((part) => DEGREE.test(part)) ?? null
  const institutionPart =
    parts.find((part) => INSTITUTION.test(part)) ??
    (degreePart ? parts.find((part) => part !== degreePart) ?? null : parts[0] ?? null)

  const degree = degreePart
  const institution = institutionPart ?? (parts.length === 0 ? core || null : null)

  if (!institution && !degree && !dates) return null

  return {
    id: `education-${index + 1}`,
    institution,
    degree,
    dates,
    details: [],
    anchors: {
      institution:
        institution && text.includes(institution)
          ? { blockId: block.id, find: institution }
          : null,
      degree:
        degree && text.includes(degree)
          ? { blockId: block.id, find: degree }
          : null,
      dates: dates ? { blockId: block.id, find: dates } : null,
    },
  }
}

function splitSkills(text: string) {
  return text
    .replace(/^(?:technical\s+)?(?:skills|technologies|tools)\s*[:\-–]\s*/i, '')
    .split(/[,;|·•\n]/)
    .map((skill) =>
      clean(skill)
        .replace(/^(?:proficient in|experience with)\s+/i, '')
        .replace(/[.]+$/, ''),
    )
    .filter((skill) => skill.length > 0 && skill.length <= 60)
}

export async function classifyCvDocxFast(
  input: Uint8Array,
  config: ServerConfig,
): Promise<CvClassificationResponse> {
  const started = performance.now()
  const blocks = await parseDocx(input)
  const textLength = blocks.reduce((total, block) => total + block.text.length, 0)

  if (textLength === 0) {
    throw new CvClassifyError('No text was found in this CV.')
  }

  if (textLength > MAX_CV_TEXT_CHARS) {
    throw new CvClassifyError(
      'This CV has more text than the assistant can read in one pass. Try a shorter CV.',
    )
  }

  const clef = await labelWithClef(blocks, config)
  const labels = mergeLabels(blocks, clef)
  const data: CvClassification = emptyCvClassification()
  let section = 'other'
  let summarySet = false

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!block.text) continue

    const label = labels[index] ?? 'other'

    if (label === 'heading') {
      const next = sectionOf(block.text)
      if (next) section = next
      continue
    }

    if (label === 'contact') continue

    if (label === 'summary' || (section === 'summary' && label === 'other' && !summarySet)) {
      if (!summarySet) {
        data.summary = block.text
        data.summaryAnchor = { blockId: block.id, find: null }
        summarySet = true
      }
      continue
    }

    if (label === 'skills' || (section === 'skills' && label === 'other')) {
      const skills = splitSkills(block.text)
      for (const skill of skills) {
        if (!data.skills.some((entry) => entry.toLowerCase() === skill.toLowerCase())) {
          data.skills.push(skill)
        }
      }
      if (!data.skillsAnchor) {
        data.skillsAnchor = { blockId: block.id, find: null }
      }
      continue
    }

    if (label === 'role_header') {
      section = 'experience'
      const role = roleFrom(block, data.roles.length)
      if (role) data.roles.push(role)
      continue
    }

    if (label === 'bullet') {
      if (section !== 'experience') continue
      const role = data.roles[data.roles.length - 1]
      if (!role) continue
      const bullet: CvBullet = {
        text: block.text,
        anchor: { blockId: block.id, find: null },
      }
      role.bullets.push(bullet)
      continue
    }

    if (label === 'education' || (section === 'education' && label === 'other')) {
      const education = educationFrom(block, data.education.length)
      if (education) data.education.push(education)
    }
  }

  data.contact = contactFrom(blocks, labels)

  const normalised = normaliseCvClassification(data, blocks)
  const totalBullets = normalised.roles.reduce(
    (total, role) => total + role.bullets.length,
    0,
  )
  const needsDeepRead =
    normalised.roles.length === 0 || totalBullets === 0

  return {
    data: normalised,
    meta: {
      model: clef.used ? 'clef' : 'heuristic',
      modelId: clef.used ? config.clefModel : 'rules',
      latencyMs: Math.round(performance.now() - started),
      attempts: 1,
      needsDeepRead,
      usage: clef.usage,
    },
    blocks,
  }
}
