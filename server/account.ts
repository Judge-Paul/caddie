import { ObjectId } from 'mongodb'

import type {
  AccountCv,
  AccountCvKind,
  AccountMe,
  AccountUser,
  ApplicationDetail,
  ApplicationStatus,
  ApplicationSummary,
  CoverLetterDraft,
  EmailDraft,
  PublicWork,
  SavePublicWorkInput,
  StoredApplicationForm,
  UpdateApplicationPatch,
} from '../shared/account'
import type { AtsKind } from '../shared/application-form'
import type { CvStory } from '../shared/cv-fit'
import {
  normaliseClassification,
  type ClassificationResult,
} from '../shared/jd-classification'
import { getApplicant } from './applicant'
import { mongo, type MongoContext } from './mongo'
import {
  PublicWorkInputError,
  normalisePublicLinks,
  readPublicWork,
} from './public-work'
import { telegramStatus } from './telegram/links'
import {
  applicationCvKey,
  baseCvKey,
  copyObject,
  deleteObject,
  getObject,
  putObject,
} from './storage'

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PDF_MIME = 'application/pdf'

export class AccountError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'AccountError'
    this.status = status
  }
}

type StoredCv = {
  kind: AccountCvKind
  fileName: string
  docxKey?: string | null
  pdfKey?: string | null
  docxFileId?: ObjectId | null
  pdfFileId?: ObjectId | null
  updatedAt: Date
}

type ProfileDoc = {
  userId: string
  cv: StoredCv | null
  publicWork?: PublicWork | null
  applicantCiphertext?: string | null
  createdAt: Date
  updatedAt: Date
}

type ApplicationFormDoc = {
  url: string
  ats: AtsKind
  supported: boolean
  appliedAt: Date | null
}

type ApplicationDoc = {
  _id: ObjectId
  userId: string
  jdText: string
  title: string | null
  company: string | null
  status: ApplicationStatus
  classification: ClassificationResult | null
  coverLetter?: CoverLetterDraft | null
  emailDraft?: EmailDraft | null
  completedAt?: Date | null
  sentAt?: Date | null
  sentTo?: string | null
  sourceUrl?: string | null
  form?: ApplicationFormDoc | null
  cv: StoredCv
  createdAt: Date
  updatedAt: Date
}

type StoryDoc = CvStory & { userId: string; _id?: ObjectId }

function requireMongo(): MongoContext {
  const store = mongo()
  if (!store) {
    throw new AccountError(
      'Accounts are not configured. Add MONGODB_URI to .env.local.',
      503,
    )
  }
  return store
}

function objectId(value: string) {
  if (!ObjectId.isValid(value)) throw new AccountError('Not found.', 404)
  return new ObjectId(value)
}

function cleanFileName(value: string, kind: AccountCvKind) {
  const base = value.split(/[\\/]/).pop()?.trim().slice(0, 120) || `cv.${kind}`
  const withExt =
    kind === 'docx'
      ? /\.docx$/i.test(base)
        ? base
        : `${base}.docx`
      : /\.pdf$/i.test(base)
        ? base
        : `${base}.pdf`
  return withExt
}

function pdfName(fileName: string) {
  return fileName.replace(/\.docx$/i, '.pdf')
}

function firstLine(jdText: string) {
  const line =
    jdText
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean) ?? ''
  return line.replace(/^#+\s*/, '').slice(0, 120) || null
}

function cvDto(cv: StoredCv): AccountCv {
  return {
    kind: cv.kind,
    fileName: cv.fileName,
    hasDocx: Boolean(cv.docxKey || cv.docxFileId),
    hasPdf: Boolean(cv.pdfKey || cv.pdfFileId),
    updatedAt: cv.updatedAt.toISOString(),
  }
}

async function readStoredFile(
  store: MongoContext,
  cv: StoredCv,
  kind: AccountCvKind,
) {
  const key = kind === 'docx' ? cv.docxKey : cv.pdfKey
  if (key) return getObject(key)

  const legacyId = kind === 'docx' ? cv.docxFileId : cv.pdfFileId
  if (legacyId) return downloadBuffer(store, legacyId)
  return null
}

async function removeStoredFiles(store: MongoContext, cv: StoredCv | null) {
  if (!cv) return
  if (cv.docxKey) await deleteObject(cv.docxKey)
  if (cv.pdfKey) await deleteObject(cv.pdfKey)
  await deleteFile(store, cv.docxFileId ?? null)
  await deleteFile(store, cv.pdfFileId ?? null)
}

function summary(doc: ApplicationDoc): ApplicationSummary {
  return {
    id: doc._id.toHexString(),
    title: doc.title,
    company: doc.company,
    status: doc.status,
    cv: cvDto(doc.cv),
    hasCoverLetter: Boolean(doc.coverLetter?.text?.trim()),
    hasEmailDraft: Boolean(doc.emailDraft?.body?.trim()),
    completedAt: doc.completedAt?.toISOString() ?? null,
    sentAt: doc.sentAt?.toISOString() ?? null,
    sentTo: doc.sentTo ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

function detail(doc: ApplicationDoc): ApplicationDetail {
  return {
    ...summary(doc),
    jdText: doc.jdText,
    classification: doc.classification,
    coverLetter: doc.coverLetter ?? null,
    emailDraft: doc.emailDraft ?? null,
    sourceUrl: doc.sourceUrl ?? null,
    form: doc.form
      ? {
          url: doc.form.url,
          ats: doc.form.ats,
          supported: doc.form.supported,
          appliedAt: doc.form.appliedAt?.toISOString() ?? null,
        } satisfies StoredApplicationForm
      : null,
  }
}

export async function markFormApplied(userId: string, id: string): Promise<ApplicationDetail> {
  const current = await getApplication(userId, id)
  if (!current.form) {
    throw new AccountError('This application has no form to submit.', 409)
  }
  if (current.form.appliedAt) return current

  const store = requireMongo()
  const now = new Date()
  await store.db.collection<ApplicationDoc>('applications').updateOne(
    { _id: objectId(id), userId },
    { $set: { 'form.appliedAt': now, updatedAt: now } },
  )
  if (current.sentAt) return getApplication(userId, id)
  try {
    return await completeApplication(userId, id)
  } catch {
    return getApplication(userId, id)
  }
}

export async function saveApplicationSource(
  userId: string,
  id: string,
  source: { sourceUrl: string; form: Omit<StoredApplicationForm, 'appliedAt'> | null },
): Promise<ApplicationDetail> {
  await getApplication(userId, id)
  const store = requireMongo()
  await store.db.collection<ApplicationDoc>('applications').updateOne(
    { _id: objectId(id), userId },
    {
      $set: {
        sourceUrl: source.sourceUrl,
        form: source.form
          ? {
              url: source.form.url,
              ats: source.form.ats as AtsKind,
              supported: source.form.supported,
              appliedAt: null,
            }
          : null,
        updatedAt: new Date(),
      },
    },
  )
  return getApplication(userId, id)
}

async function downloadBuffer(store: MongoContext, id: ObjectId) {
  const chunks: Buffer[] = []
  for await (const chunk of store.files.openDownloadStream(id)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function deleteFile(store: MongoContext, id: ObjectId | null) {
  if (!id) return
  await store.files.delete(id).catch(() => {})
}

async function profileOf(userId: string) {
  const store = requireMongo()
  return store.db.collection<ProfileDoc>('profiles').findOne({ userId })
}

export async function getMe(
  userId: string,
  user: AccountUser,
): Promise<Omit<AccountMe, 'sending'>> {
  const store = requireMongo()
  const [profile, applications, stories, telegram, applicant] = await Promise.all([
    profileOf(userId),
    store.db
      .collection<ApplicationDoc>('applications')
      .find({ userId })
      .sort({ updatedAt: -1 })
      .toArray(),
    store.db
      .collection<StoryDoc>('stories')
      .find({ userId })
      .sort({ updatedAt: -1 })
      .project<CvStory>({ _id: 0, userId: 0 })
      .toArray(),
    telegramStatus(userId),
    getApplicant(userId).catch(() => null),
  ])

  return {
    user,
    cv: profile?.cv ? cvDto(profile.cv) : null,
    applications: applications.map(summary),
    stories,
    publicWork: profile?.publicWork ?? emptyPublicWork(),
    telegram,
    applicant,
  }
}

function emptyPublicWork(): PublicWork {
  return { website: null, github: null, updatedAt: null }
}

export async function getPublicWork(userId: string): Promise<PublicWork> {
  const profile = await profileOf(userId)
  return profile?.publicWork ?? emptyPublicWork()
}

export async function savePublicWork(
  userId: string,
  input: SavePublicWorkInput,
): Promise<PublicWork> {
  let links
  try {
    links = normalisePublicLinks(input)
  } catch (error) {
    if (error instanceof PublicWorkInputError) {
      throw new AccountError(error.message, 400)
    }
    throw error
  }

  const publicWork = await readPublicWork(links, {
    browserbaseKey: process.env.BROWSERBASE_API_KEY?.trim() || null,
    githubToken: process.env.GITHUB_TOKEN?.trim() || null,
  })

  await requireMongo()
    .db.collection<ProfileDoc>('profiles')
    .updateOne(
      { userId },
      {
        $set: { publicWork, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    )

  return publicWork
}

export async function saveBaseCv(
  userId: string,
  input: {
    kind: AccountCvKind
    fileName: string
    docx?: Uint8Array
    pdf: Uint8Array
  },
) {
  const store = requireMongo()
  const previous = await profileOf(userId)
  const fileName = cleanFileName(input.fileName, input.kind)
  const docxKey =
    input.kind === 'docx' ? baseCvKey(userId, 'docx') : null
  const pdfKey = baseCvKey(userId, 'pdf')

  try {
    if (input.kind === 'docx') {
      if (!input.docx) throw new AccountError('The DOCX source is missing.', 400)
      await putObject(docxKey!, input.docx, DOCX_MIME)
    }
    await putObject(pdfKey, input.pdf, PDF_MIME)
  } catch (error) {
    if (docxKey) await deleteObject(docxKey)
    await deleteObject(pdfKey)
    throw error
  }

  const cv: StoredCv = {
    kind: input.kind,
    fileName,
    docxKey,
    pdfKey,
    updatedAt: new Date(),
  }

  try {
    await store.db.collection<ProfileDoc>('profiles').updateOne(
      { userId },
      {
        $set: { cv, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    )
  } catch (error) {
    if (docxKey) await deleteObject(docxKey)
    await deleteObject(pdfKey)
    throw error
  }

  await removeStoredFiles(store, previous?.cv ?? null)
  return cvDto(cv)
}

export async function getBaseFile(userId: string, kind: AccountCvKind) {
  const store = requireMongo()
  const profile = await profileOf(userId)
  if (!profile?.cv) return null

  const buffer = await readStoredFile(store, profile.cv, kind)
  if (!buffer) return null

  return {
    buffer,
    fileName:
      kind === 'docx' ? profile.cv.fileName : pdfName(profile.cv.fileName),
    contentType: kind === 'docx' ? DOCX_MIME : PDF_MIME,
  }
}

export async function deleteBaseCv(userId: string) {
  const store = requireMongo()
  const profile = await profileOf(userId)
  if (profile?.cv) await removeStoredFiles(store, profile.cv)
  await store.db
    .collection<ProfileDoc>('profiles')
    .updateOne({ userId }, { $set: { cv: null, updatedAt: new Date() } })
}

async function copyBaseCv(
  store: MongoContext,
  userId: string,
  base: StoredCv,
  applicationId: ObjectId,
) {
  const appId = applicationId.toHexString()
  const docxKey =
    base.docxKey || base.docxFileId
      ? applicationCvKey(userId, appId, 'docx')
      : null
  const pdfKey = applicationCvKey(userId, appId, 'pdf')

  try {
    if (docxKey) {
      if (base.docxKey) {
        await copyObject(base.docxKey, docxKey)
      } else if (base.docxFileId) {
        await putObject(
          docxKey,
          await downloadBuffer(store, base.docxFileId),
          DOCX_MIME,
        )
      }
    }

    if (base.pdfKey) {
      await copyObject(base.pdfKey, pdfKey)
    } else if (base.pdfFileId) {
      await putObject(
        pdfKey,
        await downloadBuffer(store, base.pdfFileId),
        PDF_MIME,
      )
    } else {
      throw new AccountError('The base CV has no PDF.', 409)
    }

    return { docxKey, pdfKey }
  } catch (error) {
    if (docxKey) await deleteObject(docxKey)
    await deleteObject(pdfKey)
    throw error
  }
}

export async function createApplication(userId: string, jdText: string) {
  const store = requireMongo()
  const profile = await profileOf(userId)
  if (!profile?.cv) throw new AccountError('Upload a CV before creating an application.', 409)

  const id = new ObjectId()
  const copied = await copyBaseCv(store, userId, profile.cv, id)
  const now = new Date()

  const cv: StoredCv = {
    kind: profile.cv.kind,
    fileName: profile.cv.fileName,
    docxKey: copied.docxKey,
    pdfKey: copied.pdfKey,
    updatedAt: now,
  }

  const doc: ApplicationDoc = {
    _id: id,
    userId,
    jdText,
    title: firstLine(jdText),
    company: null,
    status: 'draft',
    classification: null,
    coverLetter: null,
    emailDraft: null,
    completedAt: null,
    sentAt: null,
    sentTo: null,
    cv,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await store.db.collection<ApplicationDoc>('applications').insertOne(doc)
  } catch (error) {
    await removeStoredFiles(store, cv)
    throw error
  }
  return detail(doc)
}

export async function listApplications(userId: string) {
  const store = requireMongo()
  const docs = await store.db
    .collection<ApplicationDoc>('applications')
    .find({ userId })
    .sort({ updatedAt: -1 })
    .toArray()
  return docs.map(summary)
}

export async function getApplication(userId: string, id: string) {
  const store = requireMongo()
  const doc = await store.db
    .collection<ApplicationDoc>('applications')
    .findOne({ _id: objectId(id), userId })
  if (!doc) throw new AccountError('Application not found.', 404)
  return detail(doc)
}

function normaliseStoredClassification(value: unknown): ClassificationResult | null {
  if (value === null) return null
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const data = normaliseClassification(raw.data)
  const metaRaw =
    typeof raw.meta === 'object' && raw.meta !== null
      ? (raw.meta as Record<string, unknown>)
      : {}

  return {
    data,
    meta: {
      model: metaRaw.model === 'jev' ? 'jev' : 'gemma',
      modelId:
        typeof metaRaw.modelId === 'string' ? metaRaw.modelId.slice(0, 120) : 'stored',
      latencyMs: Number.isFinite(Number(metaRaw.latencyMs))
        ? Math.max(0, Math.round(Number(metaRaw.latencyMs)))
        : 0,
      attempts: Number.isFinite(Number(metaRaw.attempts))
        ? Math.max(1, Math.round(Number(metaRaw.attempts)))
        : 1,
      ...(typeof metaRaw.cached === 'boolean' ? { cached: metaRaw.cached } : {}),
      ...(typeof metaRaw.usage === 'object' && metaRaw.usage !== null
        ? { usage: metaRaw.usage as Record<string, number> }
        : {}),
    },
  }
}

export async function updateApplication(
  userId: string,
  id: string,
  patch: UpdateApplicationPatch,
) {
  const store = requireMongo()
  const _id = objectId(id)
  const current = await store.db
    .collection<ApplicationDoc>('applications')
    .findOne({ _id, userId })
  if (!current) throw new AccountError('Application not found.', 404)

  if (current.sentAt || current.completedAt) {
    throw new AccountError(
      'This application is locked after sending or completion.',
      409,
    )
  }

  const set: Record<string, unknown> = { updatedAt: new Date() }

  if (typeof patch.jdText === 'string' && patch.jdText !== current.jdText) {
    set.jdText = patch.jdText
    set.classification = null
    set.title = firstLine(patch.jdText)
    set.company = null
    set.status = 'draft'
  }

  if (patch.classification !== undefined) {
    const classification = normaliseStoredClassification(patch.classification)
    set.classification = classification
    if (classification) {
      set.title =
        classification.data.role.title || firstLine(current.jdText)
      set.company = classification.data.company.name
      set.status = patch.status ?? 'classified'
    } else {
      set.status = 'draft'
    }
  }

  if (patch.coverLetter !== undefined) {
    if (patch.coverLetter === null) {
      set.coverLetter = null
    } else {
      const text =
        typeof patch.coverLetter.text === 'string'
          ? patch.coverLetter.text.trim()
          : ''
      if (text.length > 20_000) {
        throw new AccountError('That cover letter is too long.', 413)
      }
      set.coverLetter = {
        text,
        updatedAt: new Date().toISOString(),
      }
    }
  }

  if (patch.emailDraft !== undefined) {
    if (patch.emailDraft === null) {
      set.emailDraft = null
    } else {
      const to =
        typeof patch.emailDraft.to === 'string'
          ? patch.emailDraft.to.trim().slice(0, 320)
          : ''
      const subject =
        typeof patch.emailDraft.subject === 'string'
          ? patch.emailDraft.subject.trim().slice(0, 200)
          : ''
      const body =
        typeof patch.emailDraft.body === 'string'
          ? patch.emailDraft.body.trim()
          : ''
      if (body.length > 20_000) {
        throw new AccountError('That email draft is too long.', 413)
      }
      set.emailDraft = {
        to,
        subject,
        body,
        updatedAt: new Date().toISOString(),
      }
    }
  }

  if (patch.status !== undefined) set.status = patch.status

  const updated = await store.db
    .collection<ApplicationDoc>('applications')
    .findOneAndUpdate(
      { _id, userId },
      { $set: set },
      { returnDocument: 'after' },
    )
  if (!updated) throw new AccountError('Application not found.', 404)
  return detail(updated)
}

export async function markApplicationSent(
  userId: string,
  id: string,
  sentTo: string,
) {
  const store = requireMongo()
  const current = await store.db
    .collection<ApplicationDoc>('applications')
    .findOne({ _id: objectId(id), userId })
  if (!current) throw new AccountError('Application not found.', 404)
  if (current.completedAt) {
    throw new AccountError('This application is already completed.', 409)
  }

  const now = new Date()
  const updated = await store.db
    .collection<ApplicationDoc>('applications')
    .findOneAndUpdate(
      { _id: objectId(id), userId },
      { $set: { sentAt: now, sentTo, updatedAt: now } },
      { returnDocument: 'after' },
    )
  if (!updated) throw new AccountError('Application not found.', 404)
  return detail(updated)
}

export async function completeApplication(userId: string, id: string) {
  const store = requireMongo()
  const current = await store.db
    .collection<ApplicationDoc>('applications')
    .findOne({ _id: objectId(id), userId })
  if (!current) throw new AccountError('Application not found.', 404)
  if (current.sentAt) {
    throw new AccountError('This application has already been sent.', 409)
  }
  if (current.completedAt) return detail(current)

  const now = new Date()
  const updated = await store.db
    .collection<ApplicationDoc>('applications')
    .findOneAndUpdate(
      { _id: objectId(id), userId },
      { $set: { completedAt: now, updatedAt: now } },
      { returnDocument: 'after' },
    )
  if (!updated) throw new AccountError('Application not found.', 404)
  return detail(updated)
}

export async function saveApplicationCv(
  userId: string,
  id: string,
  input: { docx: Uint8Array; pdf: Uint8Array },
) {
  const store = requireMongo()
  const _id = objectId(id)
  const current = await store.db
    .collection<ApplicationDoc>('applications')
    .findOne({ _id, userId })
  if (!current) throw new AccountError('Application not found.', 404)
  if (current.sentAt || current.completedAt) {
    throw new AccountError(
      'This application is locked after sending or completion.',
      409,
    )
  }
  if (current.cv.kind !== 'docx') {
    throw new AccountError(
      'Upload a DOCX base CV to customize this application.',
      409,
    )
  }

  const docxKey = applicationCvKey(userId, id, 'docx')
  const pdfKey = applicationCvKey(userId, id, 'pdf')

  try {
    await putObject(docxKey, input.docx, DOCX_MIME)
    await putObject(pdfKey, input.pdf, PDF_MIME)
  } catch (error) {
    await deleteObject(docxKey)
    await deleteObject(pdfKey)
    throw error
  }

  const now = new Date()
  const cv: StoredCv = {
    kind: current.cv.kind,
    fileName: current.cv.fileName,
    docxKey,
    pdfKey,
    updatedAt: now,
  }

  let updated
  try {
    updated = await store.db
      .collection<ApplicationDoc>('applications')
      .findOneAndUpdate(
        { _id, userId },
        { $set: { cv, status: 'customized', updatedAt: now } },
        { returnDocument: 'after' },
      )
  } catch (error) {
    await deleteObject(docxKey)
    await deleteObject(pdfKey)
    throw error
  }
  if (!updated) {
    await deleteObject(docxKey)
    await deleteObject(pdfKey)
    throw new AccountError('Application not found.', 404)
  }

  await removeStoredFiles(store, current.cv)
  return detail(updated)
}

export async function getApplicationFile(
  userId: string,
  id: string,
  kind: AccountCvKind,
) {
  const store = requireMongo()
  const doc = await store.db
    .collection<ApplicationDoc>('applications')
    .findOne({ _id: objectId(id), userId })
  if (!doc) throw new AccountError('Application not found.', 404)

  const buffer = await readStoredFile(store, doc.cv, kind)
  if (!buffer) throw new AccountError('That file is not available.', 404)

  return {
    buffer,
    fileName:
      kind === 'docx' ? doc.cv.fileName : pdfName(doc.cv.fileName),
    contentType: kind === 'docx' ? DOCX_MIME : PDF_MIME,
  }
}

export async function deleteApplication(userId: string, id: string) {
  const store = requireMongo()
  const _id = objectId(id)
  const doc = await store.db
    .collection<ApplicationDoc>('applications')
    .findOne({ _id, userId })
  if (!doc) throw new AccountError('Application not found.', 404)

  await store.db.collection<ApplicationDoc>('applications').deleteOne({ _id, userId })
  await removeStoredFiles(store, doc.cv)
}

export async function listStories(userId: string) {
  const store = requireMongo()
  return store.db
    .collection<StoryDoc>('stories')
    .find({ userId })
    .sort({ updatedAt: -1 })
    .project<CvStory>({ _id: 0, userId: 0 })
    .toArray()
}

export async function saveStory(userId: string, story: CvStory) {
  const store = requireMongo()
  const now = new Date().toISOString()
  const next: CvStory = {
    ...story,
    updatedAt: now,
    createdAt: story.createdAt || now,
  }

  await store.db
    .collection<StoryDoc>('stories')
    .updateOne(
      { userId, id: story.id },
      { $set: { ...next, userId } },
      { upsert: true },
    )

  return next
}

export async function deleteStory(userId: string, id: string) {
  const store = requireMongo()
  await store.db.collection<StoryDoc>('stories').deleteOne({ userId, id })
}
