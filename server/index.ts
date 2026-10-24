import { Hono } from 'hono'
import type { Context } from 'hono'

import type { ClassifyModel } from '../shared/jd-classification'
import { classifyJd } from './classify'
import { CloudflareError } from './cloudflare'
import {
  DocxError,
  MAX_DOCX_BYTES,
  editDocx,
  parseDocx,
} from './cv/docx'
import { CvClassifyError, classifyCvDocx } from './cv/classify'
import { RenderError, renderDocxToPdf } from './cv/render'
import { ConfigError, configSummary, readConfig } from './env'
import { BrowserbaseError } from './research/browserbase'
import { researchCompany } from './research'
import { validateJd } from './validate'

const MIN_JD_CHARS = 40
const MAX_JD_CHARS = 40_000

const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true, ...configSummary() }))

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
  if (error instanceof ConfigError) {
    return c.json({ error: error.message }, 503)
  }
  if (error instanceof CvClassifyError) {
    return c.json({ error: error.message }, 422)
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
    return c.json(await classifyCvDocx(docx, readConfig()))
  } catch (error) {
    return cvFailure(c, error)
  }
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

const port = Number(process.env.PORT ?? 8787)

console.log(`Caddie classifier listening on http://localhost:${port}`)

export default { port, fetch: app.fetch }
