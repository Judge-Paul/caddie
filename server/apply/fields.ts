import type { CdpFrame, CdpPage } from './cdp'
import { refreshFrames, type ApplySession } from './session'

export type RawField = {
  /** Index into the snapshot; also stamped on the element for the actor. */
  ref: number
  /** Which attached frame the element lives in. */
  frame: number
  tag: 'input' | 'select' | 'textarea' | 'button'
  inputType: string | null
  label: string
  name: string | null
  required: boolean
  placeholder: string | null
  options?: string[]
  multiple?: boolean
  accept?: string | null
  /** Nearest section heading, for disambiguating repeated labels. */
  section?: string | null
}

export type RawSubmit = {
  ref: number
  frame: number
  label: string
}

export type RawSnapshot = {
  title: string
  url: string
  fields: RawField[]
  submits: RawSubmit[]
}

/**
 * One DOM pass in the page. Tags every interactive element with a stable
 * ref so a later fill step can locate it without re-querying, and returns
 * the descriptors Clef decides on. PII never enters this picture: labels and
 * structure only.
 */
const SNAPSHOT_SCRIPT = `(base) => {
  const labelOf = (el) => {
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const text = labelledBy
        .split(/\\s+/)
        .map((id) => document.getElementById(id)?.innerText ?? '')
        .join(' ')
        .trim()
      if (text) return text
    }
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim()
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
      if (label?.innerText?.trim()) return label.innerText.trim()
    }
    const wrap = el.closest('label')
    if (wrap?.innerText?.trim()) return wrap.innerText.trim()
    if (el.getAttribute('placeholder')) return el.getAttribute('placeholder').trim()
    if (el.getAttribute('name')) return el.getAttribute('name').trim()
    if (el.getAttribute('title')) return el.getAttribute('title').trim()
    return (el.innerText ?? '').trim().slice(0, 120)
  }

  const visible = (el) => {
    if (el.offsetParent !== null) return true
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  const sectionOf = (el) => {
    let node = el
    for (let depth = 0; depth < 4 && node; depth += 1) {
      let sib = node.previousElementSibling
      while (sib) {
        if (sib instanceof HTMLElement && /^(H[1-6]|LEGEND)$/i.test(sib.tagName)) {
          const text = (sib.innerText ?? '').trim()
          if (text) return text.slice(0, 80)
        }
        const head = sib.querySelector?.('h1, h2, h3, h4, legend')
        if (head?.innerText?.trim()) return head.innerText.trim().slice(0, 80)
        sib = sib.previousElementSibling
      }
      node = node.parentElement
    }
    return ''
  }

  const withSection = (el, entry) => {
    const tagged = tag(el, entry)
    try {
      tagged.section = sectionOf(el)
    } catch {
      tagged.section = ''
    }
    return tagged
  }

  const fields = []
  const submits = []
  const radioGroups = new Map()
  let ref = typeof base === 'number' ? base : 0

  const tag = (el, entry) => {
    el.dataset.caddieRef = String(ref)
    entry.ref = ref
    ref += 1
    return entry
  }

  for (const el of document.querySelectorAll('input, select, textarea, button, a')) {
    const tagName = el.tagName.toLowerCase()
    if (el instanceof HTMLInputElement && el.type === 'hidden') continue
    if (el.hasAttribute('disabled')) continue
    if (!visible(el)) continue

    if (el instanceof HTMLAnchorElement) {
      const text = (el.innerText ?? '').trim()
      if (/^(submit|apply( now)?|send( application)?)$/i.test(text)) {
        submits.push(tag(el, { label: text.slice(0, 80) }))
      }
      continue
    }

    if (tagName === 'button') {
      const text = (el.innerText ?? '').trim()
      const type = (el.getAttribute('type') || '').toLowerCase()
      if (
        type === 'submit' ||
        /submit|apply|send application|continue/i.test(text)
      ) {
        submits.push(tag(el, { label: text.slice(0, 80) || type || 'submit' }))
      }
      continue
    }

    if (el instanceof HTMLInputElement && ['submit', 'image'].includes(el.type)) {
      submits.push(tag(el, { label: el.value || el.type }))
      continue
    }

    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const name = el.name || labelOf(el)
      if (!radioGroups.has(name)) {
        radioGroups.set(name, withSection(el, {
          tag: 'input', inputType: 'radio-group', label: name.slice(0, 120),
          name: el.name || null, required: false, placeholder: null, options: [],
        }))
      }
      const group = radioGroups.get(name)
      const option = labelOf(el)
      if (option && !group.options.includes(option)) group.options.push(option)
      if (el.required) group.required = true
      continue
    }

    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      fields.push(withSection(el, {
        tag: 'input', inputType: 'checkbox', label: labelOf(el).slice(0, 120),
        name: el.name || null, required: el.required, placeholder: null,
      }))
      continue
    }

    if (el instanceof HTMLInputElement && el.type === 'file') {
      fields.push(withSection(el, {
        tag: 'input', inputType: 'file', label: labelOf(el).slice(0, 120) || 'File upload',
        name: el.name || null, required: el.required, placeholder: null,
        accept: el.accept || null,
      }))
      continue
    }

    if (el instanceof HTMLSelectElement) {
      const options = [...el.options].map((o) => o.text.trim()).filter(Boolean).slice(0, 30)
      fields.push(withSection(el, {
        tag: 'select', inputType: null, label: labelOf(el).slice(0, 120),
        name: el.name || null, required: el.required, placeholder: null,
        options, multiple: el.multiple,
      }))
      continue
    }

    if (el instanceof HTMLTextAreaElement) {
      fields.push(withSection(el, {
        tag: 'textarea', inputType: null, label: labelOf(el).slice(0, 120),
        name: el.name || null, required: el.required,
        placeholder: el.placeholder?.trim() || null,
      }))
      continue
    }

    if (el instanceof HTMLInputElement) {
      fields.push(withSection(el, {
        tag: 'input', inputType: el.type || 'text', label: labelOf(el).slice(0, 120),
        name: el.name || null, required: el.required,
        placeholder: el.placeholder?.trim() || null,
      }))
      continue
    }
  }

  return {
    title: document.title,
    url: location.href,
    fields: [...radioGroups.values(), ...fields].slice(0, 60),
    submits: submits.slice(0, 4),
  }
}`

type SnapshotWire = {
  title?: unknown
  url?: unknown
  fields?: (Omit<RawField, 'ref' | 'frame'> & { ref: number })[]
  submits?: (Omit<RawSubmit, 'ref' | 'frame'> & { ref: number })[]
}

function withFrame<T extends { ref: number }>(entries: T[] | undefined, frame: number) {
  if (!Array.isArray(entries)) return []
  return entries.map((entry) => ({ ...entry, frame }))
}

/**
 * Waits for SPA-rendered forms, then snapshots every attached frame so
 * embedded application forms are seen too. Refs are unique across frames.
 * Buttons alone do not stop the wait: the fields usually render after them.
 */
export async function snapshotAll(frames: CdpFrame[]): Promise<RawSnapshot> {
  const deadline = Date.now() + 15_000
  for (;;) {
    let count = 0
    for (const frame of frames) {
      count += await frame
        .evaluate<number>(
          'document.querySelectorAll("input, select, textarea").length',
        )
        .catch(() => 0)
    }
    if (count > 0 || Date.now() > deadline) break
    await new Promise((resolve) => setTimeout(resolve, 750))
  }

  let title = ''
  let url = ''
  let ref = 0
  const fields: RawField[] = []
  const submits: RawSubmit[] = []

  for (const [index, frame] of frames.entries()) {
    const snapshot = (await frame
      .evaluate<SnapshotWire>(`(${SNAPSHOT_SCRIPT})(${ref})`)
      .catch(() => null)) as SnapshotWire | null
    if (!snapshot) continue
    if (index === 0) {
      if (typeof snapshot.title === 'string') title = snapshot.title
      if (typeof snapshot.url === 'string') url = snapshot.url
    }
    const frameFields = withFrame(snapshot.fields, index)
    const frameSubmits = withFrame(snapshot.submits, index)
    fields.push(...frameFields)
    submits.push(...frameSubmits)
    ref += frameFields.length + frameSubmits.length
  }

  return {
    title,
    url,
    fields: fields.slice(0, 60),
    submits: submits.slice(0, 4),
  }
}

export async function snapshotForm(page: CdpPage): Promise<RawSnapshot> {
  return snapshotAll([page])
}

const REVEAL_SCRIPT = `(() => {
  const candidates = [...document.querySelectorAll('button, a')].filter((el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.getAttribute('type') === 'submit') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return /^(apply( for this (job|role|position)| now)?|start your application|begin application)$/i.test(
      (el.innerText ?? '').trim(),
    );
  });
  if (candidates.length === 0) return false;
  candidates[0].scrollIntoView({ block: 'center' });
  candidates[0].click();
  return true;
})()`

/**
 * Full read pass: snapshot, and when a board hides the form behind an Apply
 * button, click it and snapshot again. Never submits anything.
 */
export async function prepareSnapshot(session: ApplySession): Promise<RawSnapshot> {
  let snapshot = await snapshotAll(session.frames)
  if (snapshot.fields.length > 0) return snapshot

  for (const frame of session.frames) {
    const clicked = await frame.evaluate<boolean>(REVEAL_SCRIPT).catch(() => false)
    if (!clicked) continue
    await new Promise((resolve) => setTimeout(resolve, 4_000))
    break
  }

  await refreshFrames(session)
  snapshot = await snapshotAll(session.frames)
  return snapshot
}
