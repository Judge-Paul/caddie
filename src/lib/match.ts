import type { Requirement } from '@shared/jd-classification'
import { cvVocabulary, termKeys, type MatchPiece } from '@/lib/analyze'

/**
 * Score the classified posting against the CV. The classifier decides what the
 * requirements are; this module only decides whether each one appears in the
 * CV, then finds the missing terms in the posting so the reader can mark them.
 *
 * Must-haves carry the score. Nice-to-haves stay in the Data tab: an optional
 * term is not a gap, and turning one red would overstate it.
 */

export type RequirementMatch = {
  requirement: Requirement
  covered: boolean
  missingItems: string[]
}

export type MatchGap = {
  term: string
  key: string
}

export type Score = {
  pieces: MatchPiece[]
  coverage: number | null
  matched: number
  total: number
  gaps: MatchGap[]
}

type Span = { start: number; end: number }

function itemCovered(vocab: Set<string>, item: string) {
  const keys = termKeys(item)
  // Nothing content-bearing to look up: do not invent a gap.
  if (keys.length === 0) return true
  return keys.every((key) => vocab.has(key))
}

export function matchRequirements(
  cvText: string,
  requirements: Requirement[],
): RequirementMatch[] {
  const vocab = cvVocabulary(cvText)

  return requirements.map((requirement) => {
    const items = requirement.items.length > 0 ? requirement.items : [requirement.label]
    const missingItems = items.filter((item) => !itemCovered(vocab, item))
    const any = requirement.combination === 'any' && items.length > 1
    const covered = any ? missingItems.length < items.length : missingItems.length === 0

    return { requirement, covered, missingItems: covered ? [] : missingItems }
  })
}

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-term match, so "Go" does not light up inside "Google". */
function findTerm(text: string, term: string): Span | null {
  const needle = term.trim()
  if (!needle) return null

  // A sentence-ending period is not part of the term, so `.` stays out of the
  // boundary class. `+` and `#` do stay in: "C" must not match inside "C++".
  const pattern = new RegExp(
    `(?<![A-Za-z0-9+#])${escapePattern(needle)}(?![A-Za-z0-9+#])`,
    'i',
  )
  const match = pattern.exec(text)
  return match ? { start: match.index, end: match.index + match[0].length } : null
}

/** The evidence quote can wrap across lines, so match on its words. */
function findQuote(text: string, quote: string): Span | null {
  const words = quote.trim().split(/\s+/).filter(Boolean).map(escapePattern)
  if (words.length === 0) return null

  const match = new RegExp(words.join('\\s+'), 'i').exec(text)
  return match ? { start: match.index, end: match.index + match[0].length } : null
}

function mergeSpans(spans: Span[]) {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: Span[] = []

  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }

  return merged
}

function buildPieces(text: string, spans: Span[]): MatchPiece[] {
  const pieces: MatchPiece[] = []
  let cursor = 0

  for (const span of spans) {
    if (span.start > cursor) {
      pieces.push({ text: text.slice(cursor, span.start), mark: false })
    }
    pieces.push({ text: text.slice(span.start, span.end), mark: true })
    cursor = span.end
  }

  if (cursor < text.length) pieces.push({ text: text.slice(cursor), mark: false })
  return pieces.length > 0 ? pieces : [{ text, mark: false }]
}

export function scoreRequirements(
  cvText: string,
  jdText: string,
  requirements: Requirement[],
): Score {
  const musts = requirements.filter((item) => item.importance === 'must')
  const scored = musts.length > 0 ? musts : requirements
  const matches = matchRequirements(cvText, scored)
  const uncovered = matches.filter((match) => !match.covered)

  const spans: Span[] = []
  const gaps: MatchGap[] = []
  const seen = new Set<string>()

  for (const match of uncovered) {
    const requirement = match.requirement
    let found = false

    for (const item of match.missingItems) {
      const hit = findTerm(jdText, item)
      if (hit) {
        spans.push(hit)
        found = true
      }
    }

    if (!found) {
      const label = findTerm(jdText, requirement.label)
      if (label) {
        spans.push(label)
      } else if (requirement.evidence) {
        const quote = findQuote(jdText, requirement.evidence)
        if (quote) spans.push(quote)
      }
    }

    const term = requirement.label || match.missingItems.join(' or ')
    const key = term.toLowerCase()
    if (term && !seen.has(key)) {
      seen.add(key)
      gaps.push({ term, key })
    }
  }

  const matched = matches.length - uncovered.length
  const total = matches.length

  return {
    pieces: buildPieces(jdText, mergeSpans(spans)),
    coverage: total === 0 ? null : Math.round((matched / total) * 100),
    matched,
    total,
    gaps,
  }
}
