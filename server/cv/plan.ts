import type { CvPlanEdit, CvPlanRequest, CvPlanResponse } from '../../shared/cv-plan'
import type { CvMapTarget } from '../../shared/cv-map'
import { buildCvMap } from '../../shared/cv-map'
import { auditCv } from '../../shared/cv-audit'
import type { CvTargetAudit } from '../../shared/cv-audit'
import { extractJson } from '../../shared/jd-classification'
import { runChat } from '../cloudflare'
import type { ServerConfig } from '../env'
import { FitError } from './fit'
import { editDocx, parseDocx, MAX_DOCX_BYTES } from './docx'
import { measurePdf } from './measure'
import { renderDocxToPdf } from './render'
import { planMessages } from './plan-prompt'

const MAX_EDITS = 3
const MAX_BULLET_CHARS = 240
const MAX_TARGETS = 14
const MAX_ATTEMPTS = 2

type GeneratedEdit = {
  blockId: string
  text: string
  gapLabels: string[]
  rationale: string
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

function targetLabel(target: CvMapTarget, map: ReturnType<typeof buildCvMap>) {
  for (const role of map.roles) {
    if (role.id === target.roleId) {
      const project = role.projects.find((entry) => entry.id === target.projectId)
      return project
        ? `${[role.company, role.title].filter(Boolean).join(' / ')} / ${project.name ?? 'Project'}`
        : [role.company, role.title].filter(Boolean).join(' / ') || 'Role'
    }
  }
  return map.orphanProjects.find((entry) => entry.id === target.projectId)?.name ?? 'Project'
}

function parseEdits(
  value: unknown,
  targets: Map<string, CvTargetAudit>,
): GeneratedEdit[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.edits)) return []

  const edits: GeneratedEdit[] = []
  const seen = new Set<string>()
  for (const entry of record.edits) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const blockId = text(item.blockId, 40)
    const bullet = text(item.text, MAX_BULLET_CHARS)
    if (!blockId || !bullet || seen.has(blockId) || !targets.has(blockId)) continue
    const target = targets.get(blockId)!.target
    const minChars = Math.max(30, Math.floor(target.text.length * 0.9))
    if (bullet.length < minChars) continue
    seen.add(blockId)
    edits.push({
      blockId,
      text: bullet,
      gapLabels: stringList(item.gapLabels, 4, 100),
      rationale: text(item.rationale, 300),
    })
    if (edits.length >= MAX_EDITS) break
  }
  return edits
}

function combinations<T>(items: T[]) {
  const result: T[][] = []
  const total = 1 << items.length
  for (let mask = 1; mask < total; mask += 1) {
    const next = items.filter((_, index) => mask & (1 << index))
    result.push(next)
  }
  return result.sort((left, right) => right.length - left.length)
}

export async function planCv(
  input: CvPlanRequest,
  config: ServerConfig,
): Promise<CvPlanResponse> {
  if (!input.docx) throw new FitError('Send the DOCX source with the request.', 400)
  if (input.docx.length > MAX_DOCX_BYTES * 1.4) {
    throw new FitError('That DOCX is larger than 15 MB.', 413)
  }

  const docx = Uint8Array.from(Buffer.from(input.docx, 'base64'))
  await parseDocx(docx)
  const map = buildCvMap(input.cv)
  const audit = auditCv(map, input.jd.requirements)
  const excluded = new Set(input.excludeBlockIds ?? [])
  const candidates = audit.swapTargets
    .filter((entry) => !excluded.has(entry.target.blockId as string))
    .slice(0, MAX_TARGETS)
  const targetMap = new Map<string, CvTargetAudit>(
    candidates.map((entry) => [entry.target.blockId as string, entry]),
  )

  if (candidates.length === 0) {
    return {
      type: 'no-fit',
      reason: 'There are no safe whole-block targets left in this CV, or every role/project bullet is protecting a must-have.',
    }
  }

  let reply = ''
  let edits: GeneratedEdit[] = []
  let question = ''
  let noFit = ''

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await runChat(config, {
      model: config.gemmaModel,
      messages:
        attempt === 1
          ? planMessages({
              map,
              jd: input.jd,
              company: input.company ?? null,
              gaps: input.gaps,
              message: input.message,
              history: input.history ?? [],
              stories: input.stories ?? [],
              candidates,
            })
          : [
              ...planMessages({
                map,
                jd: input.jd,
                company: input.company ?? null,
                gaps: input.gaps,
                message: input.message,
                history: input.history ?? [],
                stories: input.stories ?? [],
                candidates,
              }),
              { role: 'assistant' as const, content: reply.slice(0, 3000) },
              {
                role: 'user' as const,
                content:
                  'That reply was not one usable JSON plan or question. Return only the requested JSON object.',
              },
            ],
      maxTokens: 1000,
      temperature: 0.1,
    })
    reply = result.text

    try {
      const value = extractJson(reply)
      if (!value || typeof value !== 'object') throw new Error('Not an object')
      const record = value as Record<string, unknown>
      if (record.type === 'question') {
        question = text(record.question, 300)
        break
      }
      if (record.type === 'no-fit') {
        noFit = text(record.reason, 400)
        break
      }
      edits = parseEdits(record, targetMap)
      if (edits.length > 0) break
    } catch {
      // retry once with a repair message
    }
  }

  if (question) return { type: 'question', question }
  if (noFit) return { type: 'no-fit', reason: noFit }
  if (edits.length === 0) {
    return {
      type: 'no-fit',
      reason:
        'Add one concrete detail about what you built, the tool you used or the outcome. The replacement has to fill the original line without changing the layout.',
    }
  }

  const original = await renderDocxToPdf(docx)
  const before = await measurePdf(original)
  let closest: { lines: number; pages: number; edits: GeneratedEdit[] } | null = null

  for (const subset of combinations(edits)) {
    let candidate: Uint8Array
    try {
      const edited = await editDocx(
        docx,
        subset.map((edit) => ({ blockId: edit.blockId, text: edit.text })),
      )
      candidate = await renderDocxToPdf(edited.docx)
    } catch {
      continue
    }

    const after = await measurePdf(candidate)
    if (!closest) closest = { lines: after.lines, pages: after.pages, edits: subset }
    if (after.lines === before.lines && after.pages === before.pages) {
      const next: CvPlanEdit[] = subset.map((edit) => {
        const target = targetMap.get(edit.blockId)!.target
        return {
          blockId: edit.blockId,
          targetText: target.text,
          text: edit.text,
          roleId: target.roleId,
          projectId: target.projectId,
          targetLabel: targetLabel(target, map),
          gapLabels: edit.gapLabels,
          rationale: edit.rationale,
        }
      })

      return {
        type: 'plan',
        edits: next,
        lineCount: {
          before: before.lines,
          after: after.lines,
          pagesBefore: before.pages,
          pagesAfter: after.pages,
        },
        protectedCount: audit.protectedBlockIds.length,
        note:
          subset.length < edits.length
            ? 'Kept the edits that preserve the current page and line count.'
            : 'This plan preserves the current page and line count.',
      }
    }
  }

  return {
    type: 'no-fit',
    reason: closest
      ? `That plan would move the CV from ${before.lines} to ${closest.lines} lines or from ${before.pages} to ${closest.pages} pages. Try a shorter description or another target.`
      : 'That plan would not preserve the CV layout.',
  }
}
