import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const SOFFICE = process.env.SOFFICE_BIN?.trim() || 'soffice'
const TIMEOUT_MS = 45_000

export class RenderError extends Error {
  readonly status: number

  constructor(message: string, status = 422) {
    super(message)
    this.name = 'RenderError'
    this.status = status
  }
}

/**
 * LibreOffice is the renderer, not Word. It handles page size, margins, styles,
 * tables, images and the fonts installed on this machine. Each job gets its own
 * temporary profile so concurrent conversions do not fight over a lock file.
 */
export async function renderDocxToPdf(input: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), 'caddie-docx-'))
  const inputPath = path.join(dir, 'cv.docx')
  const outDir = path.join(dir, 'out')
  const profileDir = path.join(dir, 'profile')

  try {
    await mkdir(outDir, { recursive: true })
    await mkdir(profileDir, { recursive: true })
    await writeFile(inputPath, input)

    try {
      await execFileAsync(
        SOFFICE,
        [
          '--headless',
          '--norestore',
          '--nolockcheck',
          '--nodefault',
          '--nofirststartwizard',
          `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
          '--convert-to',
          'pdf:writer_pdf_Export',
          '--outdir',
          outDir,
          inputPath,
        ],
        { timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
      )
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new RenderError(
          'The document renderer is not installed on this server.',
          500,
        )
      }
      throw new RenderError(
        'That DOCX could not be rendered. Save it again from Word and retry.',
        422,
      )
    }

    const pdf = await readFile(path.join(outDir, 'cv.pdf'))
    return new Uint8Array(pdf)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
