import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import type {
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode,
} from '@xmldom/xmldom'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'

export const MAX_DOCX_BYTES = 15 * 1024 * 1024
const MAX_ENTRIES = 2_000
const MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024
const MAX_RELATIONSHIP_XML_BYTES = 2 * 1024 * 1024

export class DocxError extends Error {
  readonly status: number

  constructor(message: string, status = 422) {
    super(message)
    this.name = 'DocxError'
    this.status = status
  }
}

export type DocxBlock = {
  /** Stable while the document only has text replacements. */
  id: string
  index: number
  text: string
  style: string | null
  list: boolean
  inTable: boolean
  outlineLevel: number | null
  numberingLevel: number | null
  indentLeft: number | null
  bold: boolean
}

export type DocxEdit = {
  blockId: string
  text: string
  /** Replace just this substring inside the block; omit to replace the block. */
  find?: string
}

export type ParsedDocx = {
  zip: JSZip
  document: XmlDocument
  blocks: DocxBlock[]
}

function isWordElement(node: XmlNode | null, name: string) {
  return Boolean(
    node &&
      node.nodeType === 1 &&
      (node as XmlElement).namespaceURI === W_NS &&
      (node as XmlElement).localName === name,
  )
}

function inTable(paragraph: XmlElement) {
  let node: XmlNode | null = paragraph.parentNode
  while (node) {
    if (isWordElement(node, 'tbl')) return true
    node = node.parentNode
  }
  return false
}

function paragraphText(paragraph: XmlElement) {
  let text = ''

  const walk = (node: XmlNode) => {
    if (node.nodeType === 1) {
      const element = node as XmlElement
      if (element.namespaceURI === W_NS) {
        if (element.localName === 't') {
          text += element.textContent ?? ''
          return
        }
        if (element.localName === 'tab') {
          text += ' '
          return
        }
        if (element.localName === 'br' || element.localName === 'cr') {
          text += '\n'
          return
        }
      }
    }

    for (let child = node.firstChild; child; child = child.nextSibling) walk(child)
  }

  walk(paragraph)

  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

function paragraphStyle(paragraph: XmlElement) {
  const style = paragraph.getElementsByTagNameNS(W_NS, 'pStyle')[0]
  return style?.getAttributeNS(W_NS, 'val') ?? null
}

function numericProperty(paragraph: XmlElement, element: string, attribute = 'val') {
  const node = paragraph.getElementsByTagNameNS(W_NS, element)[0]
  const value = Number(node?.getAttributeNS(W_NS, attribute))
  return Number.isFinite(value) ? value : null
}

function outlineLevelOf(paragraph: XmlElement) {
  return numericProperty(paragraph, 'outlineLvl')
}

function numberingLevelOf(paragraph: XmlElement) {
  const numbering = paragraph.getElementsByTagNameNS(W_NS, 'numPr')[0]
  if (!numbering) return null
  return numericProperty(numbering, 'ilvl')
}

function indentLeftOf(paragraph: XmlElement) {
  const indent = paragraph.getElementsByTagNameNS(W_NS, 'ind')[0]
  const value = Number(indent?.getAttributeNS(W_NS, 'left'))
  return Number.isFinite(value) ? value : null
}

function isBold(paragraph: XmlElement) {
  const runs = paragraph.getElementsByTagNameNS(W_NS, 'r')
  return Array.from(runs).some((run) => {
    const bold = run.getElementsByTagNameNS(W_NS, 'b')[0]
    if (!bold) return false
    const value = bold.getAttributeNS(W_NS, 'val')
    return value !== '0' && value !== 'false'
  })
}

function paragraphsOf(document: XmlDocument) {
  return Array.from(document.getElementsByTagNameNS(W_NS, 'p'))
}

function blocksOf(document: XmlDocument): DocxBlock[] {
  return paragraphsOf(document).map((paragraph, index) => ({
    id: `p:${index}`,
    index,
    text: paragraphText(paragraph),
    style: paragraphStyle(paragraph),
    list: paragraph.getElementsByTagNameNS(W_NS, 'numPr').length > 0,
    inTable: inTable(paragraph),
    outlineLevel: outlineLevelOf(paragraph),
    numberingLevel: numberingLevelOf(paragraph),
    indentLeft: indentLeftOf(paragraph),
    bold: isBold(paragraph),
  }))
}

function parseXml(xml: string) {
  const document = new DOMParser().parseFromString(xml, 'text/xml')
  const error = document.getElementsByTagName('parsererror')[0]
  if (error) throw new DocxError('The DOCX contains unreadable document XML.', 422)
  return document
}

/**
 * Open a DOCX and reject the parts we never want to process: macros, embedded
 * objects and ActiveX. The rest is left to LibreOffice behind a size limit.
 */
export async function openDocx(input: Uint8Array): Promise<ParsedDocx> {
  if (input.byteLength === 0) {
    throw new DocxError('That DOCX is empty.', 400)
  }
  if (input.byteLength > MAX_DOCX_BYTES) {
    throw new DocxError('That DOCX is larger than 15 MB.', 413)
  }

  const signature = new TextDecoder().decode(input.slice(0, 4))
  if (signature !== 'PK\u0003\u0004') {
    throw new DocxError('That file is not a DOCX.', 415)
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(input)
  } catch {
    throw new DocxError('That DOCX could not be opened.', 422)
  }

  const names = Object.keys(zip.files)
  if (names.length > MAX_ENTRIES) {
    throw new DocxError('That DOCX contains too many files.', 422)
  }

  let uncompressed = 0
  for (const name of names) {
    const entry = zip.files[name]
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })
      ._data?.uncompressedSize
    if (typeof size === 'number') {
      uncompressed += size
      if (uncompressed > MAX_UNCOMPRESSED_BYTES) {
        throw new DocxError('That DOCX expands to too much data.', 413)
      }
    }
  }

  const unsafe = names.find((name) =>
    /(^|\/)(vbaProject\.bin|vbaData\.xml|activeX|embeddings)\b/i.test(name),
  )
  if (unsafe) {
    throw new DocxError(
      'That DOCX contains macros or embedded objects. Save a clean copy without them.',
      422,
    )
  }

  for (const name of names.filter((entry) =>
    /^word\/_rels\/.*\.rels$/i.test(entry),
  )) {
    const file = zip.file(name)
    if (!file) continue
    const xml = await file.async('string')
    if (xml.length > MAX_RELATIONSHIP_XML_BYTES) {
      throw new DocxError('That DOCX has an oversized relationship file.', 413)
    }
    const rels = parseXml(xml)
    const relationships = rels.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/package/2006/relationships',
      'Relationship',
    )
    for (let index = 0; index < relationships.length; index += 1) {
      const relation = relationships.item(index)
      if (!relation || relation.getAttribute('TargetMode') !== 'External') {
        continue
      }
      const type = relation.getAttribute('Type') ?? ''
      if (!/\/hyperlink$/i.test(type)) {
        throw new DocxError(
          'That DOCX links to external content. Save a normal copy without linked images or templates.',
          422,
        )
      }
    }
  }

  const documentFile = zip.file('word/document.xml')
  if (!documentFile) {
    throw new DocxError('That DOCX has no document body.', 422)
  }

  const xml = await documentFile.async('string')
  if (xml.length > 20 * 1024 * 1024) {
    throw new DocxError('That DOCX document body is too large.', 413)
  }
  if (/<w:altChunk\b/i.test(xml)) {
    throw new DocxError('That DOCX links to external content. Save a normal copy.', 422)
  }

  const document = parseXml(xml)
  return { zip, document, blocks: blocksOf(document) }
}

/** Parse text and anchors without converting to PDF. */
export async function parseDocx(input: Uint8Array): Promise<DocxBlock[]> {
  const { blocks } = await openDocx(input)
  return blocks
}

function editableTexts(paragraph: XmlElement) {
  return Array.from(paragraph.getElementsByTagNameNS(W_NS, 't'))
}

function textOf(texts: XmlElement[]) {
  return texts.map((text) => text.textContent ?? '').join('')
}

type TextEntry = {
  element: XmlElement
  run: XmlElement | null
  hyperlink: XmlElement | null
  value: string
}

function textEntries(paragraph: XmlElement): TextEntry[] {
  return editableTexts(paragraph).map((element) => {
    let run: XmlElement | null = null
    let hyperlink: XmlElement | null = null
    let node: XmlNode | null = element.parentNode

    while (node) {
      if (node.nodeType === 1) {
        const current = node as XmlElement
        if (current.namespaceURI === W_NS) {
          if (current.localName === 'hyperlink') hyperlink = current
          if (current.localName === 'r') {
            run = current
            break
          }
        }
      }
      node = node.parentNode
    }

    return {
      element,
      run,
      hyperlink,
      value: element.textContent ?? '',
    }
  })
}

function stripLinkMarks(run: XmlElement) {
  const properties = run.getElementsByTagNameNS(W_NS, 'rPr')[0]
  if (!properties) return

  for (const name of ['rStyle', 'color', 'u']) {
    for (const node of Array.from(properties.getElementsByTagNameNS(W_NS, name))) {
      node.parentNode?.removeChild(node)
    }
  }
}

function manualBulletPrefix(paragraph: XmlElement, full: string) {
  if (paragraph.getElementsByTagNameNS(W_NS, 'numPr').length > 0) return ''
  return /^(\s*[•▪◦‣·*-]\s+)/.exec(full)?.[1] ?? ''
}

function replaceWholeBlock(paragraph: XmlElement, content: string, prefix: string) {
  const allEntries = textEntries(paragraph)
  const entries = allEntries.filter((entry) => entry.value.trim())
  if (entries.length === 0) {
    throw new DocxError('That block has no text to replace.', 422)
  }

  const prefixKey = prefix.trim()
  const prefixEntry = prefixKey
    ? entries.find((entry) => entry.value.trim() === prefixKey) ?? null
    : null
  const bodyEntries = entries.filter((entry) => entry !== prefixEntry)
  const nonLink = bodyEntries.filter(
    (entry) =>
      !entry.hyperlink &&
      !/^[•▪◦‣·*-]\s*$/.test(entry.value.trim()),
  )
  const chosen = [...(nonLink.length > 0 ? nonLink : bodyEntries)].sort(
    (left, right) => right.value.length - left.value.length,
  )[0]

  if (!chosen?.run) {
    if (prefixEntry?.run) {
      prefixEntry.element.textContent = `${prefixEntry.value}${content}`
      if (/^\s|\s$/.test(prefixEntry.element.textContent ?? '')) {
        prefixEntry.element.setAttributeNS(XML_NS, 'xml:space', 'preserve')
      }
      return
    }
    throw new DocxError('That block has no editable run.', 422)
  }

  let textElement = chosen.element

  if (chosen.hyperlink) {
    const clone = chosen.run.cloneNode(true) as XmlElement
    stripLinkMarks(clone)
    chosen.hyperlink.parentNode?.insertBefore(clone, chosen.hyperlink.nextSibling)
    chosen.hyperlink.removeChild(chosen.run)
    if (!chosen.hyperlink.textContent?.trim()) {
      chosen.hyperlink.parentNode?.removeChild(chosen.hyperlink)
    }
    textElement = clone.getElementsByTagNameNS(W_NS, 't')[0]
  }

  for (const entry of allEntries) {
    if (entry.element !== textElement && entry !== prefixEntry) {
      entry.element.textContent = ''
    }
  }

  if (prefixEntry) {
    prefixEntry.element.textContent = prefix
    textElement.textContent = content
  } else {
    textElement.textContent = prefix ? `${prefix}${content}` : content
  }

  if (/^\s|\s$/.test(textElement.textContent ?? '')) {
    textElement.setAttributeNS(XML_NS, 'xml:space', 'preserve')
  }
}

/**
 * Replace [start, end) in the concatenated run text. The first covered run keeps
 * its character properties, so the new text uses the same font. Surrounding text
 * and its runs are left intact.
 */
function replaceRange(
  texts: XmlElement[],
  start: number,
  end: number,
  next: string,
) {
  let offset = 0
  let inserted = false

  for (const element of texts) {
    const text = element.textContent ?? ''
    const nodeStart = offset
    const nodeEnd = offset + text.length
    offset = nodeEnd

    if (nodeEnd <= start || nodeStart >= end) continue

    const localStart = Math.max(0, start - nodeStart)
    const localEnd = Math.min(text.length, end - nodeStart)
    const before = text.slice(0, localStart)
    const after = text.slice(localEnd)

    element.textContent = inserted ? after : `${before}${next}${after}`
    inserted = true

    const result = element.textContent
    if (/^\s|\s$/.test(result)) {
      element.setAttributeNS(XML_NS, 'xml:space', 'preserve')
    }
  }

  if (!inserted) {
    throw new DocxError('The text to replace was not found in that block.', 422)
  }
}

/**
 * Replace text in a paragraph while keeping a representative body run's
 * character formatting (font, size, weight). With `find`, only that substring
 * is replaced, so a role title can change without losing the dates beside it.
 * Callers address blocks by their stable `p:<index>` id.
 */
export async function editDocx(
  input: Uint8Array,
  edits: DocxEdit[],
): Promise<{ docx: Uint8Array; blocks: DocxBlock[] }> {
  if (edits.length === 0) {
    throw new DocxError('No edits were provided.', 400)
  }
  if (edits.length > 100) {
    throw new DocxError('Too many edits in one request.', 400)
  }

  const { zip, document } = await openDocx(input)
  const paragraphs = paragraphsOf(document)

  for (const edit of edits) {
    const match = /^p:(\d+)$/.exec(edit.blockId)
    if (!match) throw new DocxError(`Unknown block "${edit.blockId}".`, 400)

    const paragraph = paragraphs[Number(match[1])]
    if (!paragraph) throw new DocxError(`Unknown block "${edit.blockId}".`, 400)

    const texts = editableTexts(paragraph)
    if (texts.length === 0) {
      throw new DocxError(
        `Block "${edit.blockId}" has no text to replace.`,
        422,
      )
    }

    const full = textOf(texts)

    if (edit.find) {
      const start = full.indexOf(edit.find)
      if (start === -1) {
        throw new DocxError(
          `"${edit.find}" was not found in block "${edit.blockId}".`,
          422,
        )
      }
      replaceRange(texts, start, start + edit.find.length, edit.text)
    } else {
      const prefix = manualBulletPrefix(paragraph, full)
      const body = edit.text
        .replace(/^\s*[•▪◦‣·*-]\s+/, '')
        .trim()
      replaceWholeBlock(paragraph, body, prefix)
    }
  }

  let xml = new XMLSerializer().serializeToString(document)
  if (!xml.startsWith('<?xml')) {
    xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${xml}`
  }

  zip.file('word/document.xml', xml)
  const docx = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  return { docx, blocks: blocksOf(document) }
}
