/**
 * The candidate's managed facts, stored locally. Stories are what they told us
 * about their own work, so a later JD can reuse confirmed evidence without
 * asking again. This stays in the browser until a real account/profile store
 * exists.
 */
import type { CvStory } from '@shared/cv-fit'

const DB_NAME = 'caddie-profile'
const DB_VERSION = 1
const STORE = 'stories'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available.'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
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

export async function saveStory(story: CvStory): Promise<void> {
  await runTransaction('readwrite', (store) => store.put(story))
}

export async function listStories(): Promise<CvStory[]> {
  const stories = await runTransaction<CvStory[]>('readonly', (store) =>
    store.getAll() as IDBRequest<CvStory[]>,
  )

  return stories.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function deleteStory(id: string): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(id))
}
