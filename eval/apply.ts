/**
 * Form-apply eval: mapping accuracy on live application forms plus a
 * synthetic submit-readiness check. Nothing is ever filled or submitted.
 *
 *   bun run eval:apply                    # all boards + readiness
 *   bun run eval:apply -- --case lever-zoox
 *   bun run eval:apply -- --runs 3        # stability of the Clef mapping
 *
 * Mapping runs real Browserbase sessions, so every case costs session time.
 * Readiness needs no browser: it replays fixed post-submit states through
 * the same Clef question the submit path uses.
 */
import { writeFileSync } from 'node:fs'

import { runClef } from '../server/cloudflare'
import { readConfig } from '../server/env'
import { closeApplySession, openApplySession } from '../server/apply/session'
import { prepareSnapshot } from '../server/apply/fields'
import { decideFields, MAP_CONFIDENCE, type MappedField } from '../server/apply/map'
import { READINESS_QUESTION } from '../server/apply/submit'
import type { ApplicantProfile } from '../shared/account'
import { applyCases, type ApplyCase } from './apply-cases'

const fixtureProfile: ApplicantProfile = {
  phone: '+1 555 0100',
  city: 'Berlin',
  country: 'Germany',
  address: 'Berlin, Germany',
  authorization: 'needs_sponsorship',
  salary: '€80,000',
  noticePeriod: '4 weeks',
  linkedin: 'https://linkedin.com/in/you',
  eeoGender: 'decline',
  eeoVeteran: 'Veteran',
  eeoDisability: 'No',
  eeoRace: null,
}

type ReadinessCase = {
  id: string
  formShowing: boolean
  text: string
  expected: 'submitted' | 'blocked' | 'needs_human'
  note?: string
}

const readinessCases: ReadinessCase[] = [
  {
    id: 'confirm-reference',
    formShowing: false,
    text: 'Thank you for your application! Your reference number is ABC-123. We will review your profile.',
    expected: 'submitted',
  },
  {
    id: 'confirm-short',
    formShowing: false,
    text: 'Application submitted successfully.',
    expected: 'submitted',
  },
  {
    id: 'blocked-errors',
    formShowing: true,
    text: 'There were errors: please correct the highlighted fields. Email is required.',
    expected: 'blocked',
  },
  {
    id: 'blocked-captcha',
    formShowing: true,
    text: 'Please verify you are human. Complete the captcha to continue with your application.',
    expected: 'blocked',
  },
  {
    id: 'confirm-plus-optional-account',
    formShowing: false,
    text: 'Your application has been received. Create an account to track its status.',
    expected: 'submitted',
    note: 'Optional tracking account is not a required step.',
  },
  {
    id: 'needs-account-required',
    formShowing: true,
    text: 'Almost done. You must create an account to complete your application.',
    expected: 'needs_human',
  },
  {
    id: 'ambiguous-empty',
    formShowing: true,
    text: 'Welcome back. Continue where you left off.',
    expected: 'needs_human',
  },
]

type Args = {
  runs: number
  only?: string
  verbose: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { runs: 1, verbose: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--runs' && argv[index + 1]) {
      args.runs = Math.max(1, Math.min(3, Number(argv[index + 1]) || 1))
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

export type EvalMiss = {
  match: string
  got: string | null
  want: string | null
  conf: number
  required: boolean
}

export function missText(miss: EvalMiss) {
  const where =
    miss.got === null && miss.conf === 0 ? 'no field matched' : `got ${miss.got ?? 'null'}`
  return `${miss.match} -> ${where} (want ${miss.want ?? 'null'}, conf ${miss.conf.toFixed(2)}${miss.required ? ', required' : ''})`
}

function scoreFields(
  evalCase: ApplyCase,
  fields: MappedField[],
): { correct: number; total: number; requiredCorrect: number; requiredTotal: number; misses: EvalMiss[]; lowConf: number } {
  let correct = 0
  let requiredCorrect = 0
  let requiredTotal = 0
  const misses: EvalMiss[] = []
  let lowConf = 0

  const norm = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  for (const expectation of evalCase.expected) {
    const candidates = fields.filter((field) =>
      norm(field.label).includes(norm(expectation.match)),
    )
    const found = candidates[expectation.occurrence ? expectation.occurrence - 1 : 0] ?? null
    if (!found) {
      // An expected field that is not found at all is a coverage failure:
      // the board changed and the corpus needs updating.
      misses.push({ match: expectation.match, got: null, want: expectation.key, conf: 0, required: true })
      requiredTotal += 1
      continue
    }
    if (found.required) requiredTotal += 1
    if (found.confidence < MAP_CONFIDENCE) lowConf += 1
    if (found.profileKey === expectation.key) {
      correct += 1
      if (found.required) requiredCorrect += 1
    } else {
      misses.push({
        match: expectation.match,
        got: found.profileKey,
        want: expectation.key,
        conf: found.confidence,
        required: found.required,
      })
    }
  }

  return { correct, total: evalCase.expected.length, requiredCorrect, requiredTotal, misses, lowConf }
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

  const selected = applyCases.filter((entry) => !args.only || entry.id === args.only)
  console.log(`Mapping ${selected.length} form(s), ${args.runs} run(s) each.\n`)

  type Row = {
    caseId: string
    runs: { correct: number; total: number; reqCorrect: number; reqTotal: number; fields: number; latencyMs: number; error?: string }[]
    misses: EvalMiss[]
    mappedLabels?: string[]
  }
  const rows: Row[] = []

  for (const evalCase of selected) {
    const row: Row = { caseId: evalCase.id, runs: [], misses: [] }
    for (let run = 0; run < args.runs; run += 1) {
      const started = Date.now()
      try {
        const session = await openApplySession(config, evalCase.url)
        try {
          const snapshot = await prepareSnapshot(session)
          const fields = await decideFields(config, snapshot, fixtureProfile)
          const scored = scoreFields(evalCase, fields)
          row.runs.push({
            correct: scored.correct,
            total: scored.total,
            reqCorrect: scored.requiredCorrect,
            reqTotal: scored.requiredTotal,
            fields: fields.length,
            latencyMs: Date.now() - started,
          })
          row.misses.push(...scored.misses)
          if (run === 0) {
            row.mappedLabels = fields.map(
              (field) =>
                `${field.label.slice(0, 44)} [${field.kind}${field.required ? ', required' : ''}] -> ${field.profileKey ?? 'null'} (${field.confidence.toFixed(2)})`,
            )
          }
          console.log(
            `${pad(evalCase.id, 22)} run ${run + 1}: ${scored.correct}/${scored.total} fields, required ${scored.requiredCorrect}/${scored.requiredTotal}, ${fields.length} mapped, ${Math.round((Date.now() - started) / 1000)}s`,
          )
          if (args.verbose) {
            for (const miss of scored.misses) console.log(`  MISS ${missText(miss)}`)
            for (const line of row.mappedLabels ?? []) console.log(`  field: ${line}`)
          }
        } finally {
          await closeApplySession(config, session)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        row.runs.push({ correct: 0, total: 0, reqCorrect: 0, reqTotal: 0, fields: 0, latencyMs: Date.now() - started, error: message })
        console.log(`${pad(evalCase.id, 22)} run ${run + 1}: failed — ${message}`)
      }
    }
    rows.push(row)
  }

  console.log('\nReadiness (synthetic post-submit states, no browser):')
  let readinessCorrect = 0
  const readinessTotal = readinessCases.length
  for (const evalCase of readinessCases) {
    let got: string | null = null
    let confidence = 0
    try {
      const result = await runClef(config, {
        state: [
          'URL: https://example.com/applied',
          `Page text:\n${evalCase.text}`,
          `Form still showing: ${evalCase.formShowing ? 'yes' : 'no'}`,
        ].join('\n'),
        questions: { readiness: READINESS_QUESTION },
      })
      const answer = result.answers.readiness
      if (answer?.type === 'choice') {
        got = answer.choice
        confidence = answer.confidence ?? 1
      }
    } catch (error) {
      got = `error: ${error instanceof Error ? error.message : String(error)}`
    }
    // Production gates low-confidence answers to needs_human; score the same.
    const effective =
      confidence < MAP_CONFIDENCE && got !== null && !String(got).startsWith('error:')
        ? 'needs_human'
        : got
    const hit = effective === evalCase.expected
    if (hit) readinessCorrect += 1
    console.log(
      `${pad(evalCase.id, 20)} ${hit ? 'ok' : `MISS got ${got} (want ${evalCase.expected})`} conf ${confidence.toFixed(2)}${effective !== got ? ' gated→needs_human' : ''}`,
    )
  }

  const attempts = rows.flatMap((row) => row.runs.filter((run) => !run.error))
  const total = attempts.reduce((sum, run) => sum + run.total, 0)
  const correct = attempts.reduce((sum, run) => sum + run.correct, 0)
  const reqTotal = attempts.reduce((sum, run) => sum + run.reqTotal, 0)
  const reqCorrect = attempts.reduce((sum, run) => sum + run.reqCorrect, 0)
  const accuracy = total === 0 ? 0 : correct / total
  const reqAccuracy = reqTotal === 0 ? 0 : reqCorrect / reqTotal

  const wrongAndConfident = rows.flatMap((row) => row.misses).filter(
    (miss) => miss.required && miss.conf >= MAP_CONFIDENCE && miss.got !== miss.want,
  ).length

  console.log(`\nMapping accuracy: ${correct}/${total} (${Math.round(accuracy * 100)}%), required ${reqCorrect}/${reqTotal} (${Math.round(reqAccuracy * 100)}%)`)
  console.log(`Readiness: ${readinessCorrect}/${readinessTotal}`)
  console.log(`Wrong-and-confident on required fields: ${wrongAndConfident}`)
  const gate = wrongAndConfident === 0 && readinessCorrect === readinessTotal
  console.log(gate ? 'GATE: PASS — mapping is safe to review; auto still needs the env flag.' : 'GATE: HOLD — fix misses before enabling auto submit.')

  const lines: string[] = []
  lines.push('# Form-apply eval')
  lines.push('')
  lines.push(`Generated ${new Date().toISOString()} · ${args.runs} run(s) per form.`)
  lines.push('')
  lines.push('Mapping runs live Browserbase sessions and never fills or submits.')
  lines.push('')
  lines.push('## Scoreboard')
  lines.push('')
  lines.push('| form | runs | field accuracy | required accuracy | fields mapped |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const row of rows) {
    const ok = row.runs.filter((run) => !run.error)
    const c = ok.reduce((sum, run) => sum + run.correct, 0)
    const t = ok.reduce((sum, run) => sum + run.total, 0)
    const rc = ok.reduce((sum, run) => sum + run.reqCorrect, 0)
    const rt = ok.reduce((sum, run) => sum + run.reqTotal, 0)
    lines.push(
      `| ${row.caseId} | ${ok.length} | ${t ? `${c}/${t} (${Math.round((c / t) * 100)}%)` : 'failed'} | ${rt ? `${rc}/${rt} (${Math.round((rc / rt) * 100)}%)` : '—'} | ${ok.length ? Math.round(mean(ok.map((run) => run.fields))) : '—'} |`,
    )
    for (const run of row.runs) {
      if (run.error) lines.push(`  failed: ${run.error}`)
    }
    for (const miss of row.misses.slice(0, 12)) lines.push(`- miss: ${missText(miss)}`)
  }
  lines.push('')
  lines.push(`Overall mapping: ${correct}/${total} (${Math.round(accuracy * 100)}%), required ${reqCorrect}/${reqTotal} (${Math.round(reqAccuracy * 100)}%).`)
  lines.push(`Wrong-and-confident on required fields: ${wrongAndConfident}.`)
  lines.push(`Readiness: ${readinessCorrect}/${readinessTotal}.`)
  lines.push(gate ? 'Gate: PASS.' : 'Gate: HOLD.')
  lines.push('')

  writeFileSync(new URL('./report-apply.md', import.meta.url), `${lines.join('\n')}\n`)
  console.log('\nWrote eval/report-apply.md')

  process.exit(attempts.length === 0 ? 1 : 0)
}

await main()
