/**
 * Compare Telegram routers on the same labelled messages.
 *
 *   bun run eval:router                    # gemma + clef, one run each
 *   bun run eval:router -- --models clef   # one variant
 *   bun run eval:router -- --runs 3        # also measure run-to-run stability
 *
 * Messages the heuristics or the length/code guards already resolve are
 * recorded as front-layer wins and never reach either model: both variants
 * share that layer, so scoring them there would be meaningless. Only the
 * ambiguous subset compares Gemma-JSON against Clef-choice, on intent label
 * accuracy and latency. Payload extraction (queries, URLs) stays in
 * TypeScript and is covered by unit checks, not scored here.
 */
import { writeFileSync } from 'node:fs'

import { CloudflareError } from '../server/cloudflare'
import { readConfig } from '../server/env'
import {
  looksLikeCode,
  matchHeuristic,
  routeTelegramClef,
  routeTelegramModelGemma,
  type TelegramIntent,
} from '../server/telegram/router'
import { routerCases, type RouterCase } from './router-cases'

type Variant = 'gemma' | 'clef'

type Args = {
  models: Variant[]
  runs: number
  only?: string
  verbose: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { models: ['gemma', 'clef'], runs: 1, verbose: false }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--models' && argv[index + 1]) {
      const models = argv[index + 1]
        .split(',')
        .map((model) => model.trim())
        .filter((model): model is Variant => model === 'gemma' || model === 'clef')
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

function pad(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, ' ')
}

const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length

function wanted(evalCase: RouterCase): TelegramIntent['type'][] {
  return Array.isArray(evalCase.expected) ? evalCase.expected : [evalCase.expected]
}

type ModelRun = {
  ok: boolean
  got: TelegramIntent['type'] | null
  ms: number
  confidence?: number
  error?: string
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let config: ReturnType<typeof readConfig>
  try {
    config = readConfig()
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  const selected = routerCases.filter((entry) => !args.only || entry.id === args.only)
  const unavailable: string[] = []
  let heuristicWins = 0
  let guardWins = 0

  type Row = {
    caseId: string
    front: string
    frontOk: boolean
    gemma: ModelRun[]
    clef: ModelRun[]
  }
  const rows: Row[] = []

  console.log(
    `Routing ${args.models.join(', ')} on ${selected.length} message(s), ${args.runs} run(s) each.\n`,
  )

  for (const evalCase of selected) {
    const text = evalCase.text.trim()
    const history = evalCase.history ?? []
    let front = ''
    let frontType: TelegramIntent['type'] | null = null

    if (looksLikeCode(text)) {
      front = 'guard:out_of_scope'
      frontType = 'out_of_scope'
    } else if (text.length > 220) {
      front = 'guard:new_application'
      frontType = 'new_application'
    } else {
      const direct = matchHeuristic(text, evalCase.active, evalCase.state)
      if (direct) {
        front = `heuristic:${direct.type}`
        frontType = direct.type
      }
    }

    const row: Row = {
      caseId: evalCase.id,
      front: front || 'model',
      frontOk: false,
      gemma: [],
      clef: [],
    }

    if (front) {
      const ok = frontType !== null && wanted(evalCase).includes(frontType)
      row.frontOk = ok
      if (front.startsWith('heuristic')) heuristicWins += 1
      else guardWins += 1
      rows.push(row)
      console.log(
        `${pad(evalCase.id, 20)} ${pad(front, 26)} ${ok ? 'ok' : `MISS (want ${wanted(evalCase).join('/')})`}`,
      )
      continue
    }

    let blocked = false
    for (const model of args.models) {
      if (blocked) break
      const runs: ModelRun[] = []

      for (let run = 0; run < args.runs; run += 1) {
        const started = Date.now()
        try {
          if (model === 'gemma') {
            const intent = await routeTelegramModelGemma(config, {
              text,
              active: evalCase.active,
              state: evalCase.state,
              history,
            })
            runs.push({ ok: true, got: intent.type, ms: Date.now() - started })
          } else {
            const result = await routeTelegramClef(config, {
              text,
              active: evalCase.active,
              state: evalCase.state,
              history,
            })
            runs.push({
              ok: true,
              got: result.intent?.type ?? null,
              ms: Date.now() - started,
              confidence: result.confidence,
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          runs.push({ ok: false, got: null, ms: Date.now() - started, error: message })
          if (error instanceof CloudflareError && /credits|balance/i.test(message)) {
            unavailable.push(`${model}: ${message}`)
            blocked = true
          }
          break
        }
      }

      if (model === 'gemma') row.gemma = runs
      else row.clef = runs

      const first = runs[0]
      const verdict = !first.ok
        ? `failed: ${first.error}`
        : wanted(evalCase).includes(first.got as TelegramIntent['type'])
          ? 'ok'
          : `MISS got ${first.got} (want ${wanted(evalCase).join('/')})`
      console.log(
        `${pad(evalCase.id, 20)} ${pad(model, 26)} ${verdict} ${first.ok ? `${first.ms}ms` : ''}${first.confidence !== undefined ? ` conf ${first.confidence.toFixed(2)}` : ''}`,
      )
      if (args.verbose && first.ok && first.got && !wanted(evalCase).includes(first.got)) {
        console.log(`  text: ${JSON.stringify(text.slice(0, 120))}`)
      }
    }

    rows.push(row)
  }

  type Summary = {
    model: string
    reached: number
    correct: number
    accuracy: string
    ms: number
    failures: number
    conf: string
  }
  const summary: Summary[] = args.models.map((model) => {
    let reached = 0
    let correct = 0
    let failures = 0
    const latencies: number[] = []
    const confidences: number[] = []
    for (const row of rows) {
      const evalCase = routerCases.find((entry) => entry.id === row.caseId)!
      const runs = model === 'gemma' ? row.gemma : row.clef
      for (const run of runs) {
        reached += 1
        if (!run.ok) {
          failures += 1
          continue
        }
        latencies.push(run.ms)
        if (run.confidence !== undefined) confidences.push(run.confidence)
        if (run.got !== null && wanted(evalCase).includes(run.got)) correct += 1
      }
    }
    return {
      model,
      reached,
      correct,
      accuracy: reached === 0 ? '—' : `${Math.round((correct / reached) * 100)}%`,
      ms: Math.round(mean(latencies)),
      failures,
      conf:
        confidences.length === 0
          ? '—'
          : `mean ${mean(confidences).toFixed(2)}, >=0.45 ${confidences.filter((value) => value >= 0.45).length}/${confidences.length}`,
    }
  })

  console.log('\nSummary (ambiguous subset only; heuristics and guards resolve the rest)')
  console.log(`Front layer: ${heuristicWins} heuristic wins, ${guardWins} guard wins.`)
  for (const entry of summary) {
    console.log(
      `${pad(entry.model, 6)} reached ${entry.reached}  accuracy ${entry.accuracy}  mean ${entry.ms}ms  failures ${entry.failures}  confidence ${entry.conf}`,
    )
  }

  for (const item of new Set(unavailable)) console.log(`\nUnavailable — ${item}`)

  // --- report ---
  const lines: string[] = []
  lines.push('# Telegram router eval')
  lines.push('')
  lines.push(`Generated ${new Date().toISOString()} · ${args.runs} run(s) per message.`)
  lines.push('')
  lines.push(
    'Models are compared only on messages the heuristics and guards leave unresolved; both variants share that front layer.',
  )
  lines.push('')
  lines.push('## Scoreboard')
  lines.push('')
  lines.push('| variant | reached | accuracy | mean latency | failures | confidence |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const entry of summary) {
    lines.push(
      `| ${entry.model} | ${entry.reached} | ${entry.accuracy} | ${entry.ms} ms | ${entry.failures} | ${entry.conf} |`,
    )
  }
  lines.push('')
  lines.push(`Front layer: ${heuristicWins} heuristic wins, ${guardWins} guard wins.`)
  lines.push('')
  lines.push('## Per message')
  lines.push('')
  for (const row of rows) {
    const evalCase = routerCases.find((entry) => entry.id === row.caseId)!
    lines.push(`### ${row.caseId} (want ${wanted(evalCase).join('/')})`)
    lines.push('')
    lines.push(`Front: ${row.front}${row.front.startsWith('model') ? '' : row.frontOk ? ' — ok' : ' — MISS'}`)
    for (const model of args.models) {
      const runs = model === 'gemma' ? row.gemma : row.clef
      for (const run of runs) {
        if (!run.ok) {
          lines.push(`- ${model}: failed — ${run.error}`)
          continue
        }
        const hit = run.got !== null && wanted(evalCase).includes(run.got)
        lines.push(
          `- ${model}: ${run.got ?? 'null'}${hit ? '' : ' — MISS'} · ${run.ms} ms${run.confidence !== undefined ? ` · conf ${run.confidence.toFixed(2)}` : ''}`,
        )
      }
    }
    lines.push('')
  }

  writeFileSync(new URL('./report-router.md', import.meta.url), `${lines.join('\n')}\n`)
  console.log('\nWrote eval/report-router.md')

  process.exit(summary.every((entry) => entry.reached === entry.failures) ? 1 : 0)
}

await main()
