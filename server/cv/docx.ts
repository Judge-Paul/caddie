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

  const unsafe = names.find((name) =>
    /(^|\/)(vbaProject\.bin|vbaData\.xml|activeX|embeddings)\b/i.test(name),
  )
  if (unsafe) {
    throw new DocxError(
      'That DOCX contains macros or embedded objects. Save a clean copy without them.',
      422,
    )
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
 * Replace text in a paragraph while keeping the first affected run's character
 * formatting (font, size, weight, colour). With `find`, only that substring is
 * replaced, so a role title can change without losing the dates beside it.
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
      replaceRange(texts, 0, full.length, edit.text)
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
