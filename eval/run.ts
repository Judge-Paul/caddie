/**
 * Compare classifiers on the same labelled postings.
 *
 *   bun run eval                       # every model, one run each
 *   bun run eval -- --models gemma     # one model
 *   bun run eval -- --runs 3 --verbose # also measure run-to-run stability
 *
 * We do not score price. We score whether the data is right: discrete fields,
 * recall of the labelled requirements, must/nice mix-ups, either-or groups kept
 * intact, and terms that were never in the posting.
 *
 * Recall is measured against a curated core of important requirements rather
 * than every clause, so a classifier is not punished for also noticing the
 * on-call rota or the language requirement.
 */
import { writeFileSync } from 'node:fs'

import type { ClassifyModel, JdClassification } from '../shared/jd-classification'
import { classifyJd } from '../server/classify'
import { CloudflareError } from '../server/cloudflare'
import { cases, type EvalCase, type Expectation } from './corpus'

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'with', 'of', 'for', 'to', 'in', 'on', 'at', 'as', 'by',
  'is', 'are', 'be', 'your', 'our', 'their', 'you', 'we', 'it', 'its', 'from', 'plus',
])

type Args = {
  models: ClassifyModel[]
  runs: number
  only?: string
  verbose: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { models: ['gemma', 'jev'], runs: 1, verbose: false }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--models' && argv[index + 1]) {
      const models = argv[index + 1]
        .split(',')
        .map((model) => model.trim())
        .filter((model): model is ClassifyModel => model === 'gemma' || model === 'jev')
      if (models.length > 0) args.models = models
      index += 1
    } else if (arg === '--runs' && argv[index + 1]) {
      args.runs = Math.max(1, Math.min(5, Number(argv[index + 1]) || 1))
      index += 1
    } else if (arg === '--case' && argv[index + 1]) {
      args.only = argv[index + 1]
      index += 1
    } else if (arg === '--verbose') {
      args.verbose = true
    }
  }

  return args
}

function stem(value: string) {
  if (value.length <= 4) return value
  if (value.endsWith('ing')) return value.slice(0, -3)
  if (value.endsWith('ies')) return `${value.slice(0, -3)}y`
  if (value.endsWith('sses')) return value.slice(0, -2)
  if (value.endsWith('es')) return value.slice(0, -2)
  if (value.endsWith('s') && !value.endsWith('ss')) return value.slice(0, -1)
  return value
}

/** Word tokens, stemmed, so "A/B testing" and "A/B tests" meet in the middle. */
function tokens(term: string) {
  return term
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[^a-z0-9+#.]+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .map(stem)
}

function sameTerm(left: string, right: string) {
  const a = tokens(left)
  const b = tokens(right)
  if (a.length === 0 || b.length === 0) return false

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  const pool = new Set(longer)
  return shorter.every((token) => pool.has(token))
}

/** Does any prediction satisfy this expected term? */
function findMatch(term: string, pool: string[]) {
  return pool.find((candidate) => sameTerm(term, candidate))
}

function recallOf(expected: string[], predicted: string[]) {
  const missing = expected.filter((term) => !findMatch(term, predicted))
  return {
    recall: expected.length === 0 ? 1 : (expected.length - missing.length) / expected.length,
    missing,
  }
}

/** Same alternatives, regardless of "formats" or other trailing words. */
function sameGroup(left: string[], right: string[]) {
  if (left.length !== right.length) return false

  const remaining = [...right]
  for (const item of left) {
    const index = remaining.findIndex((candidate) => sameTerm(item, candidate))
    if (index === -1) return false
    remaining.splice(index, 1)
  }

  return true
}

function scoreGroups(predicted: string[][], expected: string[][]) {
  const matchedPredicted = new Set<number>()
  const matchedExpected = new Set<number>()

  predicted.forEach((group, predictedIndex) => {
    expected.forEach((candidate, expectedIndex) => {
      if (matchedPredicted.has(predictedIndex) || matchedExpected.has(expectedIndex)) return
      if (sameGroup(group, candidate)) {
        matchedPredicted.add(predictedIndex)
        matchedExpected.add(expectedIndex)
      }
    })
  })

  const precision =
    predicted.length === 0 ? (expected.length === 0 ? 1 : 0) : matchedPredicted.size / predicted.length
  const recall = expected.length === 0 ? 1 : matchedExpected.size / expected.length
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

  return {
    f1,
    missing: expected.filter((_, index) => !matchedExpected.has(index)),
    extra: predicted.filter((_, index) => !matchedPredicted.has(index)),
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Is a term actually in the posting? Short terms need a word boundary. */
function appearsIn(term: string, jd: string) {
  const plain = term.toLowerCase()
  if (plain.length >= 6) {
    return jd.toLowerCase().replace(/[^a-z0-9+#.]+/g, '').includes(
      plain.replace(/[^a-z0-9+#.]+/g, ''),
    )
  }
  return new RegExp(`\\b${escapeRegex(plain)}\\b`).test(jd.toLowerCase())
}

type OkRunResult = {
  ok: true
  family: string
  seniority: string
  mode: string
  domain: string
  titleOk: boolean
  mustRecall: number
  missingMust: string[]
  niceRecall: number
  missingNice: string[]
  /** Labelled nice-to-haves promoted to must, and vice versa. */
  mixups: string[]
  groups: ReturnType<typeof scoreGroups>
  hallucinations: string[]
  mustKeys: string[]
  latencyMs: number
  attempts: number
  modelId: string
  requirementCount: number
}

type RunResult = OkRunResult | { ok: false; error: string }

function isOk(result: RunResult): result is OkRunResult {
  return result.ok
}

function expectedOf(expectation: Expectation) {
  return {
    family: expectation.family,
    seniority: expectation.seniority,
    mode: expectation.mode,
    domain: expectation.domain,
    must: expectation.must ?? [],
    nice: expectation.nice ?? [],
    anyOf: expectation.anyOf ?? [],
  }
}

function score(
  result: { data: JdClassification; meta: { latencyMs: number; attempts: number; modelId: string } },
  evalCase: EvalCase,
): OkRunResult {
  const expected = expectedOf(evalCase.expect)
  const { data, meta } = result

  const mustTerms = data.requirements
    .filter((item) => item.importance === 'must')
    .flatMap((item) => item.items)
  const niceTerms = data.requirements
    .filter((item) => item.importance === 'nice')
    .flatMap((item) => item.items)

  const predictedGroups = data.requirements
    .filter((item) => item.combination === 'any' && item.items.length > 1)
    .map((item) => item.items)

  const mustScore = recallOf(expected.must, mustTerms)
  const niceScore = recallOf(expected.nice, niceTerms)

  const mixups = [
    ...expected.nice.filter(
      (term) => !findMatch(term, niceTerms) && Boolean(findMatch(term, mustTerms)),
    ),
    ...expected.must.filter(
      (term) => !findMatch(term, mustTerms) && Boolean(findMatch(term, niceTerms)),
    ),
  ]

  const hallucinations = [...mustTerms, ...niceTerms].filter(
    (term) => !appearsIn(term, evalCase.jd),
  )

  return {
    ok: true,
    family: data.role.family,
    seniority: data.role.seniority,
    mode: data.work.mode,
    domain: data.company.domain,
    titleOk: data.role.title
      .toLowerCase()
      .includes((evalCase.expect.titleIncludes ?? data.role.title).toLowerCase()),
    mustRecall: mustScore.recall,
    missingMust: mustScore.missing,
    niceRecall: niceScore.recall,
    missingNice: niceScore.missing,
    mixups,
    groups: scoreGroups(predictedGroups, expected.anyOf),
    hallucinations,
    mustKeys: [...new Set(mustTerms.map((term) => tokens(term).join(' ')))].sort(),
    latencyMs: meta.latencyMs,
    attempts: meta.attempts,
    modelId: meta.modelId,
    requirementCount: data.requirements.length,
  }
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function pad(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, ' ')
}

const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const selected = cases.filter((entry) => !args.only || entry.id === args.only)
  const stability: number[] = []
  const rows: { caseId: string; model: ClassifyModel; results: RunResult[] }[] = []
  const unavailable: string[] = []

  console.log(
    `Running ${args.models.join(', ')} on ${selected.length} posting(s), ${args.runs} run(s) each.\n`,
  )

  for (const model of args.models) {
    let blocked = false

    for (const evalCase of selected) {
      if (blocked) break
      const results: RunResult[] = []

      for (let run = 0; run < args.runs; run += 1) {
        try {
          results.push(score(await classifyJd(evalCase.jd, model), evalCase))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          results.push({ ok: false, error: message })

          if (error instanceof CloudflareError) {
            if (/credits|balance/i.test(message)) {
              unavailable.push(`${model}: ${message}`)
              blocked = true
            }
            break
          }
        }
      }

      if (results.length === 0) continue
      rows.push({ caseId: evalCase.id, model, results })

      const first = results[0]
      if (!first.ok) {
        console.log(`${pad(evalCase.id, 22)} ${pad(model, 6)} failed: ${first.error}`)
        continue
      }

      console.log(
        `${pad(evalCase.id, 22)} ${pad(model, 6)} must ${percent(first.mustRecall)}  nice ${percent(first.niceRecall)}  anyOf ${percent(first.groups.f1)}  ${first.latencyMs}ms`,
      )

      if (args.verbose) {
        if (first.missingMust.length) console.log(`  missing must: ${first.missingMust.join(', ')}`)
        if (first.missingNice.length) console.log(`  missing nice: ${first.missingNice.join(', ')}`)
        if (first.mixups.length) console.log(`  must/nice mix-up: ${first.mixups.join(', ')}`)
        if (first.groups.missing.length)
          console.log(`  missed or-groups: ${first.groups.missing.map((g) => g.join(' or ')).join(' | ')}`)
        if (first.groups.extra.length)
          console.log(`  invented or-groups: ${first.groups.extra.map((g) => g.join(' or ')).join(' | ')}`)
        if (first.hallucinations.length)
          console.log(`  not in posting: ${first.hallucinations.join(', ')}`)
      }

      for (let index = 1; index < results.length; index += 1) {
        const previous = results[index - 1]
        const current = results[index]
        if (!isOk(previous) || !isOk(current)) continue
        const a = new Set(previous.mustKeys)
        const b = new Set(current.mustKeys)
        const intersection = [...a].filter((value) => b.has(value)).length
        const union = new Set([...a, ...b]).size
        stability.push(union === 0 ? 1 : intersection / union)
      }
    }
  }

  const summary = args.models.map((model) => {
    const modelRows = rows.filter((row) => row.model === model)
    const scored = modelRows.map((row) => ({ row, result: row.results[0] }))
    const ok = scored.filter((entry) => isOk(entry.result))
    const results = ok.map((entry) => entry.result).filter(isOk)

    const fieldChecks = ok.flatMap(({ row, result }) => {
      if (!isOk(result)) return []
      const evalCase = cases.find((entry) => entry.id === row.caseId)
      const expected = evalCase ? expectedOf(evalCase.expect) : null
      if (!expected) return []
      return [
        expected.family ? Number(result.family === expected.family) : null,
        expected.seniority ? Number(result.seniority === expected.seniority) : null,
        expected.mode ? Number(result.mode === expected.mode) : null,
        expected.domain ? Number(result.domain === expected.domain) : null,
      ].filter((value): value is number => value !== null)
    })

    return {
      model,
      cases: modelRows.length,
      succeeded: ok.length,
      fieldAccuracy: mean(fieldChecks),
      mustRecall: mean(results.map((result) => result.mustRecall)),
      niceRecall: mean(results.map((result) => result.niceRecall)),
      mixups: results.reduce((total, result) => total + result.mixups.length, 0),
      groupsF1: mean(results.map((result) => result.groups.f1)),
      hallucinations: results.reduce((total, result) => total + result.hallucinations.length, 0),
      latencyMs: mean(results.map((result) => result.latencyMs)),
      attempts: mean(results.map((result) => result.attempts)),
      modelId: results[0]?.modelId ?? '—',
    }
  })

  console.log('\nSummary')
  for (const entry of summary) {
    console.log(
      `${pad(entry.model, 6)} fields ${percent(entry.fieldAccuracy)}  must recall ${percent(entry.mustRecall)}  nice recall ${percent(entry.niceRecall)}  mix-ups ${entry.mixups}  anyOf ${percent(entry.groupsF1)}  invented ${entry.hallucinations}  ${Math.round(entry.latencyMs)}ms`,
    )
  }

  for (const item of new Set(unavailable)) console.log(`\nUnavailable — ${item}`)

  // --- report ---
  const lines: string[] = []
  lines.push('# JD classification eval')
  lines.push('')
  lines.push(`Generated ${new Date().toISOString()} · ${args.runs} run(s) per posting.`)
  lines.push('')
  lines.push('## Scoreboard')
  lines.push('')
  lines.push(
    '| model | model id | cases | fields | must recall | nice recall | mix-ups | anyOf F1 | invented terms | mean latency |',
  )
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const entry of summary) {
    lines.push(
      `| ${entry.model} | \`${entry.modelId}\` | ${entry.succeeded}/${entry.cases} | ${percent(entry.fieldAccuracy)} | ${percent(entry.mustRecall)} | ${percent(entry.niceRecall)} | ${entry.mixups} | ${percent(entry.groupsF1)} | ${entry.hallucinations} | ${Math.round(entry.latencyMs)} ms |`,
    )
  }
  lines.push('')

  if (unavailable.length > 0) {
    lines.push('## Unavailable models')
    lines.push('')
    for (const item of new Set(unavailable)) lines.push(`- ${item}`)
    lines.push('')
  }

  if (stability.length > 0) {
    lines.push(
      `Run-to-run stability of the must-have set (Jaccard): ${percent(mean(stability))}.`,
    )
    lines.push('')
  }

  lines.push('## Per posting')
  lines.push('')
  for (const row of rows) {
    const first = row.results[0]
    lines.push(`### ${row.caseId} · ${row.model}`)
    lines.push('')
    if (!first.ok) {
      lines.push(`Failed: ${first.error}`)
      lines.push('')
      continue
    }
    lines.push(
      `- fields: family ${first.family}, seniority ${first.seniority}, mode ${first.mode}, domain ${first.domain}${first.titleOk ? '' : ' (title mismatch)'}`,
    )
    lines.push(
      `- must recall ${percent(first.mustRecall)}, nice recall ${percent(first.niceRecall)}, anyOf F1 ${percent(first.groups.f1)}`,
    )
    if (first.missingMust.length) lines.push(`- missing must: ${first.missingMust.join(', ')}`)
    if (first.missingNice.length) lines.push(`- missing nice: ${first.missingNice.join(', ')}`)
    if (first.mixups.length) lines.push(`- must/nice mix-ups: ${first.mixups.join(', ')}`)
    if (first.groups.missing.length)
      lines.push(`- missed either-or groups: ${first.groups.missing.map((g) => g.join(' or ')).join(' | ')}`)
    if (first.groups.extra.length)
      lines.push(`- either-or groups not in the posting: ${first.groups.extra.map((g) => g.join(' or ')).join(' | ')}`)
    if (first.hallucinations.length)
      lines.push(`- terms not in the posting: ${first.hallucinations.join(', ')}`)
    lines.push(
      `- ${first.requirementCount} requirements · ${first.latencyMs} ms · ${first.attempts} call(s)`,
    )
    lines.push('')
  }

  lines.push('## How this is scored')
  lines.push('')
  lines.push('- **fields**: role family, seniority, work mode and domain against each posting\'s label.')
  lines.push(
    '- **must / nice recall**: how much of the labelled core of requirements was found, with phrase-tolerant matching ("modern CSS" satisfies "CSS"). Recall is used instead of precision because the labels cover the important requirements, not every clause.',
  )
  lines.push(
    '- **mix-ups**: labelled nice-to-haves presented as required, and the reverse. This is the cost of over-extraction.',
  )
  lines.push(
    '- **anyOf F1**: either-or groups compared as whole sets, so splitting "React Native or Kotlin" into two requirements loses points, as does inventing one.',
  )
  lines.push('- **invented terms**: extracted terms that do not appear in the posting text at all.')
  lines.push('- Price is not part of the score.')
  lines.push('')

  writeFileSync(new URL('./report.md', import.meta.url), `${lines.join('\n')}\n`)
  console.log('\nWrote eval/report.md')

  process.exit(summary.every((entry) => entry.succeeded === 0) ? 1 : 0)
}

await main()
