import { createMiddleware } from 'hono/factory'

import type { AppEnv } from './session'

const buckets = new Map<string, number[]>()
let operations = 0

export class RateLimitError extends Error {
  readonly status = 429
  readonly retryAfter: number

  constructor(retryAfter: number) {
    super(`Too many requests. Wait ${retryAfter} seconds and try again.`)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
) {
  const recent = (buckets.get(key) ?? []).filter((time) => now - time < windowMs)
  if (recent.length >= limit) {
    buckets.set(key, recent)
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)),
    }
  }
  recent.push(now)
  buckets.set(key, recent)

  operations += 1
  if (operations % 256 === 0) {
    for (const [bucketKey, timestamps] of buckets) {
      const active = timestamps.filter((time) => now - time < windowMs)
      if (active.length) buckets.set(bucketKey, active)
      else buckets.delete(bucketKey)
    }
  }

  return { allowed: true as const, retryAfter: 0 }
}

export function userRateLimit(
  name: string,
  limit: number,
  windowMs = 60_000,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get('session')
    const result = consumeRateLimit(`${name}:${session.user.id}`, limit, windowMs)
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfter))
      return c.json(
        { error: `Too many ${name} requests. Wait a moment and try again.` },
        429,
      )
    }
    await next()
  })
}
