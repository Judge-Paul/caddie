import { DocxError, MAX_DOCX_BYTES, openDocx } from './docx'
import { renderDocxToPdf } from './render'

export const MAX_CV_BYTES = 20 * 1024 * 1024

export type IngestedCv =
  | { kind: 'pdf'; fileName: string; pdf: Uint8Array }
  | { kind: 'docx'; fileName: string; docx: Uint8Array; pdf: Uint8Array }

export async function ingestCv(input: {
  bytes: Uint8Array
  contentType?: string | null
  fileName?: string | null
}): Promise<IngestedCv> {
  const type = input.contentType ?? ''
  const bytes = input.bytes
  if (bytes.byteLength === 0) throw new DocxError('That CV is empty.', 400)
  if (bytes.byteLength > MAX_CV_BYTES) {
    throw new DocxError('That CV is larger than 20 MB.', 413)
  }

  const fileName = (input.fileName ?? '').trim().slice(0, 120)
  const isPdf =
    /pdf/i.test(type) ||
    (bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46)
  const isDocx =
    /wordprocessingml/i.test(type) || (bytes[0] === 0x50 && bytes[1] === 0x4b)

  if (isPdf) {
    if (
      bytes[0] !== 0x25 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x44 ||
      bytes[3] !== 0x46
    ) {
      throw new DocxError('That file is not a valid PDF.', 415)
    }
    return { kind: 'pdf', fileName: fileName || 'cv.pdf', pdf: bytes }
  }

  if (isDocx) {
    if (bytes.byteLength > MAX_DOCX_BYTES) {
      throw new DocxError('That DOCX is larger than 15 MB.', 413)
    }
    await openDocx(bytes)
    const pdf = await renderDocxToPdf(bytes)
    return {
      kind: 'docx',
      fileName: fileName || 'cv.docx',
      docx: bytes,
      pdf,
    }
  }

  throw new DocxError('Upload a DOCX or PDF CV.', 415)
}
