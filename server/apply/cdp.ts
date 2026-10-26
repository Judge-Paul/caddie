/**
 * Minimal CDP client over the global WebSocket.
 *
 * playwright-core stalls its handshake under Bun while a raw socket opens
 * fine, so this speaks the few DevTools methods the form filler needs and
 * nothing else: navigation, evaluation, trusted input, file selection and
 * screenshots. The browser itself still runs on Browserbase.
 */

export class CdpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CdpError'
  }
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  method: string
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CdpError(`${what} timed out.`)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

export type CdpConnection = {
  socket: WebSocket
  send: (
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ) => Promise<unknown>
  listTargets: () => Promise<{ type?: string; targetId?: string; url?: string }[]>
  attach: (targetId: string) => Promise<string>
  close: () => void
}

export async function connectCdp(connectUrl: string, timeoutMs = 30_000): Promise<CdpConnection> {
  const socket = await withTimeout(
    new Promise<WebSocket>((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(connectUrl)
      ws.onopen = () => {
        if (!settled) {
          settled = true
          resolve(ws)
        }
      }
      ws.onerror = () => {
        if (!settled) {
          settled = true
          reject(new CdpError('Could not open the browser session.'))
        }
      }
      ws.onclose = () => {
        if (!settled) {
          settled = true
          reject(new CdpError('The browser session closed before connecting.'))
        }
      }
    }),
    timeoutMs,
    'Browser session connect',
  )

  let nextId = 1
  const pending = new Map<number, Pending>()
  socket.onmessage = (event) => {
    let message: { id?: number; result?: unknown; error?: { message?: string } }
    try {
      message = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (typeof message.id !== 'number') return
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) {
      waiter.reject(
        new CdpError(`${message.error.message || 'Browser call failed.'} [method=${waiter.method}]`),
      )
    }
    else waiter.resolve(message.result)
  }
  socket.onerror = () => {
    for (const waiter of pending.values()) {
      waiter.reject(new CdpError('The browser session dropped.'))
    }
    pending.clear()
  }

  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject, method })
      socket.send(
        JSON.stringify(
          sessionId ? { id, method, params, sessionId } : { id, method, params },
        ),
      )
    })

  const listTargets = async () => {
    const targets = (await send('Target.getTargets')) as {
      targetInfos?: { type?: string; targetId?: string; url?: string }[]
    }
    return targets.targetInfos ?? []
  }

  const attach = async (targetId: string) => {
    const attached = (await send('Target.attachToTarget', {
      targetId,
      flatten: true,
    })) as { sessionId?: string }
    if (!attached.sessionId) {
      throw new CdpError('Could not attach to the browser page.')
    }
    const bound = (method: string, params: Record<string, unknown> = {}) =>
      send(method, params, attached.sessionId)
    await bound('Page.enable')
    await bound('DOM.enable')
    return attached.sessionId as string
  }

  return {
    socket,
    send,
    listTargets,
    attach,
    close: () => {
      try {
        socket.close()
      } catch {
        // Already gone.
      }
    },
  }
}

export type CdpFrame = {
  sessionId: string
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  evaluate: <T>(expression: string) => Promise<T>
}

export type CdpPage = CdpFrame & {
  navigate: (url: string, timeoutMs?: number) => Promise<void>
  waitReady: (timeoutMs?: number) => Promise<void>
}

export function frameFromSession(
  connection: CdpConnection,
  sessionId: string,
): CdpFrame {
  const send = (method: string, params: Record<string, unknown> = {}) =>
    connection.send(method, params, sessionId)
  const evaluate = async <T>(expression: string) => {
    const result = (await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: T } }
    return result.result?.value as T
  }
  return { sessionId, send, evaluate }
}

export function pageFromSession(connection: CdpConnection, sessionId: string): CdpPage {
  const frame = frameFromSession(connection, sessionId)
  const { send, evaluate } = frame

  const waitReady = async (timeoutMs = 30_000) => {
    const started = Date.now()
    for (;;) {
      const state = await evaluate<string>('document.readyState').catch(() => '')
      if (state === 'complete' || state === 'interactive') return
      if (Date.now() - started > timeoutMs) {
        throw new CdpError('The page took too long to load.')
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  return {
    ...frame,
    waitReady,
    navigate: async (url: string, timeoutMs = 45_000) => {
      await withTimeout(
        (async () => {
          await send('Page.navigate', { url })
          await waitReady(timeoutMs)
        })(),
        timeoutMs + 15_000,
        'Page navigation',
      )
    },
  }
}

export type ElementCenter = { x: number; y: number }

export function refSelector(refNumber: number) {
  return `[data-caddie-ref="${refNumber}"]`
}

/** Resolve a stamped element to clickable viewport coordinates. */
export async function centerOfRef(
  frame: CdpFrame,
  refNumber: number,
): Promise<ElementCenter | null> {
  const point = await frame
    .evaluate<{ x?: number; y?: number }>(
      `(() => {
        const el = document.querySelector(${JSON.stringify(refSelector(refNumber))});
        if (!el) return {};
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return {};
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
    )
    .catch(() => null)
  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
    return null
  }
  return { x: point.x, y: point.y }
}
