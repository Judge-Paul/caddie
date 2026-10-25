/**
 * LibreOffice is the heaviest thing this process runs. A single render at a time
 * keeps memory bounded and avoids a burst of conversions taking down the host.
 */
let active = 0
const waiters: (() => void)[] = []
const MAX_ACTIVE = 1
const MAX_WAITING = 3

export class RenderQueueFullError extends Error {
  readonly status = 429

  constructor() {
    super('The document renderer is busy. Wait a moment and retry.')
    this.name = 'RenderQueueFullError'
  }
}

export async function withRenderSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_ACTIVE) {
    if (waiters.length >= MAX_WAITING) throw new RenderQueueFullError()
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
  active += 1
  try {
    return await work()
  } finally {
    active -= 1
    waiters.shift()?.()
  }
}
