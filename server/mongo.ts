import { GridFSBucket, MongoClient, type Db } from 'mongodb'

export type MongoContext = {
  client: MongoClient
  db: Db
  files: GridFSBucket
}

const globalStore = globalThis as typeof globalThis & {
  __caddieMongo?: MongoContext | null
  __caddieIndexes?: Promise<void>
}

async function ensureIndexes(db: Db) {
  try {
    await db.collection('profiles').createIndex({ userId: 1 }, { unique: true })
    await db.collection('applications').createIndex({ userId: 1, updatedAt: -1 })
    await db.collection('applications').createIndex({ userId: 1, createdAt: -1 })
    await db.collection('stories').createIndex({ userId: 1, updatedAt: -1 })
    await db
      .collection('stories')
      .createIndex({ userId: 1, id: 1 }, { unique: true })
    await db
      .collection('telegramLinks')
      .createIndex({ chatId: 1 }, { unique: true })
    await db
      .collection('telegramLinks')
      .createIndex({ userId: 1 }, { unique: true })
    await db
      .collection('telegramSessions')
      .createIndex({ chatId: 1 }, { unique: true })
  } catch (error) {
    console.error('[mongo] index setup failed', error)
  }
}

/**
 * Lazily create the shared Mongo client. A missing MONGODB_URI must not stop
 * the classifier or the local-only parts of the app from starting.
 */
export function mongo(): MongoContext | null {
  if (globalStore.__caddieMongo !== undefined) return globalStore.__caddieMongo

  const uri = process.env.MONGODB_URI?.trim()
  if (!uri) {
    globalStore.__caddieMongo = null
    return null
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5_000,
    timeoutMS: 15_000,
  })
  const db = client.db(process.env.MONGODB_DB?.trim() || 'caddie')
  const files = new GridFSBucket(db, { bucketName: 'cvFiles' })

  globalStore.__caddieMongo = { client, db, files }
  globalStore.__caddieIndexes ??= ensureIndexes(db)
  return globalStore.__caddieMongo
}

export function mongoConfigured() {
  return Boolean(process.env.MONGODB_URI?.trim())
}
