import type { Requirement, Signal } from '@shared/jd-classification'
import {
  cvIndex,
  termSequence,
  type CvIndex,
  type MatchPiece,
} from '@/lib/analyze'

/**
 * Score the classified posting against the CV. Must-haves carry the score and
 * turn red when missing. Nice-to-haves and implied relevant experience stay out
 * of the score and turn amber as "worth showing".
 */

export type RequirementMatch = {
  requirement: Requirement
  covered: boolean
  missingTerms: string[]
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
  related: MatchGap[]
}

type Span = { start: number; end: number; kind: 'gap' | 'related' }
type Locatable = { label: string; evidence: string }

function itemCovered(index: CvIndex, item: string) {
  const words = termSequence(item)
  // Nothing content-bearing to look up: do not invent a gap.
  if (words.length === 0) return true

  // A multi-word term must appear as a phrase. A bag-of-words lookup would let
  // "English (native)" satisfy "React Native".
  if (words.length === 1) return index.vocab.has(words[0])
  return index.phrases.has(words.join(' '))
}

function termsOf(requirement: Requirement) {
  return requirement.match.length > 0 ? requirement.match : requirement.items
}

function coverageOf(index: CvIndex, terms: string[], any: boolean) {
  const missingTerms = terms.filter((term) => !itemCovered(index, term))
  const covered = any ? missingTerms.length < terms.length : missingTerms.length === 0
  return { covered, missingTerms: covered ? [] : missingTerms }
}

function matchRequirementList(
  index: CvIndex,
  requirements: Requirement[],
): RequirementMatch[] {
  return requirements.map((requirement) => {
    const terms = termsOf(requirement)
    // `match` holds evidence alternatives, so any one can satisfy it. Without
    // match terms, fall back to the posting's own either-or grouping.
    const any = requirement.match.length > 0 || requirement.combination === 'any'
    const { covered, missingTerms } = coverageOf(index, terms, any)
    return { requirement, covered, missingTerms }
  })
}

export function matchRequirements(
  cvText: string,
  requirements: Requirement[],
): RequirementMatch[] {
  return matchRequirementList(cvIndex(cvText), requirements)
}

function signalCovered(index: CvIndex, signal: Signal) {
  return signal.terms.some((term) => itemCovered(index, term))
}

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-term match, so "Go" does not light up inside "Google". */
function findTerm(text: string, term: string): { start: number; end: number } | null {
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
function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const words = quote.trim().split(/\s+/).filter(Boolean).map(escapePattern)
  if (words.length === 0) return null

  const match = new RegExp(words.join('\\s+'), 'i').exec(text)
  return match ? { start: match.index, end: match.index + match[0].length } : null
}

function locateTermGroup(text: string, terms: string[], item: Locatable) {
  const spans: { start: number; end: number }[] = []
  let found = false

  for (const term of terms) {
    const hit = findTerm(text, term)
    if (hit) {
      spans.push(hit)
      found = true
    }
  }

  if (!found) {
    const label = findTerm(text, item.label)
    if (label) spans.push(label)
    else if (item.evidence) {
      const quote = findQuote(text, item.evidence)
      if (quote) spans.push(quote)
    }
  }

  return spans
}

/** Sort by position, merge overlaps, and let red win over amber. */
function mergeSpans(spans: Span[]) {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: Span[] = []

  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
      if (span.kind === 'gap') last.kind = 'gap'
    } else {
      merged.push({ ...span })
    }
  }

  return merged
}

function buildPieces(text: string, spans: Span[]): MatchPiece[] {
  const pieces: MatchPiece[] = []
  let cursor = 0

  for (const span of spans) {
    if (span.start > cursor) {
      pieces.push({ text: text.slice(cursor, span.start), mark: null })
    }
    pieces.push({ text: text.slice(span.start, span.end), mark: span.kind })
    cursor = span.end
  }

  if (cursor < text.length) pieces.push({ text: text.slice(cursor), mark: null })
  return pieces.length > 0 ? pieces : [{ text, mark: null }]
}

export function scoreRequirements(
  cvText: string,
  jdText: string,
  requirements: Requirement[],
  signals: Signal[] = [],
): Score {
  const index = cvIndex(cvText)

  const musts = requirements.filter((item) => item.importance === 'must')
  const scored = musts.length > 0 ? musts : requirements
  const nices = musts.length > 0 ? requirements.filter((item) => item.importance === 'nice') : []

  const matches = matchRequirementList(index, scored)
  const uncovered = matches.filter((match) => !match.covered)
  const uncoveredNice = nices
    .map((requirement) => ({
      requirement,
      ...coverageOf(
        index,
        termsOf(requirement),
        requirement.match.length > 0 || requirement.combination === 'any',
      ),
    }))
    .filter((entry) => !entry.covered)
  const uncoveredSignals = signals.filter((signal) => !signalCovered(index, signal))

  const spans: Span[] = []
  const gaps: MatchGap[] = []
  const related: MatchGap[] = []
  const gapKeys = new Set<string>()
  const relatedKeys = new Set<string>()

  for (const match of uncovered) {
    for (const span of locateTermGroup(jdText, match.missingTerms, match.requirement)) {
      spans.push({ ...span, kind: 'gap' })
    }

    const term = match.requirement.label || match.missingTerms.join(' or ')
    const key = term.toLowerCase()
    if (term && !gapKeys.has(key)) {
      gapKeys.add(key)
      gaps.push({ term, key })
    }
  }

  for (const entry of uncoveredNice) {
    for (const span of locateTermGroup(
      jdText,
      entry.missingTerms,
      entry.requirement,
    )) {
      spans.push({ ...span, kind: 'related' })
    }

    const term = entry.requirement.label
    const key = term.toLowerCase()
    if (term && !gapKeys.has(key) && !relatedKeys.has(key)) {
      relatedKeys.add(key)
      related.push({ term, key })
    }
  }

  for (const signal of uncoveredSignals) {
    for (const span of locateTermGroup(jdText, signal.terms, signal)) {
      spans.push({ ...span, kind: 'related' })
    }

    const key = signal.label.toLowerCase()
    if (!gapKeys.has(key) && !relatedKeys.has(key)) {
      relatedKeys.add(key)
      related.push({ term: signal.label, key })
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
    related,
  }
}
