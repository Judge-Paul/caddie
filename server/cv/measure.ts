import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const TIMEOUT_MS = 15_000

export class MeasureError extends Error {
  readonly status = 500

  constructor(message: string) {
    super(message)
    this.name = 'MeasureError'
  }
}

export type PdfMeasurement = {
  pages: number
  lines: number
}

/**
 * Count rendered pages and non-empty text lines with poppler. This is what
 * decides whether a proposed bullet really preserves the CV's line count;
 * counting characters is not enough because wrapping depends on the renderer.
 */
export async function measurePdf(pdf: Uint8Array): Promise<PdfMeasurement> {
  const dir = await mkdtemp(path.join(tmpdir(), 'caddie-measure-'))
  const file = path.join(dir, 'cv.pdf')

  try {
    await writeFile(file, pdf)

    let info: string
    let text: string

    try {
      info = (
        await execFileAsync('pdfinfo', [file], {
          timeout: TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          encoding: 'utf8',
        })
      ).stdout

      text = (
        await execFileAsync('pdftotext', ['-layout', '-nopgbrk', file, '-'], {
          timeout: TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          encoding: 'utf8',
        })
      ).stdout
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new MeasureError(
          'Line measurement needs poppler (pdfinfo and pdftotext) on the server.',
        )
      }
      throw new MeasureError('The rendered CV could not be measured.')
    }

    const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0)
    if (!Number.isFinite(pages) || pages < 1) {
      throw new MeasureError('The rendered CV has no readable pages.')
    }

    const lines = text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length

    return { pages, lines }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
