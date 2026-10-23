/**
 * The uploaded CV survives a reload. The PDF bytes live in IndexedDB, never on
 * a server; this is local persistence, not an account or a saved upload.
 */

const DB_NAME = 'caddie'
const DB_VERSION = 1
const STORE = 'uploads'
const CV_KEY = 'cv'

type StoredCv = {
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

export async function saveCv(file: File): Promise<void> {
  const record: StoredCv = { blob: file, fileName: file.name, updatedAt: Date.now() }
  await runTransaction('readwrite', (store) => store.put(record, CV_KEY))
}

export async function readCv(): Promise<File | null> {
  const record = await runTransaction<StoredCv | undefined>('readonly', (store) =>
    store.get(CV_KEY) as IDBRequest<StoredCv | undefined>,
  )

  if (!record || !(record.blob instanceof Blob)) return null

  return new File([record.blob], record.fileName, { type: 'application/pdf' })
}

export async function clearCv(): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(CV_KEY))
}
