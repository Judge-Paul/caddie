/**
 * End-to-end actor test against a synthetic form served as a data: URL.
 * No backend writes, no real submission: the form's own onsubmit handler
 * fakes the confirmation. Covers snapshot, mapping, fill, file upload,
 * submit and the confirmation sniff.
 *
 *   bun run eval:apply-actor [--verbose]
 *
 * Needs BROWSERBASE_API_KEY (one live session) and Cloudflare credentials
 * (one Clef mapping call).
 */
import { readConfig } from '../server/env'
import { openApplySession, closeApplySession } from '../server/apply/session'
import { prepareSnapshot } from '../server/apply/fields'
import { decideFields } from '../server/apply/map'
import {
  clickSubmit,
  detectBlockers,
  performFill,
  selectRemoteFile,
  uploadSessionFile,
  visibleText,
} from '../server/apply/act'
import type { ApplicantProfile } from '../shared/account'

const FORM_HTML = `<!doctype html><html><body>
<h1>Apply</h1>
<form id="f" onsubmit="event.preventDefault();document.getElementById('done').textContent='Thank you! Reference: T-123';return false;">
<label>Full name<input name="name" type="text" required></label>
<label>Email<input name="email" type="email" required></label>
<label>Phone<input name="phone" type="tel" required></label>
<label>Country<select name="country" required><option value="">Select...</option><option>Germany</option><option>France</option></select></label>
<fieldset><legend>Work authorization</legend>
<label><input type="radio" name="auth" value="yes"> Yes, I am authorized</label>
<label><input type="radio" name="auth" value="no"> No</label>
</fieldset>
<label><input type="checkbox" name="terms" required> I agree to the terms</label>
<label><input type="checkbox" name="news"> Send me updates</label>
<label>Resume<input type="file" name="cv" accept=".pdf,.txt"></label>
<button type="submit">Submit application</button>
</form><p id="done"></p>
</body></html>`

const FIXTURE_PROFILE: ApplicantProfile = {
  phone: '+1 555 0100',
  city: 'Berlin',
  country: 'Germany',
  address: 'Berlin, Germany',
  authorization: 'needs_sponsorship',
  salary: '80k',
  noticePeriod: '4 weeks',
  linkedin: 'https://linkedin.com/in/you',
  eeoGender: 'decline',
  eeoVeteran: 'Veteran',
  eeoDisability: 'No',
  eeoRace: null,
}

function pad(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, ' ')
}

async function main() {
  const verbose = process.argv.includes('--verbose')
  const config = readConfig()
  let failures = 0
  const check = (name: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${pad(name, 26)} ${detail}`)
    if (!ok) failures += 1
  }

  const session = await openApplySession(
    config,
    `data:text/html,${encodeURIComponent(FORM_HTML)}`,
  )
  try {
    const snapshot = await prepareSnapshot(session)
    check('snapshot finds fields', snapshot.fields.length === 8, `${snapshot.fields.length} fields`)
    check('snapshot finds submit', snapshot.submits.length >= 1, `${snapshot.submits.length} submits`)

    const frameFor = (ref: number) => {
      const field = snapshot.fields.find((f) => f.ref === ref)
      return (field && session.frames[field.frame]) || session.page
    }

    const fields = await decideFields(config, snapshot, FIXTURE_PROFILE)
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const expectMapped = (label: string, key: string | null) => {
      const found = fields.find((f) => norm(f.label).includes(norm(label)))
      const got = found?.profileKey ?? null
      const ok = got === key
      if (verbose || !ok) {
        console.log(`  map ${JSON.stringify(label)} -> ${got ?? 'null'} (want ${key ?? 'null'})`)
      }
      return ok
    }
    check('map full name', expectMapped('Full name', 'name'))
    check('map email', expectMapped('Email', 'email'))
    check('map phone', expectMapped('Phone', 'phone'))
    check('map country', expectMapped('Country', 'country'))
    check('map resume file', expectMapped('Resume', 'cv_file'))
    check('map terms checkbox', expectMapped('I agree to the terms', null))
    check('no phantom needsYou', fields.filter((f) => f.needsYou).length === 0)

    const byLabel = (s: string) => {
      const found = fields.find((f) => f.label.toLowerCase().includes(s))
      if (!found) throw new Error(`no mapped field matching ${s}`)
      return found
    }
    const fillText = async (label: string, value: string, kind: string) => {
      const f = byLabel(label)
      const r = await performFill(frameFor(f.ref), f.ref, kind, { type: 'text', text: value })
      return r.ok && r.readBack === value
    }
    check('fill full name', await fillText('full name', 'Ada Lovelace', 'text'))
    check('fill email', await fillText('email', 'a@x.com', 'email'))
    check('fill phone', await fillText('phone', '+1 555', 'tel'))

    const country = byLabel('country')
    const selected = await performFill(frameFor(country.ref), country.ref, 'select', {
      type: 'select',
      option: 'Germany',
    })
    check('select country', selected.ok && (selected.readBack ?? '').includes('Germany'))

    const radio = fields.find((f) => f.kind === 'radio-group')
    if (!radio) throw new Error('no radio group mapped')
    const clicked = await performFill(frameFor(radio.ref), radio.ref, 'radio-group', {
      type: 'radio',
      option: 'Yes, I am authorized',
    })
    check('radio auth', clicked.ok)

    const terms = byLabel('i agree')
    const checked = await performFill(frameFor(terms.ref), terms.ref, 'checkbox', { type: 'check' })
    check('check terms', checked.ok)

    const file = fields.find((f) => f.kind === 'file')
    if (!file) throw new Error('no file input mapped')
    const remote = await uploadSessionFile(
      config.browserbaseKey as string,
      session.id,
      'cv.txt',
      new TextEncoder().encode('Ada Lovelace CV'),
    )
    check('upload cv', await selectRemoteFile(frameFor(file.ref), file.ref, remote))

    const blockers = await detectBlockers(session.page)
    check('no blockers', !blockers.loginWall && blockers.captchaFrames === 0)

    const submit = snapshot.submits[0]
    const submitted = await clickSubmit(
      submit ? session.frames[submit.frame] ?? session.page : session.page,
      snapshot.submits,
    )
    void submitted
    const body = await visibleText(session.page)
    check('confirmation shown', body.includes('Thank you!'))
  } finally {
    await closeApplySession(config, session)
  }

  console.log(failures === 0 ? '\nACTOR OK' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
}

await main().catch((error: unknown) => {
  console.log(`failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
