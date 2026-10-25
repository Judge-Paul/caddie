import type {
  CvClassification,
  CvRole,
} from '../../shared/cv-classification'
import type { FitProposal, FitRequest, FitResponse } from '../../shared/cv-fit'
import type { JdClassification } from '../../shared/jd-classification'
import { extractJson } from '../../shared/jd-classification'
import { runChat } from '../cloudflare'
import type { ServerConfig } from '../env'
import { MAX_DOCX_BYTES, editDocx, parseDocx } from './docx'
import { fitMessages } from './fit-prompt'
import { measurePdf } from './measure'
import { renderDocxToPdf } from './render'

const MAX_BULLETS = 2
const MAX_TARGETS = 3
const MAX_BULLET_CHARS = 240

export class FitError extends Error {
  readonly status: number

  constructor(message: string, status = 422) {
    super(message)
    this.name = 'FitError'
    this.status = status
  }
}

type GeneratedBullet = {
  text: string
  rationale: string
  factsUsed: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
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

function jdTerms(jd: JdClassification) {
  const terms = new Set<string>()

  for (const requirement of jd.requirements) {
    terms.add(requirement.label.toLowerCase())
    for (const term of [...requirement.match, ...requirement.items]) {
      terms.add(term.toLowerCase())
    }
  }

  for (const signal of jd.signals) {
    terms.add(signal.label.toLowerCase())
    for (const term of signal.terms) terms.add(term.toLowerCase())
  }

  return [...terms].filter((term) => term.length >= 3)
}

function relevance(bullet: string, terms: string[]) {
  const lower = bullet.toLowerCase()
  return terms.reduce((score, term) => (lower.includes(term) ? score + 1 : score), 0)
}

function findRole(cv: CvClassification, roleId: string): CvRole | null {
  return cv.roles.find((role) => role.id === roleId) ?? null
}

function targetCandidates(
  role: CvRole,
  jd: JdClassification,
  gapTerms: string[],
  exclude: Set<string>,
) {
  const terms = jdTerms(jd)

  return role.bullets
    .filter((bullet) => {
      const blockId = bullet.anchor?.blockId
      if (!blockId || exclude.has(blockId)) return false
      if (bullet.anchor?.find) return false
      const lower = bullet.text.toLowerCase()
      // A bullet that already covers the gap is keeping the CV strong.
      return !gapTerms.some((term) => lower.includes(term.toLowerCase()))
    })
    .map((bullet) => ({
      bullet,
      blockId: bullet.anchor!.blockId,
      score: relevance(bullet.text, terms),
    }))
    .sort((left, right) => left.score - right.score)
    .slice(0, MAX_TARGETS)
}

function generatedBullets(value: unknown): GeneratedBullet[] {
  if (!isRecord(value) || !Array.isArray(value.bullets)) return []

  return value.bullets
    .flatMap((entry) => {
      if (!isRecord(entry)) return []
      const textValue = text(entry.text, MAX_BULLET_CHARS)
      if (!textValue) return []
      return [
        {
          text: textValue,
          rationale: text(entry.rationale, 240),
          factsUsed: stringList(entry.factsUsed, 6, 160),
        },
      ]
    })
    .slice(0, MAX_BULLETS)
}

function generatedQuestion(value: unknown) {
  if (!isRecord(value)) return ''
  return text(value.question, 300)
}

export async function proposeCvFit(
  input: FitRequest,
  config: ServerConfig,
): Promise<FitResponse> {
  if (!input.docx) throw new FitError('Send the DOCX source with the request.', 400)
  if (input.docx.length > MAX_DOCX_BYTES * 1.4) {
    throw new FitError('That DOCX is larger than 15 MB.', 413)
  }

  const docx = Uint8Array.from(Buffer.from(input.docx, 'base64'))
  const role = findRole(input.cv, input.roleId)
  if (!role) throw new FitError('Choose a role from the CV first.', 400)

  const blocks = await parseDocx(docx)
  const blockMap = new Map(blocks.map((block) => [block.id, block]))
  const gapTerms = [input.gap.label, ...input.gap.terms].filter(Boolean)
  const exclude = new Set(input.excludeBlockIds ?? [])
  const targets = targetCandidates(role, input.jd, gapTerms, exclude).filter((target) => {
    const block = blockMap.get(target.blockId)
    return Boolean(block && block.text.trim() === target.bullet.text.trim())
  })

  if (targets.length === 0) {
    return {
      type: 'no-fit',
      reason:
        'There is no suitable bullet to replace in that role — every bullet already covers the gap or has no editable anchor.',
    }
  }

  const maxChars = Math.min(
    MAX_BULLET_CHARS,
    Math.max(...targets.map((target) => target.bullet.text.length)),
  )

  let reply = ''
  let question = ''
  let bullets: GeneratedBullet[] = []

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await runChat(config, {
      model: config.gemmaModel,
      messages:
        attempt === 1
          ? fitMessages({
              gap: input.gap,
              role,
              message: input.message,
              history: input.history ?? [],
              stories: input.stories ?? [],
              projects: input.cv.projects,
              company: input.company,
              maxChars,
            })
          : [
              ...fitMessages({
                gap: input.gap,
                role,
                message: input.message,
                history: input.history ?? [],
                stories: input.stories ?? [],
                projects: input.cv.projects,
                company: input.company,
                maxChars,
              }),
              { role: 'assistant' as const, content: reply.slice(0, 2000) },
              {
                role: 'user' as const,
                content:
                  'That reply was not a single valid JSON object. Return only the JSON object with bullets or a question, no prose.',
              },
            ],
      maxTokens: 700,
      temperature: 0,
    })

    reply = result.text

    try {
      const value = extractJson(reply)
      bullets = generatedBullets(value)
      question = generatedQuestion(value)
      if (bullets.length > 0 || question) break
    } catch {
      // one repair attempt
    }
  }

  if (bullets.length === 0) {
    if (question) return { type: 'question', question }
    return {
      type: 'no-fit',
      reason: 'I could not draft a truthful bullet from that. Tell me what you built, scaled or shipped.',
    }
  }

  const original = await renderDocxToPdf(docx)
  const before = await measurePdf(original)

  let closest: FitProposal['lineCount'] | null = null

  for (const bullet of bullets) {
    for (const target of targets) {
      let candidate: Uint8Array

      try {
        const edited = await editDocx(docx, [
          { blockId: target.blockId, text: bullet.text },
        ])
        candidate = await renderDocxToPdf(edited.docx)
      } catch {
        continue
      }

      const after = await measurePdf(candidate)
      const lineCount = {
        before: before.lines,
        after: after.lines,
        pagesBefore: before.pages,
        pagesAfter: after.pages,
      }

      if (
        after.lines === before.lines &&
        after.pages === before.pages
      ) {
        return {
          type: 'proposal',
          gapLabel: input.gap.label,
          role: { id: role.id, company: role.company, title: role.title },
          bullet: bullet.text,
          target: { blockId: target.blockId, text: target.bullet.text },
          rationale: bullet.rationale,
          factsUsed: bullet.factsUsed,
          lineCount,
        }
      }

      if (!closest) closest = lineCount
    }
  }

  return {
    type: 'no-fit',
    reason: closest
      ? `That change would move the CV from ${closest.before} to ${closest.after} lines or from ${closest.pagesBefore} to ${closest.pagesAfter} pages. Try a shorter description or another role.`
      : 'That change would not preserve the CV layout. Try a shorter description.',
  }
}
