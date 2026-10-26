import {
  connectCdp,
  frameFromSession,
  pageFromSession,
  type CdpConnection,
  type CdpFrame,
  type CdpPage,
} from './cdp'
import { BrowserbaseError } from '../research/browserbase'

const API_ROOT = 'https://api.browserbase.com/v1'
const CONNECT_TIMEOUT_MS = 30_000
const SESSION_TTL_SECONDS = 600

export type ApplySession = {
  id: string
  connection: CdpConnection
  /** The main page frame. */
  page: CdpPage
  /** Every attached frame, main first. Fields carry their frame index. */
  frames: CdpFrame[]
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
 * Opens a fresh cloud browser on Browserbase. The browser itself runs there;
 * here we only speak CDP. Every page and iframe target gets attached so the
 * snapshot sees embedded application forms too.
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
    const targets = await connection.listTargets()
    const pageTarget = targets.find((target) => target.type === 'page' && target.targetId)
    if (!pageTarget?.targetId) {
      connection.close()
      throw new BrowserbaseError('The browser session has no page.', 502)
    }

    const mainId = await connection.attach(pageTarget.targetId)
    markAttached(connection, pageTarget.targetId)
    const page = pageFromSession(connection, mainId)
    await page.navigate(url)

    const session: ApplySession = {
      id: created.id,
      connection,
      page,
      frames: [page],
      liveUrl: `https://www.browserbase.com/sessions/${created.id}`,
    }
    await refreshFrames(session)

    return session
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

const attachedTargets = new WeakMap<CdpConnection, Set<string>>()

function markAttached(connection: CdpConnection, targetId: string) {
  let known = attachedTargets.get(connection)
  if (!known) {
    known = new Set()
    attachedTargets.set(connection, known)
  }
  known.add(targetId)
}

function isAttached(connection: CdpConnection, targetId: string) {
  return attachedTargets.get(connection)?.has(targetId) ?? false
}

/**
 * Re-list targets after the page settles: embedded application forms often
 * arrive as late cross-origin iframes. Attaches anything new and appends it
 * to the session frames.
 */
export async function refreshFrames(session: ApplySession): Promise<CdpFrame[]> {
  const targets = await session.connection.listTargets().catch(() => [])
  const added: CdpFrame[] = []
  for (const target of targets) {
    if (!target.targetId) continue
    if (target.type !== 'page' && target.type !== 'iframe') continue
    if (isAttached(session.connection, target.targetId)) continue
    try {
      const frame = frameFromSession(
        session.connection,
        await session.connection.attach(target.targetId),
      )
      markAttached(session.connection, target.targetId)
      session.frames.push(frame)
      added.push(frame)
    } catch {
      // A frame that will not attach is not worth failing the run over.
    }
  }
  return added
}

export async function closeApplySession(
  config: { browserbaseKey: string | null },
  session: ApplySession,
) {
  session.connection.close()
  await endApplySession(config, session.id)
}
