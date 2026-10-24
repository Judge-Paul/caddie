import type { CvClassificationResponse } from '@shared/cv-classification'

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export class DocxError extends Error {
  readonly status: number

  constructor(message: string, status = 422) {
    super(message)
    this.name = 'DocxError'
    this.status = status
  }
}

export type DocxBlock = {
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
  /** Replace just this substring; omit to replace the whole block. */
  find?: string
}

export type DocxEditResult = {
  docx: Blob
  pdf: Blob
  blocks: DocxBlock[]
}

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null
  return new DocxError(payload?.error ?? fallback, response.status)
}

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000

  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }

  return btoa(binary)
}

function fromBase64(value: string, type: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type })
}

/** Send the DOCX to the local server for LibreOffice rendering. */
export async function convertCvDocx(
  file: File,
  signal?: AbortSignal,
): Promise<Blob> {
  let response: Response

  try {
    response = await fetch('/api/cv/convert', {
      method: 'POST',
      headers: { 'Content-Type': DOCX_MIME },
      body: file,
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new DocxError(
      'Could not reach the CV renderer. Start it with npm run dev and try again.',
      503,
    )
  }

  if (!response.ok) {
    throw await readError(response, 'That DOCX could not be rendered.')
  }

  return response.blob()
}

/** Text blocks and stable anchors, without rendering. */
export async function parseCvDocx(
  file: File,
  signal?: AbortSignal,
): Promise<DocxBlock[]> {
  let response: Response

  try {
    response = await fetch('/api/cv/parse', {
      method: 'POST',
      headers: { 'Content-Type': DOCX_MIME },
      body: file,
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new DocxError('Could not reach the CV parser.', 503)
  }

  if (!response.ok) {
    throw await readError(response, 'That DOCX could not be read.')
  }

  const payload = (await response.json()) as { blocks?: DocxBlock[] }
  return payload.blocks ?? []
}

/** Edit anchored text while keeping the original run formatting. */
export async function editCvDocx(
  file: File,
  edits: DocxEdit[],
  signal?: AbortSignal,
): Promise<DocxEditResult> {
  const docx = toBase64(await file.arrayBuffer())
  let response: Response

  try {
    response = await fetch('/api/cv/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docx, edits }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new DocxError('Could not reach the CV editor.', 503)
  }

  if (!response.ok) {
    throw await readError(response, 'That CV edit was rejected.')
  }

  const payload = (await response.json()) as {
    docx: string
    pdf: string
    blocks: DocxBlock[]
  }

  return {
    docx: fromBase64(payload.docx, DOCX_MIME),
    pdf: fromBase64(payload.pdf, 'application/pdf'),
    blocks: payload.blocks,
  }
}

/** Extract the CV into the anchored `CvClassification` contract. */
export async function classifyCvDocx(
  file: File,
  signal?: AbortSignal,
): Promise<CvClassificationResponse> {
  let response: Response

  try {
    response = await fetch('/api/cv/classify', {
      method: 'POST',
      headers: { 'Content-Type': DOCX_MIME },
      body: file,
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new DocxError('Could not reach the CV classifier.', 503)
  }

  if (!response.ok) {
    throw await readError(response, 'That CV could not be classified.')
  }

  return (await response.json()) as CvClassificationResponse
}
