import { centerOfRef, refSelector, type CdpPage } from './cdp'

export type FillAction =
  | { type: 'text'; text: string }
  | { type: 'select'; option: string }
  | { type: 'radio'; option: string }
  | { type: 'check' }

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

export async function readBack(
  page: CdpPage,
  refNumber: number,
  kind: string,
): Promise<string | null> {
  const selector = refSelector(refNumber)
  try {
    if (kind === 'select') {
      return await page.evaluate<string>(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!(el instanceof HTMLSelectElement)) return ''; return el.selectedOptions.length ? [...el.selectedOptions].map(o => o.text).join(', ') : ''; })()`,
      )
    }
    if (kind === 'file') {
      const count = await page.evaluate<number>(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el instanceof HTMLInputElement ? (el.files?.length ?? 0) : 0; })()`,
      )
      return count > 0 ? 'attached' : ''
    }
    if (kind === 'checkbox' || kind === 'radio-group') {
      const checked = await page.evaluate<boolean>(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el instanceof HTMLInputElement ? el.checked : false; })()`,
      )
      return checked ? 'checked' : null
    }
    const value = await page.evaluate<string>(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value; return el?.textContent ?? ''; })()`,
    )
    return clean(String(value ?? ''))
  } catch {
    return null
  }
}

async function focusRef(page: CdpPage, refNumber: number) {
  const selector = refSelector(refNumber)
  const focused = await page.evaluate<boolean>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el instanceof HTMLElement) { el.scrollIntoView({ block: 'center' }); el.focus(); return true; }
      return false;
    })()`,
  )
  if (!focused) throw new Error('Field is not available.')
}

async function clickRef(page: CdpPage, refNumber: number) {
  const center = await centerOfRef(page, refNumber)
  if (!center) {
    // Fall back to an in-page click when the element has no box.
    const clicked = await page.evaluate<boolean>(
      `(() => { const el = document.querySelector(${JSON.stringify(refSelector(refNumber))}); if (el instanceof HTMLElement) { el.click(); return true; } return false; })()`,
    )
    if (!clicked) throw new Error('Control is not available.')
    return
  }
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: center.x,
    y: center.y,
    button: 'left',
    clickCount: 1,
  })
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: center.x,
    y: center.y,
    button: 'left',
    clickCount: 1,
  })
}

async function clickOptionByLabel(page: CdpPage, refNumber: number, label: string) {
  const option = label.toLowerCase()
  const clicked = await page.evaluate<boolean>(
    `(() => {
      const root = document.querySelector(${JSON.stringify(refSelector(refNumber))});
      if (!root) return false;
      const scope = root.tagName === 'INPUT' ? (root.closest('form, fieldset, div') ?? document) : root;
      const inputs = [...scope.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
      const byLabel = (input) => {
        const id = input.getAttribute('id');
        const forLabel = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]')?.innerText : '';
        const wrap = input.closest('label')?.innerText ?? '';
        return [forLabel, wrap, input.getAttribute('aria-label') ?? '', input.value ?? ''].join(' ').toLowerCase();
      };
      const match =
        inputs.find((input) => byLabel(input).includes(${JSON.stringify(option)})) ??
        inputs.find((input) => ${JSON.stringify(option)}.includes((input.value ?? '').toLowerCase()));
      if (!match || !(match instanceof HTMLElement)) return false;
      match.scrollIntoView({ block: 'center' });
      match.click();
      return true;
    })()`,
  )
  if (!clicked) throw new Error(`Option "${label}" is not available.`)
}

export async function performFill(
  page: CdpPage,
  refNumber: number,
  kind: string,
  action: FillAction,
): Promise<{ ok: boolean; readBack: string | null }> {
  if (action.type === 'check') {
    await clickRef(page, refNumber)
    const back = await readBack(page, refNumber, kind)
    return { ok: back === 'checked', readBack: back }
  }

  if (action.type === 'radio') {
    await clickOptionByLabel(page, refNumber, action.option)
    return { ok: true, readBack: action.option }
  }

  if (action.type === 'select') {
    const matched = await page.evaluate<string | null>(
      `(() => {
        const el = document.querySelector(${JSON.stringify(refSelector(refNumber))});
        if (!(el instanceof HTMLSelectElement)) return null;
        const want = ${JSON.stringify(action.option.toLowerCase())};
        const match =
          [...el.options].find((o) => o.text.trim().toLowerCase() === want) ??
          [...el.options].find((o) => o.text.toLowerCase().includes(want));
        if (!match) return null;
        el.value = match.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return match.text;
      })()`,
    )
    if (!matched) throw new Error(`Option "${action.option}" is not available.`)
    return { ok: true, readBack: clean(matched) }
  }

  await focusRef(page, refNumber)
  await page.send('Input.insertText', { text: action.text })
  const back = await readBack(page, refNumber, kind)
  return { ok: back !== null && back === clean(action.text), readBack: back }
}

export type Blockers = {
  passwordFields: number
  captchaFrames: number
  loginWall: boolean
}

export async function detectBlockers(page: CdpPage): Promise<Blockers> {
  return page
    .evaluate<Blockers>(
      `(() => {
        const passwordFields = document.querySelectorAll('input[type="password"]').length;
        const captchaFrames = [...document.querySelectorAll('iframe')].filter((f) =>
          /captcha|recaptcha|hcaptcha|turnstile|arkose|friendly/i.test(f.src),
        ).length;
        const text = (document.body?.innerText ?? '').slice(0, 4000);
        const loginWall =
          passwordFields > 0 ||
          /log in to (apply|continue)|sign in to (apply|continue)|create (an|your) account to apply/i.test(text);
        return { passwordFields, captchaFrames, loginWall };
      })()`,
    )
    .catch(() => ({ passwordFields: 0, captchaFrames: 0, loginWall: false }))
}

export async function clickSubmit(
  page: CdpPage,
  submits: { ref: number; label: string }[],
): Promise<{ url: string; navigated: boolean }> {
  const before = await page.evaluate<string>('location.href').catch(() => '')
  if (submits.length > 0) {
    await clickRef(page, submits[0].ref)
  } else {
    await clickOptionByLabelFallback(page)
  }
  await sleep(3_000)
  const after = await page.evaluate<string>('location.href').catch(() => before)
  return { url: after, navigated: after !== before }
}

async function clickOptionByLabelFallback(page: CdpPage) {
  const clicked = await page.evaluate<boolean>(
    `(() => {
      const candidates = [
        ...document.querySelectorAll('button[type="submit"], input[type="submit"]'),
        ...[...document.querySelectorAll('button, a')].filter((el) =>
          /^(submit|apply( now)?|send( application)?)$/i.test((el.innerText ?? '').trim()),
        ),
      ];
      const target = candidates.find((el) => el instanceof HTMLElement);
      if (!target) return false;
      target.scrollIntoView({ block: 'center' });
      target.click();
      return true;
    })()`,
  )
  if (!clicked) throw new Error('No submit control was found.')
}

export async function visibleText(page: CdpPage, maxChars = 4_000) {
  return page
    .evaluate<string>(
      `(() => (document.body?.innerText ?? '').slice(0, ${Math.max(500, Math.min(20_000, maxChars))}))()`,
    )
    .catch(() => '')
}

export async function takeScreenshot(page: CdpPage) {
  const result = (await page.send('Page.captureScreenshot', {
    format: 'png',
  })) as { data?: string }
  if (!result.data) throw new Error('Screenshot failed.')
  return Buffer.from(result.data, 'base64')
}

/**
 * Upload a file into the session, then select it on a file input. Large
 * uploads go through the session uploads API so nothing depends on the
 * machine running this process.
 */
export async function uploadSessionFile(
  browserbaseKey: string,
  sessionId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const form = new FormData()
  form.set('file', new Blob([Buffer.from(bytes).buffer as ArrayBuffer]), fileName)
  const response = await fetch(
    `https://api.browserbase.com/v1/sessions/${sessionId}/uploads`,
    {
      method: 'POST',
      headers: { 'X-BB-API-Key': browserbaseKey },
      body: form,
      signal: AbortSignal.timeout(60_000),
    },
  )
  if (!response.ok) {
    throw new Error('The file could not be staged for upload.')
  }
  return `/tmp/.uploads/${fileName}`
}

export async function selectRemoteFile(
  page: CdpPage,
  refNumber: number,
  remotePath: string,
): Promise<boolean> {
  const doc = (await page.send('DOM.getDocument', { depth: 0 })) as {
    root?: { nodeId?: number }
  }
  const rootId = doc.root?.nodeId
  if (typeof rootId !== 'number') return false
  const found = (await page.send('DOM.querySelector', {
    nodeId: rootId,
    selector: refSelector(refNumber),
  })) as { nodeId?: number }
  if (typeof found.nodeId !== 'number' || found.nodeId === 0) return false
  await page.send('DOM.setFileInputFiles', {
    files: [remotePath],
    nodeId: found.nodeId,
  })
  const back = await readBack(page, refNumber, 'file')
  return back === 'attached'
}
