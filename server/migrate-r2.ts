import { GridFSBucket, MongoClient, ObjectId } from 'mongodb'

import {
  applicationCvKey,
  baseCvKey,
  putObject,
  storageConfigured,
} from './storage'

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PDF_MIME = 'application/pdf'

if (!storageConfigured()) {
  console.error(
    'R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET in .env.local.',
  )
  process.exit(1)
}

const client = new MongoClient(process.env.MONGODB_URI!)
await client.connect()
const db = client.db(process.env.MONGODB_DB?.trim() || 'caddie')
const files = new GridFSBucket(db, { bucketName: 'cvFiles' })

type StoredCv = {
  kind: 'docx' | 'pdf'
  fileName: string
  docxKey?: string | null
  pdfKey?: string | null
  docxFileId?: ObjectId | null
  pdfFileId?: ObjectId | null
  updatedAt: Date
}

async function readGridFs(id: ObjectId) {
  const chunks: Buffer[] = []
  for await (const chunk of files.openDownloadStream(id)) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function deleteGridFs(id: ObjectId | null | undefined) {
  if (!id) return
  await files.delete(id).catch(() => {})
}

async function migrateCv(
  cv: StoredCv,
  userId: string,
  applicationId?: string,
) {
  const next: StoredCv = {
    kind: cv.kind,
    fileName: cv.fileName,
    docxKey: cv.docxKey ?? null,
    pdfKey: cv.pdfKey ?? null,
    updatedAt: cv.updatedAt,
  }
  const created: string[] = []

  try {
    if (!next.docxKey && cv.docxFileId) {
      next.docxKey = applicationId
        ? applicationCvKey(userId, applicationId, 'docx')
        : baseCvKey(userId, 'docx')
      await putObject(next.docxKey, await readGridFs(cv.docxFileId), DOCX_MIME)
      created.push(next.docxKey)
    }

    if (!next.pdfKey && cv.pdfFileId) {
      next.pdfKey = applicationId
        ? applicationCvKey(userId, applicationId, 'pdf')
        : baseCvKey(userId, 'pdf')
      await putObject(next.pdfKey, await readGridFs(cv.pdfFileId), PDF_MIME)
      created.push(next.pdfKey)
    }

    if (!next.pdfKey) throw new Error('CV has no PDF to migrate.')
    return { cv: next, created }
  } catch (error) {
    const { deleteObject } = await import('./storage')
    for (const key of created) await deleteObject(key)
    throw error
  }
}

let profiles = 0
let applications = 0
const obsoleteFileIds = new Map<string, ObjectId>()

function rememberLegacyFiles(cv: StoredCv) {
  for (const id of [cv.docxFileId, cv.pdfFileId]) {
    if (id) obsoleteFileIds.set(id.toHexString(), id)
  }
}

for await (const profile of db
  .collection('profiles')
  .find({ 'cv.pdfFileId': { $exists: true } })) {
  if (!profile.cv) continue
  const userId = profile.userId as string
  const migrated = await migrateCv(profile.cv as StoredCv, userId)
  await db.collection('profiles').updateOne(
    { _id: profile._id },
    { $set: { cv: migrated.cv, updatedAt: new Date() } },
  )
  rememberLegacyFiles(profile.cv)
  profiles += 1
}

for await (const application of db
  .collection('applications')
  .find({ 'cv.pdfFileId': { $exists: true } })) {
  if (!application.cv) continue
  const userId = application.userId as string
  const applicationId = application._id.toHexString()
  const migrated = await migrateCv(
    application.cv as StoredCv,
    userId,
    applicationId,
  )
  await db.collection('applications').updateOne(
    { _id: application._id },
    { $set: { cv: migrated.cv, updatedAt: new Date() } },
  )
  rememberLegacyFiles(application.cv)
  applications += 1
}

for (const id of obsoleteFileIds.values()) await deleteGridFs(id)

await client.close()
console.log(`Migrated ${profiles} profile CVs and ${applications} application CVs to R2.`)
