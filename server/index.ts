import { readFile } from 'node:fs/promises'

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Context } from 'hono'
import { serveStatic } from 'hono/bun'

import type {
  AccountCvKind,
  AccountUser,
  ComposeKind,
  SavePublicWorkInput,
  SaveSendingInput,
  SendApplicationInput,
  UpdateApplicationPatch,
} from '../shared/account'
import type { CvPlanRequest } from '../shared/cv-plan'
import type { CvStory, FitRequest } from '../shared/cv-fit'
import type { ClassifyModel } from '../shared/jd-classification'
import { guardJd, NOT_JD_MESSAGE } from '../shared/jd-guard'
import { classifyJd } from './classify'
import { CloudflareError } from './cloudflare'
import { composeApplication } from './compose'
import { renderCoverLetterPdf } from './cover-letter'
import { SecretError } from './crypto'
import {
  DocxError,
  MAX_DOCX_BYTES,
  editDocx,
  openDocx,
  parseDocx,
} from './cv/docx'
import { classifyCvDocxDeep } from './cv/classify'
import { classifyCvDocxFast } from './cv/fast'
import { CvClassifyError } from './cv/errors'
import { FitError, proposeCvFit } from './cv/fit'
import { planCv } from './cv/plan'
import { MeasureError } from './cv/measure'
import { RenderError, renderDocxToPdf } from './cv/render'
import { MAX_CV_BYTES, ingestCv } from './cv/ingest'
import {
  AccountError,
  createApplication,
  deleteApplication,
  deleteBaseCv,
  deleteStory,
  getApplication,
  getApplicationFile,
  getBaseFile,
  getMe,
  listApplications,
  completeApplication,
  listStories,
  saveApplicationCv,
  saveBaseCv,
  savePublicWork,
  saveStory,
  updateApplication,
} from './account'
import { authBaseUrl, authConfigured, getAuth } from './auth'
import { ConfigError, configSummary, readConfig } from './env'
import { BrowserbaseError } from './research/browserbase'
import { researchCompany } from './research'
import { sendApplication } from './send'
import { StorageError, storageConfigured } from './storage'
import {
  PreviewTokenError,
  verifyPreviewToken,
} from './preview-token'
import {
  TelegramLinkError,
  linkTelegram,
  previewTelegramLink,
  telegramStatus,
  unlinkTelegram,
  updateTelegramIdentity,
} from './telegram/links'
import { sendTelegramText, telegramChatInfo } from './telegram/api'
import {
  deleteSending,
  deleteSendingKey,
  getSending,
  saveSending,
  testSending,
} from './sending'
import { sessionMiddleware, type AppEnv } from './session'
import { validateJd } from './validate'

const MIN_JD_CHARS = 40
const MAX_JD_CHARS = 40_000
const MAX_PDF_BYTES = MAX_CV_BYTES

const app = new Hono<AppEnv>()

app.use(
  '/api/*',
  bodyLimit({
    maxSize: 64 * 1024 * 1024,
    onError: (c) => c.json({ error: 'That request is too large.' }, 413),
  }),
)

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    ...configSummary(),
    accounts: {
      configured: authConfigured(),
      database: Boolean(process.env.MONGODB_URI?.trim()),
      baseURL: authBaseUrl(),
    },
    storage: { configured: storageConfigured() },
  }),
)

app.all('/api/auth/*', (c) => {
  const auth = getAuth()
  if (!auth) {
    return c.json(
      {
        error:
          'Accounts are not configured yet. Add MONGODB_URI, BETTER_AUTH_SECRET and the Google keys to .env.local.',
      },
      503,
    )
  }
  return auth.handler(c.req.raw)
})

app.use('/api/*', (c, next) => {
  const path = c.req.path
  if (
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/preview/') ||
    path === '/api/health'
  ) {
    return next()
  }
  return sessionMiddleware(c, next)
})

app.post('/api/classify', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    jd?: unknown
    model?: unknown
  } | null

  const jd = typeof body?.jd === 'string' ? body.jd.trim() : ''
  const requested = body?.model

  if (requested !== undefined && requested !== 'gemma' && requested !== 'jev') {
    return c.json({ error: 'Unknown classifier.' }, 400)
  }

  if (jd.length < MIN_JD_CHARS) {
    return c.json({ error: 'Paste a job description first.' }, 400)
  }

  if (jd.length > MAX_JD_CHARS) {
    return c.json(
      { error: 'That posting is too long to classify. Trim it below 40,000 characters.' },
      413,
    )
  }

  const model: ClassifyModel = requested === 'jev' ? 'jev' : 'gemma'

  try {
    const validation = await validateJd(jd, readConfig())

    if (!validation.allowed) {
      return c.json({ error: validation.reason, code: 'not-a-jd' }, 422)
    }

    return c.json(await classifyJd(jd, model))
  } catch (error) {
    if (error instanceof ConfigError) {
      return c.json({ error: error.message }, 503)
    }
    if (error instanceof CloudflareError) {
      return c.json({ error: error.message }, 502)
    }
    return c.json(
      { error: error instanceof Error ? error.message : 'Classification failed.' },
      500,
    )
  }
})

app.post('/api/research', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    company?: unknown
    role?: unknown
    fields?: unknown
    summary?: unknown
  } | null

  const company = typeof body?.company === 'string' ? body.company.trim() : ''
  const role = typeof body?.role === 'string' ? body.role.trim() : ''
  const fields = Array.isArray(body?.fields)
    ? body.fields
        .filter((field): field is string => typeof field === 'string')
        .map((field) => field.trim())
        .filter(Boolean)
        .slice(0, 6)
    : []
  const summary = typeof body?.summary === 'string' ? body.summary.trim() : ''

  if (company.length < 2 || company.length > 120) {
    return c.json({ error: 'A company name is needed for research.' }, 400)
  }

  try {
    return c.json(
      await researchCompany(
        { company, role: role.slice(0, 120), fields, summary: summary.slice(0, 300) },
        readConfig(),
      ),
    )
  } catch (error) {
    if (error instanceof ConfigError) {
      return c.json({ error: error.message }, 503)
    }
    if (error instanceof BrowserbaseError) {
      return c.json({ error: error.message }, error.status as 502 | 503 | 504)
    }
    if (error instanceof CloudflareError) {
      return c.json({ error: error.message }, 502)
    }
    return c.json(
      { error: error instanceof Error ? error.message : 'Company research failed.' },
      500,
    )
  }
})

async function readDocxBytes(c: Context) {
  const type = c.req.header('content-type') ?? ''
  if (!/wordprocessingml|octet-stream/i.test(type)) {
    throw new DocxError('Upload a DOCX file.', 415)
  }

  const length = Number(c.req.header('content-length') ?? 0)
  if (Number.isFinite(length) && length > MAX_DOCX_BYTES) {
    throw new DocxError('That DOCX is larger than 15 MB.', 413)
  }

  const bytes = new Uint8Array(await c.req.arrayBuffer())
  if (bytes.byteLength === 0) throw new DocxError('That DOCX is empty.', 400)
  if (bytes.byteLength > MAX_DOCX_BYTES) {
    throw new DocxError('That DOCX is larger than 15 MB.', 413)
  }

  return bytes
}

function cvFailure(c: Context, error: unknown) {
  if (error instanceof AccountError) {
    return c.json(
      { error: error.message },
      error.status as 400 | 404 | 409 | 413 | 422 | 500 | 502 | 503 | 504,
    )
  }
  if (error instanceof SecretError) {
    return c.json({ error: error.message }, 503)
  }
  if (error instanceof StorageError) {
    return c.json({ error: error.message }, error.status)
  }
  if (error instanceof TelegramLinkError) {
    return c.json({ error: error.message }, error.status as 400 | 409 | 410 | 503)
  }
  if (error instanceof PreviewTokenError) {
    return c.json({ error: error.message }, error.status as 401 | 410 | 503)
  }
  if (error instanceof ConfigError) {
    return c.json({ error: error.message }, 503)
  }
  if (error instanceof CloudflareError) {
    return c.json({ error: error.message }, 502)
  }
  if (error instanceof CvClassifyError) {
    return c.json({ error: error.message }, 422)
  }
  if (error instanceof FitError) {
    return c.json({ error: error.message }, error.status as 400 | 413 | 422)
  }
  if (error instanceof MeasureError) {
    return c.json({ error: error.message }, 500)
  }
  if (error instanceof DocxError || error instanceof RenderError) {
    const status = error.status as 400 | 413 | 415 | 422 | 500
    return c.json({ error: error.message }, status)
  }

  return c.json(
    { error: error instanceof Error ? error.message : 'Could not process that CV.' },
    500,
  )
}

app.post('/api/cv/convert', async (c) => {
  try {
    const docx = await readDocxBytes(c)
    await openDocx(docx)
    const pdf = await renderDocxToPdf(docx)
    const bytes = new Uint8Array(pdf.byteLength)
    bytes.set(pdf)

    return c.body(bytes, 200, {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
      'Content-Disposition': 'inline; filename="cv.pdf"',
    })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/cv/parse', async (c) => {
  try {
    const docx = await readDocxBytes(c)
    const blocks = await parseDocx(docx)
    return c.json({ blocks })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/cv/edit', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    docx?: unknown
    edits?: unknown
  } | null

  const encoded = typeof body?.docx === 'string' ? body.docx : ''
  if (!encoded) {
    return c.json({ error: 'Send the DOCX as base64.' }, 400)
  }
  if (encoded.length > MAX_DOCX_BYTES * 1.4) {
    return c.json({ error: 'That DOCX is larger than 15 MB.' }, 413)
  }

  const edits = Array.isArray(body?.edits)
    ? body.edits.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const record = entry as { blockId?: unknown; text?: unknown; find?: unknown }
        if (typeof record.blockId !== 'string' || typeof record.text !== 'string') {
          return []
        }
        if (record.text.length > 5_000) return []
        if (record.find !== undefined && typeof record.find !== 'string') return []
        if (typeof record.find === 'string' && record.find.length > 200) return []
        return [
          {
            blockId: record.blockId,
            text: record.text,
            ...(typeof record.find === 'string' ? { find: record.find } : {}),
          },
        ]
      })
    : []

  if (edits.length === 0) {
    return c.json({ error: 'No valid edits were provided.' }, 400)
  }

  try {
    const input = Uint8Array.from(Buffer.from(encoded, 'base64'))
    const edited = await editDocx(input, edits)
    const pdf = await renderDocxToPdf(edited.docx)

    return c.json({
      blocks: edited.blocks,
      docx: Buffer.from(edited.docx).toString('base64'),
      pdf: Buffer.from(pdf).toString('base64'),
    })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/cv/classify', async (c) => {
  try {
    const docx = await readDocxBytes(c)
    const deep = c.req.query('mode') === 'deep'
    const result = deep
      ? await classifyCvDocxDeep(docx, readConfig())
      : await classifyCvDocxFast(docx, readConfig())
    return c.json(result)
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/cv/plan', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null

  if (
    !body ||
    typeof body.docx !== 'string' ||
    typeof body.cv !== 'object' ||
    typeof body.jd !== 'object' ||
    !Array.isArray(body.gaps)
  ) {
    return c.json({ error: 'Send the DOCX, CV map, JD data and missing skills.' }, 400)
  }

  const request = {
    ...body,
    message: typeof body.message === 'string' ? body.message.slice(0, 4_000) : '',
    history: Array.isArray(body.history) ? body.history.slice(-8) : [],
    stories: Array.isArray(body.stories) ? body.stories.slice(0, 10) : [],
    excludeBlockIds: Array.isArray(body.excludeBlockIds)
      ? body.excludeBlockIds.filter((id): id is string => typeof id === 'string').slice(0, 20)
      : [],
  } as unknown as CvPlanRequest

  try {
    return c.json(await planCv(request, readConfig()))
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/cv/fit', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null

  if (
    !body ||
    typeof body.docx !== 'string' ||
    typeof body.roleId !== 'string' ||
    typeof body.cv !== 'object' ||
    typeof body.jd !== 'object' ||
    typeof body.gap !== 'object'
  ) {
    return c.json({ error: 'Send the DOCX, CV data, JD data, role and gap.' }, 400)
  }

  const request = {
    ...body,
    message: typeof body.message === 'string' ? body.message.slice(0, 2_000) : '',
    history: Array.isArray(body.history) ? body.history.slice(-8) : [],
    stories: Array.isArray(body.stories) ? body.stories.slice(0, 10) : [],
    excludeBlockIds: Array.isArray(body.excludeBlockIds)
      ? body.excludeBlockIds.filter((id): id is string => typeof id === 'string').slice(0, 20)
      : [],
  } as unknown as FitRequest

  try {
    return c.json(await proposeCvFit(request, readConfig()))
  } catch (error) {
    return cvFailure(c, error)
  }
})

function accountUser(user: {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
}): AccountUser {
  return {
    id: user.id,
    name: user.name ?? '',
    email: user.email ?? '',
    image: user.image ?? null,
  }
}

function safeFileName(name: string) {
  return name.replace(/[^\w.-]+/g, '_') || 'cv'
}

async function readCvUpload(c: Context) {
  const length = Number(c.req.header('content-length') ?? 0)
  if (Number.isFinite(length) && length > MAX_CV_BYTES) {
    throw new DocxError('That CV is larger than 20 MB.', 413)
  }

  const bytes = new Uint8Array(await c.req.arrayBuffer())
  let fileName = ''
  try {
    const header = c.req.header('x-file-name')
    if (header) fileName = decodeURIComponent(header)
  } catch {
    fileName = ''
  }

  return ingestCv({
    bytes,
    contentType: c.req.header('content-type'),
    fileName,
  })
}

function sendFile(
  c: Context,
  file: { buffer: Buffer; fileName: string; contentType: string },
) {
  const bytes = new Uint8Array(file.buffer.byteLength)
  bytes.set(file.buffer)
  return c.body(bytes, 200, {
    'Content-Type': file.contentType,
    'Content-Disposition': `inline; filename="${safeFileName(file.fileName)}"`,
    'Cache-Control': 'private, no-store',
  })
}

app.get('/api/me', async (c) => {
  const session = c.get('session')
  const [me, sending] = await Promise.all([
    getMe(session.user.id, accountUser(session.user)),
    getSending(session.user.id),
  ])
  return c.json({ ...me, sending })
})

app.get('/api/preview/:token', async (c) => {
  try {
    const preview = verifyPreviewToken(c.req.param('token'))
    if (preview.k === 'cv') {
      const file = await getApplicationFile(preview.u, preview.a, 'pdf')
      return sendFile(c, file)
    }
    const application = await getApplication(preview.u, preview.a)
    if (!application.coverLetter?.text.trim()) {
      return c.json({ error: 'There is no cover letter to preview.' }, 404)
    }
    const pdf = await renderCoverLetterPdf(application.coverLetter.text)
    return c.body(pdf, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="cover-letter.pdf"',
      'Cache-Control': 'private, no-store',
    })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/telegram/link/preview', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null
  if (typeof body?.token !== 'string' || !body.token.trim()) {
    return c.json({ error: 'That Telegram link is missing.' }, 400)
  }
  try {
    return c.json({ preview: await previewTelegramLink(body.token.trim()) })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/telegram/link', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null
  if (typeof body?.token !== 'string' || !body.token.trim()) {
    return c.json({ error: 'That Telegram link is missing.' }, 400)
  }
  try {
    const session = c.get('session')
    const linked = await linkTelegram(session.user.id, body.token.trim())
    try {
      const chat = await telegramChatInfo(linked.chatId)
      await updateTelegramIdentity(linked.chatId, {
        username: chat.username ?? null,
        firstName: chat.first_name ?? null,
      })
      await sendTelegramText(
        linked.chatId,
        'Telegram is connected to Caddie. Send me your CV as a DOCX or PDF, or paste a job description.',
      )
    } catch {
      // Linking succeeds even if the confirmation message cannot be sent.
    }
    return c.json({ telegram: await telegramStatus(session.user.id) })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.delete('/api/telegram/link', async (c) => {
  try {
    const session = c.get('session')
    return c.json({ telegram: await unlinkTelegram(session.user.id) })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.put('/api/me/public-work', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | Partial<SavePublicWorkInput>
    | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Add a website or GitHub profile.' }, 400)
  }
  const website = body.website ?? null
  const github = body.github ?? null
  if (
    (website !== null && typeof website !== 'string') ||
    (github !== null && typeof github !== 'string')
  ) {
    return c.json({ error: 'Enter the links as text.' }, 400)
  }

  try {
    const session = c.get('session')
    return c.json({
      publicWork: await savePublicWork(session.user.id, { website, github }),
    })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.put('/api/me/sending', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | (Partial<SaveSendingInput> & { apiKey?: unknown })
    | null

  if (!body || typeof body.email !== 'string') {
    return c.json({ error: 'Add the email address you send from.' }, 400)
  }

  try {
    const session = c.get('session')
    const sending = await saveSending(session.user.id, {
      email: body.email,
      fromName: typeof body.fromName === 'string' ? body.fromName : null,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
    })
    return c.json({ sending })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/me/sending/test', async (c) => {
  try {
    const session = c.get('session')
    return c.json({ sending: await testSending(session.user.id) })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.delete('/api/me/sending', async (c) => {
  try {
    const session = c.get('session')
    return c.json({ sending: await deleteSending(session.user.id) })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.delete('/api/me/sending/key', async (c) => {
  try {
    const session = c.get('session')
    return c.json({ sending: await deleteSendingKey(session.user.id) })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/me/cv', async (c) => {
  try {
    const session = c.get('session')
    const upload = await readCvUpload(c)
    const cv = await saveBaseCv(session.user.id, upload)
    return c.json({ cv }, 201)
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.get('/api/me/cv/:kind', async (c) => {
  try {
    const kind = c.req.param('kind')
    if (kind !== 'docx' && kind !== 'pdf') {
      return c.json({ error: 'Unknown file kind.' }, 400)
    }
    const session = c.get('session')
    const file = await getBaseFile(session.user.id, kind as AccountCvKind)
    if (!file) return c.json({ error: 'No CV uploaded.' }, 404)
    return sendFile(c, file)
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.delete('/api/me/cv', async (c) => {
  try {
    const session = c.get('session')
    await deleteBaseCv(session.user.id)
    return c.json({ ok: true })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.get('/api/me/stories', async (c) => {
  try {
    const session = c.get('session')
    return c.json({ stories: await listStories(session.user.id) })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/me/stories', async (c) => {
  try {
    const session = c.get('session')
    const body = (await c.req.json().catch(() => null)) as Partial<CvStory> | null
    if (!body || typeof body.id !== 'string' || typeof body.userText !== 'string') {
      return c.json({ error: 'A story needs an id and text.' }, 400)
    }
    const story = await saveStory(session.user.id, body as CvStory)
    return c.json({ story }, 201)
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.delete('/api/me/stories/:id', async (c) => {
  try {
    const session = c.get('session')
    await deleteStory(session.user.id, c.req.param('id'))
    return c.json({ ok: true })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.get('/api/applications', async (c) => {
  try {
    const session = c.get('session')
    return c.json({ applications: await listApplications(session.user.id) })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/applications', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { jdText?: unknown } | null
  const jdText = typeof body?.jdText === 'string' ? body.jdText.trim() : ''

  if (jdText.length < MIN_JD_CHARS) {
    return c.json({ error: 'Paste the job description first.' }, 400)
  }
  if (jdText.length > MAX_JD_CHARS) {
    return c.json({ error: 'That posting is too long. Trim it below 40,000 characters.' }, 413)
  }

  const guard = guardJd(jdText)
  if (guard.verdict === 'not-jd') {
    return c.json({ error: guard.message || NOT_JD_MESSAGE, code: 'not-a-jd' }, 422)
  }

  try {
    const session = c.get('session')
    return c.json(await createApplication(session.user.id, jdText), 201)
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/applications/:id/compose', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    kind?: unknown
  } | null
  const kind = body?.kind
  if (kind !== 'cover-letter' && kind !== 'email') {
    return c.json({ error: 'Choose a cover letter or an email draft.' }, 400)
  }

  try {
    const session = c.get('session')
    return c.json(
      await composeApplication(
        session.user.id,
        c.req.param('id'),
        kind as ComposeKind,
        session.user.name ?? null,
      ),
    )
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/applications/:id/complete', async (c) => {
  try {
    const session = c.get('session')
    return c.json(await completeApplication(session.user.id, c.req.param('id')))
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.post('/api/applications/:id/send', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | (Partial<SendApplicationInput> & { attachCv?: unknown })
    | null

  if (
    !body ||
    typeof body.to !== 'string' ||
    typeof body.subject !== 'string' ||
    typeof body.body !== 'string'
  ) {
    return c.json({ error: 'Add a recipient, subject and message before sending.' }, 400)
  }

  try {
    const session = c.get('session')
    return c.json(
      await sendApplication(session.user.id, c.req.param('id'), {
        to: body.to,
        subject: body.subject,
        body: body.body,
        attachCv: body.attachCv !== false,
        attachCoverLetter: body.attachCoverLetter === true,
      }),
    )
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.get('/api/applications/:id/cover-letter.pdf', async (c) => {
  try {
    const session = c.get('session')
    const application = await getApplication(session.user.id, c.req.param('id'))
    if (!application.coverLetter?.text.trim()) {
      return c.json({ error: 'There is no cover letter to download.' }, 404)
    }

    const pdf = await renderCoverLetterPdf(application.coverLetter.text)
    return c.body(pdf, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="cover-letter.pdf"',
      'Cache-Control': 'private, no-store',
    })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.get('/api/applications/:id', async (c) => {
  try {
    const session = c.get('session')
    return c.json(await getApplication(session.user.id, c.req.param('id')))
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.patch('/api/applications/:id', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    jdText?: unknown
    classification?: unknown
    status?: unknown
    coverLetter?: unknown
    emailDraft?: unknown
  } | null

  if (!body) return c.json({ error: 'Send an update.' }, 400)

  const patch: UpdateApplicationPatch = {}

  if (typeof body.jdText === 'string') {
    const jdText = body.jdText.trim()
    if (jdText.length < MIN_JD_CHARS) {
      return c.json({ error: 'The job description is too short.' }, 400)
    }
    if (jdText.length > MAX_JD_CHARS) {
      return c.json({ error: 'That posting is too long.' }, 413)
    }
    patch.jdText = jdText
  }

  if ('classification' in body) {
    patch.classification = body.classification as UpdateApplicationPatch['classification']
  }

  if (
    body.status === 'draft' ||
    body.status === 'classified' ||
    body.status === 'customized'
  ) {
    patch.status = body.status
  }

  if ('coverLetter' in body) {
    patch.coverLetter = body.coverLetter as UpdateApplicationPatch['coverLetter']
  }

  if ('emailDraft' in body) {
    patch.emailDraft = body.emailDraft as UpdateApplicationPatch['emailDraft']
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'Nothing to update.' }, 400)
  }

  try {
    const session = c.get('session')
    return c.json(await updateApplication(session.user.id, c.req.param('id'), patch))
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.delete('/api/applications/:id', async (c) => {
  try {
    const session = c.get('session')
    await deleteApplication(session.user.id, c.req.param('id'))
    return c.json({ ok: true })
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.get('/api/applications/:id/cv/:kind', async (c) => {
  try {
    const kind = c.req.param('kind')
    if (kind !== 'docx' && kind !== 'pdf') {
      return c.json({ error: 'Unknown file kind.' }, 400)
    }
    const session = c.get('session')
    const file = await getApplicationFile(
      session.user.id,
      c.req.param('id'),
      kind as AccountCvKind,
    )
    return sendFile(c, file)
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.put('/api/applications/:id/cv', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    docx?: unknown
    pdf?: unknown
  } | null

  const docxBase64 = typeof body?.docx === 'string' ? body.docx : ''
  const pdfBase64 = typeof body?.pdf === 'string' ? body.pdf : ''

  if (!docxBase64 || !pdfBase64) {
    return c.json({ error: 'Send the edited DOCX and PDF.' }, 400)
  }
  if (
    docxBase64.length > MAX_DOCX_BYTES * 1.4 ||
    pdfBase64.length > MAX_PDF_BYTES * 1.4
  ) {
    return c.json({ error: 'That CV is too large.' }, 413)
  }

  const docx = Uint8Array.from(Buffer.from(docxBase64, 'base64'))
  const pdf = Uint8Array.from(Buffer.from(pdfBase64, 'base64'))

  if (pdf[0] !== 0x25 || pdf[1] !== 0x50 || pdf[2] !== 0x44 || pdf[3] !== 0x46) {
    return c.json({ error: 'The rendered PDF is invalid.' }, 422)
  }

  try {
    await openDocx(docx)
    const session = c.get('session')
    return c.json(
      await saveApplicationCv(session.user.id, c.req.param('id'), { docx, pdf }),
    )
  } catch (error) {
    return cvFailure(c, error)
  }
})

if (process.env.NODE_ENV === 'production') {
  app.get('/', async (c) => {
    const html = await readFile('./dist/index.html', 'utf8')
    const appUrl =
      process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, '') ||
      new URL(c.req.url).origin
    return c.html(
      html
        .replaceAll('content="/og.png"', `content="${appUrl}/og.png"`)
        .replace(
          '</head>',
          `<meta property="og:url" content="${appUrl}/" /></head>`,
        ),
    )
  })
  app.use('*', serveStatic({ root: './dist' }))
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next()
    return serveStatic({ path: './dist/index.html' })(c, next)
  })
}

app.notFound((c) => c.json({ error: 'Not found' }, 404))

const port = Number(process.env.PORT ?? 8787)

console.log(`Caddie classifier listening on http://localhost:${port}`)

export default { port, hostname: '0.0.0.0', fetch: app.fetch }
