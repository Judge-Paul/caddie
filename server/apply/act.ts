import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Locator, Page } from 'playwright-core'

export type FillAction =
  | { type: 'text'; text: string }
  | { type: 'select'; option: string }
  | { type: 'radio'; option: string }
  | { type: 'check' }
  | { type: 'file'; fileName: string; bytes: Uint8Array }

function ref(page: Page, refNumber: number): Locator {
  return page.locator(`[data-caddie-ref="${refNumber}"]`)
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Human-like pacing between actions so the session does not hammer the form. */
export function pace() {
  return sleep(700 + Math.random() * 900)
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export async function readBack(page: Page, refNumber: number, kind: string) {
  const locator = ref(page, refNumber)
  try {
    if (kind === 'select') {
      const selected = await locator.evaluate((element: unknown) => {
        if (element instanceof HTMLSelectElement) {
          return [...element.selectedOptions].map((option) => option.textContent ?? '')
        }
        return []
      })
      return clean(selected.join(' '))
    }
    if (kind === 'checkbox' || kind === 'radio-group') {
      return null
    }
    if (kind === 'file') {
      const count = await locator.evaluate((element: unknown) => {
        if (element instanceof HTMLInputElement) return element.files?.length ?? 0
        return 0
      })
      return count > 0 ? 'attached' : ''
    }
    const value = await locator.inputValue({ timeout: 2_000 })
    return clean(value)
  } catch {
    return null
  }
}

async function selectByLabel(page: Page, refNumber: number, option: string) {
  const locator = ref(page, refNumber)
  try {
    await locator.selectOption({ label: option }, { timeout: 5_000 })
    return
  } catch {
    // Fall through to a contains-match below.
  }
  const value = await locator
    .evaluate(
      (element: unknown, want: string) => {
        if (!(element instanceof HTMLSelectElement)) return null
        const match =
          [...element.options].find(
            (entry) => entry.text.trim().toLowerCase() === want.toLowerCase(),
          ) ??
          [...element.options].find((entry) =>
            entry.text.toLowerCase().includes(want.toLowerCase()),
          )
        return match ? match.value || match.text : null
      },
      option,
    )
    .catch(() => null)
  if (!value) throw new Error(`Option "${option}" is not available.`)
  await locator.selectOption(value, { timeout: 5_000 })
}

async function clickRadioByLabel(page: Page, label: string) {
  try {
    await page.getByRole('radio', { name: label, exact: true }).first().click({ timeout: 5_000 })
    return
  } catch {
    // Fall through to a contains-match below.
  }
  const clicked = await page
    .getByRole('radio', { name: new RegExp(escapeRegex(label), 'i') })
    .first()
    .click({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
  if (!clicked) throw new Error(`Radio option "${label}" is not available.`)
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function performFill(
  page: Page,
  refNumber: number,
  kind: string,
  action: FillAction,
): Promise<{ ok: boolean; readBack: string | null }> {
  const locator = ref(page, refNumber)

  if (action.type === 'check') {
    await locator.check({ timeout: 5_000 })
    const checked = await locator.isChecked().catch(() => false)
    return { ok: checked, readBack: checked ? 'checked' : null }
  }

  if (action.type === 'radio') {
    await clickRadioByLabel(page, action.option)
    return { ok: true, readBack: action.option }
  }

  if (action.type === 'select') {
    try {
      await locator.selectOption({ label: action.option }, { timeout: 5_000 })
    } catch {
      await selectByLabel(page, refNumber, action.option)
    }
    const back = await readBack(page, refNumber, kind)
    const ok = back !== null && back.toLowerCase().includes(action.option.toLowerCase().slice(0, 12))
    return { ok, readBack: back }
  }

  if (action.type === 'file') {
    const dir = mkdtempSync(join(tmpdir(), 'caddie-apply-'))
    try {
      const localPath = join(dir, action.fileName)
      writeFileSync(localPath, action.bytes)
      await locator.setInputFiles(localPath, { timeout: 30_000 })
      const back = await readBack(page, refNumber, kind)
      return { ok: back === 'attached', readBack: back }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  await locator.fill(action.text, { timeout: 5_000 })
  const back = await readBack(page, refNumber, kind)
  return { ok: back !== null && back === clean(action.text), readBack: back }
}

export type Blockers = {
  passwordFields: number
  captchaFrames: number
  loginWall: boolean
}

/** Deterministic pre-submit gate: logins, passwords and captchas always pause. */
export async function detectBlockers(page: Page): Promise<Blockers> {
  return page
    .evaluate(() => {
      const passwordFields = document.querySelectorAll('input[type="password"]').length
      const captchaFrames = [...document.querySelectorAll('iframe')].filter((frame) =>
        /captcha|recaptcha|hcaptcha|turnstile|arkose|friendly/i.test(frame.src),
      ).length
      const text = (document.body?.innerText ?? '').slice(0, 4_000)
      const loginWall =
        passwordFields > 0 ||
        /log in to (apply|continue)|sign in to (apply|continue)|create (an|your) account to apply/i.test(
          text,
        )
      return { passwordFields, captchaFrames, loginWall }
    })
    .catch(() => ({ passwordFields: 0, captchaFrames: 0, loginWall: false }))
}

export async function clickSubmit(
  page: Page,
  submits: { ref: number; label: string }[],
): Promise<{ url: string; navigated: boolean }> {
  const before = page.url()
  const target =
    submits.length > 0
      ? ref(page, submits[0].ref)
      : page.locator('button[type="submit"], input[type="submit"]').first()
  await target.scrollIntoViewIfNeeded().catch(() => {})
  await target.click({ timeout: 10_000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {})
  await sleep(3_000)
  const after = page.url()
  return { url: after, navigated: after !== before }
}

export async function visibleText(page: Page, maxChars = 4_000) {
  return page
    .evaluate((max: number) => (document.body?.innerText ?? '').slice(0, max), maxChars)
    .catch(() => '')
}

export async function takeScreenshot(page: Page) {
  return Buffer.from(await page.screenshot({ timeout: 15_000 }))
}
