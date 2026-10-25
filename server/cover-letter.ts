import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { RenderError } from './cv/render'
import { childEnv } from './cv/child-env'
import { withRenderSlot } from './cv/render-queue'

const execFileAsync = promisify(execFile)
const SOFFICE = process.env.SOFFICE_BIN?.trim() || 'soffice'
const TIMEOUT_MS = 45_000

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function paragraphs(text: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export async function renderCoverLetterPdf(text: string) {
  const body = paragraphs(text)
  if (!body) throw new RenderError('There is no cover letter to download.', 422)

  const dir = await mkdtemp(path.join(tmpdir(), 'caddie-letter-'))
  const inputPath = path.join(dir, 'cover-letter.html')
  const outDir = path.join(dir, 'out')
  const profileDir = path.join(dir, 'profile')

  try {
    await mkdir(outDir, { recursive: true })
    await mkdir(profileDir, { recursive: true })
    await writeFile(
      inputPath,
      `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 26mm 24mm; }
body { font-family: Carlito, "Liberation Sans", Arial, sans-serif; color: #111827; font-size: 11pt; line-height: 1.58; }
p { margin: 0 0 1em; }
</style></head><body>${body}</body></html>`,
      'utf8',
    )

    try {
      await withRenderSlot(() =>
        execFileAsync(
          SOFFICE,
          [
            '--headless',
            '--norestore',
            '--nolockcheck',
            '--nodefault',
            '--nofirststartwizard',
            `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
            '--convert-to',
            'pdf:writer_web_pdf_Export',
            '--outdir',
            outDir,
            inputPath,
          ],
          {
            timeout: TIMEOUT_MS,
            killSignal: 'SIGKILL',
            maxBuffer: 1024 * 1024,
            env: childEnv(),
          },
        ),
      )
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new RenderError(
          'The document renderer is not installed on this server.',
          500,
        )
      }
      throw new RenderError('The cover letter PDF could not be rendered.', 422)
    }

    return new Uint8Array(await readFile(path.join(outDir, 'cover-letter.pdf')))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
