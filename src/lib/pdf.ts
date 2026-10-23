// The legacy build carries polyfills for JavaScript features pdf.js now expects
// (`Map.prototype.getOrInsertComputed`) that stable browsers do not all have yet.
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

const MB = 1024 * 1024
const MAX_CV_BYTES = 20 * MB

export type CvPdf = {
  fileName: string
  pageCount: number
  /** Text pulled from every page, used as the CV side of the matcher. */
  text: string
  doc: PDFDocumentProxy
}

/** An upload we cannot use, with a message safe to show in the UI. */
export class CvPdfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CvPdfError'
  }
}

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export async function loadCvPdf(file: File): Promise<CvPdf> {
  if (!isPdf(file)) {
    throw new CvPdfError('That file is not a PDF. Choose a PDF from your computer.')
  }
  if (file.size > MAX_CV_BYTES) {
    throw new CvPdfError('That PDF is larger than 20 MB. Try a smaller file.')
  }

  const data = new Uint8Array(await file.arrayBuffer())

  let doc: PDFDocumentProxy
  try {
    doc = await getDocument({ data, useSystemFonts: true }).promise
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'PasswordException') {
      throw new CvPdfError('That PDF is password protected, so it cannot be read here.')
    }
    throw new CvPdfError('That PDF could not be opened. Try exporting it again.')
  }

  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    // Text items carry positions but not always the spaces between them, so the
    // whitespace is rebuilt from the geometry: "TypeScript" stays one word and
    // lines do not run together.
    let text = ''
    let previous: { end: number; height: number; y: number } | null = null

    for (const item of content.items) {
      if (!('str' in item)) continue
      const x = item.transform[4]
      const y = item.transform[5]

      if (previous) {
        const sameLine = Math.abs(y - previous.y) <= Math.max(item.height, previous.height) * 0.5
        if (!sameLine) {
          text += '\n'
        } else {
          const gap = x - previous.end
          const space = Math.max(previous.height * 0.18, 0.6)
          if (gap > space || gap < -space) text += ' '
        }
      }

      text += item.str
      previous = { end: x + item.width, height: item.height, y }

      if (item.hasEOL) {
        text += '\n'
        previous = null
      }
    }

    pages.push(text)
  }

  return {
    fileName: file.name,
    pageCount: doc.numPages,
    text: pages.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim(),
    doc,
  }
}
