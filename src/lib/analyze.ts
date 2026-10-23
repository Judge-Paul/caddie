import { SKILL_PHRASES, SKILL_WORDS } from '@/lib/skills'

/**
 * Deterministic JD ↔ CV coverage.
 *
 * Only tokens that look like a requirement are considered:
 *   - a word from the skills lexicon ("react", "postgresql", "typography")
 *   - a phrase from the lexicon ("design system", "a/b testing")
 *   - a tech-shaped token: internal capitals (GraphQL, SaaS) or a digit (D3, B2B)
 *
 * Everything else is prose and is never highlighted, which is what keeps the
 * red marks readable instead of covering half the posting.
 */

const STOPWORDS = new Set(
  `a about above across after again against all also am an and any are as at be because been
  before being below between both but by can could did do does doing down during each few for
  from further had has have having he her here hers herself him himself his how i if in into is
  it its itself just me more most my myself no nor not now of off on once only or other our ours
  ourselves out over own same she should so some such than that the their theirs them themselves
  then there these they this those through to too under until up very was we were what when where
  which while who whom why will with would you your yours yourself yourselves
  able aim also apply building comfortable company collaborative cross deep deliver
  ensure excellent experience familiar familiarity great help ideal ideally including join
  knowledge like looking love lot nice opportunity passion plus proactively professional
  proven role solid strong team teams thing things thrive want want well within work working
  years day days week weeks month months time full part remote hybrid office
  about role what who why how our we you your`
    .split(/\s+/)
    .filter(Boolean),
)

const SYNONYMS: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  nodejs: 'node',
  'node.js': 'node',
  reactjs: 'react',
  'react.js': 'react',
  nextjs: 'next.js',
  vuejs: 'vue',
  gql: 'graphql',
  postgres: 'postgresql',
  psql: 'postgresql',
  k8s: 'kubernetes',
  a11y: 'accessibility',
  i18n: 'internationalization',
  l10n: 'localization',
  'ci/cd': 'cicd',
  cicd: 'cicd',
  'e2e': 'e2e',
  'end-to-end': 'e2e',
  'front-end': 'frontend',
  'back-end': 'backend',
  'full-stack': 'fullstack',
  restful: 'rest',
  apis: 'api',
  'ab-testing': 'a/b testing',
  'unit-testing': 'unit testing',
  'integration-testing': 'integration testing',
  'regression-testing': 'regression testing',
  colour: 'color',
  localisation: 'localization',
  prioritisation: 'prioritization',
  visualisation: 'visualization',
  'three.js': 'threejs',
  wasm: 'webassembly',
}

const WORD_RE = /[A-Za-z0-9][A-Za-z0-9+#.'/-]*/g

type Token = {
  raw: string
  index: number
  end: number
  /** canonical variants worth testing against the CV */
  keys: string[]
  content: boolean
}

type Span = {
  start: number
  end: number
  label: string
  key: string
  covered: boolean
}

export type MatchPiece = {
  text: string
  mark: boolean
}

function stripPunctuation(value: string) {
  return value
    .toLowerCase()
    .replace(/^[^a-z0-9+#]+/, '')
    .replace(/[^a-z0-9+#]+$/, '')
}

function stem(word: string) {
  if (word.length <= 3 || /[0-9+#.]/.test(word)) return word
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`
  if (word.endsWith('sses')) return word.slice(0, -2)
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3)
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
    return word.slice(0, -1)
  }
  return word
}

function canonical(key: string) {
  const normalized = stripPunctuation(key)
  const replaced = SYNONYMS[normalized] ?? normalized
  // multi-word synonym targets ("a/b testing") keep their words intact
  return replaced.includes(' ')
    ? replaced.split(' ').map(stem).join(' ')
    : stem(replaced)
}

function wordKeys(raw: string) {
  const base = stripPunctuation(raw)
  if (!base) return []

  const keys = new Set<string>()
  keys.add(base)
  keys.add(base.replace(/-/g, ''))
  keys.add(SYNONYMS[base] ?? base)

  // "CI/CD", "front-end", "HTML/CSS" -> also consider the parts
  for (const part of base.split(/[/-]/)) {
    if (part.length > 1) keys.add(SYNONYMS[part] ?? part)
  }

  return [...keys].filter(Boolean)
}

function isTechShaped(raw: string) {
  if (/^[A-Z][a-z]+[A-Z]/.test(raw)) return true // GraphQL, SaaS, WebGL
  if (/[A-Za-z]/.test(raw) && /\d/.test(raw)) return true // D3, B2B, ES6
  return false
}

function isCandidate(raw: string, keys: string[]) {
  if (keys.some((key) => SKILL_INDEX.has(canonical(key)))) return true
  return isTechShaped(raw)
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(WORD_RE)].flatMap((match) => {
    // trailing dots and slashes belong to the sentence, not the mark
    const raw = match[0].replace(/[.'/-]+$/, '')
    if (!raw) return []

    const index = match.index ?? 0
    const keys = wordKeys(raw)
    const isSkill = keys.some((key) => SKILL_INDEX.has(canonical(key)))
    const hasWord = /[a-z]/i.test(raw)

    return [
      {
        raw,
        index,
        end: index + raw.length,
        keys,
        content:
          hasWord &&
          (isSkill || keys.some((k) => k.length > 1 && !STOPWORDS.has(k))),
      },
    ]
  })
}

/** Lexicon entries canonicalised the same way as JD tokens. */
const SKILL_INDEX = new Set([...SKILL_WORDS].map((word) => canonical(word)))

const PHRASE_KEYS = new Set(
  SKILL_PHRASES.map((phrase) =>
    phrase.split(/\s+/).map((word) => canonical(word)).join(' '),
  ),
)

function matchedPhraseLength(tokens: Token[], start: number) {
  for (const length of [3, 2]) {
    const window = tokens.slice(start, start + length)
    if (window.length < length) continue
    const key = window.map((token) => canonical(token.raw)).join(' ')
    if (PHRASE_KEYS.has(key)) return length
  }
  return 0
}

function buildCvVocabulary(cvText: string) {
  const vocab = new Set<string>()
  for (const token of tokenize(cvText)) {
    if (!token.content) continue
    for (const key of token.keys) {
      if (key.length > 1 && !STOPWORDS.has(key)) vocab.add(canonical(key))
    }
  }
  return vocab
}

/** The CV's canonical vocabulary, exposed for requirement matching. */
export function cvVocabulary(cvText: string) {
  return buildCvVocabulary(cvText)
}

/**
 * Canonical content words for a requirement term. "Frontend experience" becomes
 * ["frontend"]; "Node.js" becomes ["node"]. The classifier decides what matters,
 * this only normalises it for lookup in the CV.
 */
export function termKeys(term: string): string[] {
  const keys = new Set<string>()

  for (const token of tokenize(term)) {
    if (!token.content) continue
    keys.add(canonical(token.raw))
  }

  return [...keys]
}

function collectSpans(
  text: string,
  tokens: Token[],
  isCovered: (token: Token) => boolean,
): Span[] {
  const spans: Span[] = []

  for (let index = 0; index < tokens.length; ) {
    const phraseLength = matchedPhraseLength(tokens, index)

    if (phraseLength > 0) {
      const window = tokens.slice(index, index + phraseLength)
      spans.push({
        start: index,
        end: index + phraseLength,
        label: text.slice(window[0].index, window[window.length - 1].end),
        key: window.map((token) => canonical(token.raw)).join(' '),
        covered: window.every((token) => !token.content || isCovered(token)),
      })
      index += phraseLength
      continue
    }

    const token = tokens[index]
    if (token && isCandidate(token.raw, token.keys)) {
      spans.push({
        start: index,
        end: index + 1,
        label: token.raw,
        key: canonical(token.raw),
        covered: isCovered(token),
      })
    }
    index += 1
  }

  return spans
}

export type DetectedRequirement = {
  label: string
  key: string
  start: number
  end: number
}

/**
 * Requirement spans on their own, with no CV to compare against. The classifier
 * uses these as candidates: vocabulary decisions stay in `skills.ts`, the model
 * only judges whether each one is required or optional.
 */
export function detectRequirements(text: string): DetectedRequirement[] {
  const tokens = tokenize(text)

  return collectSpans(text, tokens, () => false).map((span) => ({
    label: span.label,
    key: span.key,
    start: tokens[span.start].index,
    end: tokens[span.end - 1].end,
  }))
}

export function flattenCv(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(flattenCv).join(' ')
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map(flattenCv).join(' ')
  }
  return ''
}
