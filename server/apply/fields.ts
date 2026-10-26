import type { Page } from 'playwright-core'

export type RawField = {
  /** Index into the snapshot; also stamped on the element for the actor. */
  ref: number
  tag: 'input' | 'select' | 'textarea' | 'button'
  inputType: string | null
  label: string
  name: string | null
  required: boolean
  placeholder: string | null
  options?: string[]
  multiple?: boolean
  accept?: string | null
}

export type RawSubmit = {
  ref: number
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
const SNAPSHOT_SCRIPT = `() => {
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

  const fields = []
  const submits = []
  const radioGroups = new Map()
  let ref = 0

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
      const type = (el.getAttribute('type') || 'submit').toLowerCase()
      if (type === 'submit' || /^(submit|apply( now)?|send( application)?|continue)$/i.test(text)) {
        submits.push(tag(el, { label: text.slice(0, 80) || type }))
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
        radioGroups.set(name, tag(el, {
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
      fields.push(tag(el, {
        tag: 'input', inputType: 'checkbox', label: labelOf(el).slice(0, 120),
        name: el.name || null, required: el.required, placeholder: null,
      }))
      continue
    }

    if (el instanceof HTMLInputElement && el.type === 'file') {
      fields.push(tag(el, {
        tag: 'input', inputType: 'file', label: labelOf(el).slice(0, 120) || 'File upload',
        name: el.name || null, required: el.required, placeholder: null,
        accept: el.accept || null,
      }))
      continue
    }

    if (el instanceof HTMLSelectElement) {
      const options = [...el.options].map((o) => o.text.trim()).filter(Boolean).slice(0, 30)
      fields.push(tag(el, {
        tag: 'select', inputType: null, label: labelOf(el).slice(0, 120),
        name: el.name || null, required: el.required, placeholder: null,
        options, multiple: el.multiple,
      }))
      continue
    }

    if (el instanceof HTMLTextAreaElement) {
      fields.push(tag(el, {
        tag: 'textarea', inputType: null, label: labelOf(el).slice(0, 120),
        name: el.name || null, required: el.required,
        placeholder: el.placeholder?.trim() || null,
      }))
      continue
    }

    if (el instanceof HTMLInputElement) {
      fields.push(tag(el, {
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

export async function snapshotForm(page: Page): Promise<RawSnapshot> {
  const snapshot = (await page.evaluate(
    `(${SNAPSHOT_SCRIPT})()`,
  )) as Omit<RawSnapshot, 'fields'> & { fields: (Omit<RawField, 'ref'> & { ref: number })[] }
  return {
    title: typeof snapshot.title === 'string' ? snapshot.title : '',
    url: typeof snapshot.url === 'string' ? snapshot.url : '',
    fields: Array.isArray(snapshot.fields) ? snapshot.fields : [],
    submits: Array.isArray(snapshot.submits) ? snapshot.submits : [],
  }
}
