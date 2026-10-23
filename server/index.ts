import { Hono } from 'hono'

import type { ClassifyModel } from '../shared/jd-classification'
import { classifyJd } from './classify'
import { CloudflareError } from './cloudflare'
import { ConfigError, configSummary } from './env'

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

app.notFound((c) => c.json({ error: 'Not found' }, 404))

const port = Number(process.env.PORT ?? 8787)

console.log(`Caddie classifier listening on http://localhost:${port}`)

export default { port, fetch: app.fetch }
