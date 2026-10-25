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
  windowMs = 60_000,
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

const DAY_MS = 24 * 60 * 60 * 1000

export function userDailyLimit(name: string, limit: number) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get('session')
    const result = consumeRateLimit(
      `${name} day:${session.user.id}`,
      limit,
      DAY_MS,
    )
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfter))
      return c.json(
        { error: `Daily limit reached for ${name}. Try again tomorrow.` },
        429,
      )
    }
    await next()
  })
}

export function deepCvReadLimit() {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.query('mode') !== 'deep') return next()
    const session = c.get('session')
    const minute = consumeRateLimit(`CV deep:${session.user.id}`, 2)
    if (!minute.allowed) {
      c.header('Retry-After', String(minute.retryAfter))
      return c.json(
        { error: 'Too many deep CV reads. Wait a moment and try again.' },
        429,
      )
    }
    const day = consumeRateLimit(`CV deep day:${session.user.id}`, 10, DAY_MS)
    if (!day.allowed) {
      c.header('Retry-After', String(day.retryAfter))
      return c.json(
        { error: 'Daily limit reached for deep CV reads. Try again tomorrow.' },
        429,
      )
    }
    await next()
  })
}

function clientIp(c: { req: { header: (name: string) => string | undefined } }) {
  const forwarded = c.req.header('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return (
    c.req.header('cf-connecting-ip')?.trim() ||
    first ||
    c.req.header('x-real-ip')?.trim() ||
    'unknown'
  )
}

export function previewRateLimit(limit = 30, windowMs = 60_000) {
  return createMiddleware(async (c, next) => {
    const result = consumeRateLimit(
      `preview:${clientIp(c)}`,
      limit,
      windowMs,
    )
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfter))
      return c.json(
        { error: 'Too many preview requests. Wait a moment and try again.' },
        429,
      )
    }
    await next()
  })
}
