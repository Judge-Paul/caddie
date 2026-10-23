/**
 * Small best-effort disk cache for classifications and company research. It is
 * local to the server working directory and safe to delete at any time.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const CACHE_ROOT = process.env.CADDIE_CACHE_DIR ?? path.join(process.cwd(), '.cache')

type Entry<T> = { savedAt: number; data: T }

function fileFor(namespace: string, key: string) {
  return path.join(CACHE_ROOT, namespace, `${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`)
}

export async function readCache<T>(
  namespace: string,
  key: string,
  ttlMs: number,
): Promise<T | null> {
  try {
    const raw = await readFile(fileFor(namespace, key), 'utf8')
    const entry = JSON.parse(raw) as Entry<T>
    if (!entry || typeof entry.savedAt !== 'number') return null
    if (Date.now() - entry.savedAt > ttlMs) return null
    return entry.data
  } catch {
    return null
  }
}

export async function writeCache<T>(
  namespace: string,
  key: string,
  data: T,
): Promise<void> {
  try {
    const file = fileFor(namespace, key)
    await mkdir(path.dirname(file), { recursive: true })
    const entry: Entry<T> = { savedAt: Date.now(), data }
    await writeFile(file, JSON.stringify(entry), 'utf8')
  } catch {
    // Best effort: a read-only filesystem should not break classification.
  }
}
