import { Hono } from 'hono'

import type { ClassifyModel } from '../shared/jd-classification'
import { classifyJd } from './classify'
import { CloudflareError } from './cloudflare'
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

app.notFound((c) => c.json({ error: 'Not found' }, 404))

const port = Number(process.env.PORT ?? 8787)

console.log(`Caddie classifier listening on http://localhost:${port}`)

export default { port, fetch: app.fetch }
