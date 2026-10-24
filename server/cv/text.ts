import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { AccountError } from '../account'

const execFileAsync = promisify(execFile)
const TIMEOUT_MS = 20_000

export async function extractPdfText(pdf: Uint8Array) {
  const dir = await mkdtemp(path.join(tmpdir(), 'caddie-text-'))
  const file = path.join(dir, 'cv.pdf')

  try {
    await writeFile(file, pdf)
    const { stdout } = await execFileAsync(
      'pdftotext',
      ['-layout', '-nopgbrk', file, '-'],
      {
        timeout: TIMEOUT_MS,
        maxBuffer: 12 * 1024 * 1024,
        encoding: 'utf8',
      },
    )
    return stdout
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new AccountError(
        'Reading the CV for a draft needs poppler (pdftotext) on the server.',
        503,
      )
    }
    throw new AccountError('The CV text could not be read for a draft.', 422)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
