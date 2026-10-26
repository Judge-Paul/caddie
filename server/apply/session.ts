import { BrowserbaseError } from '../research/browserbase'
import {
  connectCdp,
  pageFromConnection,
  type CdpConnection,
  type CdpPage,
} from './cdp'

const API_ROOT = 'https://api.browserbase.com/v1'
const CONNECT_TIMEOUT_MS = 30_000
const SESSION_TTL_SECONDS = 600

export type ApplySession = {
  id: string
  connection: CdpConnection
  page: CdpPage
  liveUrl: string
}

function key(config: { browserbaseKey: string | null }) {
  if (!config.browserbaseKey) {
    throw new BrowserbaseError('Form apply needs BROWSERBASE_API_KEY.', 503)
  }
  return config.browserbaseKey
}

async function rest<T>(
  apiKey: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: init.method ?? 'POST',
      headers: {
        'X-BB-API-Key': apiKey,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new BrowserbaseError('Browserbase took too long to answer.', 504)
    }
    throw new BrowserbaseError('Could not reach Browserbase.', 502)
  }
  const payload = (await response.json().catch(() => null)) as (T & {
    message?: string
    error?: string
  }) | null
  if (!response.ok || !payload) {
    const detail = payload?.message ?? payload?.error ?? `Request failed (${response.status}).`
    throw new BrowserbaseError(detail, 502)
  }
  return payload
}

/**
 * Opens a fresh cloud browser on Browserbase. The control protocol is a
 * plain WebSocket speaking CDP: no local browser, and the site sees
 * Browserbase's cloud Chrome rather than automation tooling.
 */
export async function openApplySession(
  config: { browserbaseKey: string | null },
  url: string,
): Promise<ApplySession> {
  const apiKey = key(config)
  const created = await rest<{ id: string; connectUrl: string }>(apiKey, '/sessions', {
    // Keep to documented fields; stealth and proxy tuning lands with the
    // submit path if a board proves to need it.
    body: { timeout: SESSION_TTL_SECONDS },
  })
  if (!created.id || !created.connectUrl) {
    throw new BrowserbaseError('Browserbase did not return a session.', 502)
  }

  let connection: CdpConnection | null = null
  try {
    connection = await connectCdp(created.connectUrl, CONNECT_TIMEOUT_MS)
    const page = pageFromConnection(connection)
    await page.navigate(url)
    return {
      id: created.id,
      connection,
      page,
      liveUrl: `https://www.browserbase.com/sessions/${created.id}`,
    }
  } catch (error) {
    connection?.close()
    await endApplySession(config, created.id).catch(() => {})
    throw error instanceof BrowserbaseError
      ? error
      : new BrowserbaseError(
          error instanceof Error ? error.message : 'The application page could not be opened.',
          502,
        )
  }
}

export async function endApplySession(
  config: { browserbaseKey: string | null },
  sessionId: string,
) {
  const apiKey = key(config)
  await rest(apiKey, `/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {})
}

export async function closeApplySession(
  config: { browserbaseKey: string | null },
  session: ApplySession,
) {
  session.connection.close()
  await endApplySession(config, session.id)
}
