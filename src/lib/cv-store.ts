/**
 * The uploaded CV survives a reload. The source bytes live in IndexedDB, never
 * in an account or a database; DOCX is also converted for preview.
 */

const DB_NAME = 'caddie'
const DB_VERSION = 1
const STORE = 'uploads'
const CV_KEY = 'cv'

const PDF_MIME = 'application/pdf'
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type StoredCv = {
  kind: 'pdf' | 'docx'
  /** The uploaded file, kept as the editable source of truth. */
  source: File
  /** DOCX only: the PDF rendered from it. */
  rendered: File | null
}

type StoredRecord = {
  kind: 'pdf' | 'docx'
  sourceBlob: Blob
  sourceName: string
  sourceType: string
  renderedBlob: Blob | null
  renderedName: string | null
  renderedType: string | null
  updatedAt: number
}

/** Shape written by the PDF-only version of this store. */
type LegacyRecord = {
  blob: Blob
  fileName: string
  updatedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available.'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open storage.'))
  })
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = work(transaction.objectStore(STORE))

        transaction.oncomplete = () => {
          db.close()
          resolve(request.result)
        }
        transaction.onerror = () => {
          db.close()
          reject(transaction.error ?? request.error ?? new Error('Storage failed.'))
        }
        transaction.onabort = () => {
          db.close()
          reject(transaction.error ?? new Error('Storage was aborted.'))
        }
      }),
  )
}

export async function saveCv(stored: StoredCv): Promise<void> {
  const record: StoredRecord = {
    kind: stored.kind,
    sourceBlob: stored.source,
    sourceName: stored.source.name,
    sourceType: stored.source.type || (stored.kind === 'docx' ? DOCX_MIME : PDF_MIME),
    renderedBlob: stored.rendered,
    renderedName: stored.rendered?.name ?? null,
    renderedType: stored.rendered?.type ?? null,
    updatedAt: Date.now(),
  }

  await runTransaction('readwrite', (store) => store.put(record, CV_KEY))
}

export async function readCv(): Promise<StoredCv | null> {
  const record = await runTransaction<StoredRecord | LegacyRecord | undefined>(
    'readonly',
    (store) => store.get(CV_KEY) as IDBRequest<StoredRecord | LegacyRecord | undefined>,
  )

  if (!record) return null

  if ('sourceBlob' in record && record.sourceBlob instanceof Blob) {
    const source = new File([record.sourceBlob], record.sourceName, {
      type: record.sourceType || (record.kind === 'docx' ? DOCX_MIME : PDF_MIME),
    })
    const rendered =
      record.renderedBlob instanceof Blob && record.renderedName
        ? new File([record.renderedBlob], record.renderedName, {
            type: record.renderedType || PDF_MIME,
          })
        : null

    return { kind: record.kind, source, rendered }
  }

  if ('blob' in record && record.blob instanceof Blob) {
    return {
      kind: 'pdf',
      source: new File([record.blob], record.fileName, { type: PDF_MIME }),
      rendered: null,
    }
  }

  return null
}

export async function clearCv(): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(CV_KEY))
}
