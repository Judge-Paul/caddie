import { createHmac, timingSafeEqual } from 'node:crypto'

const TTL_MS = 24 * 60 * 60 * 1000
const VERSION = 1

export type PreviewKind = 'cv' | 'cover-letter'

type PreviewPayload = {
  v: typeof VERSION
  u: string
  a: string
  k: PreviewKind
  e: number
}

export class PreviewTokenError extends Error {
  readonly status: number

  constructor(message: string, status = 401) {
    super(message)
    this.name = 'PreviewTokenError'
    this.status = status
  }
}

function secret() {
  const value = process.env.BETTER_AUTH_SECRET?.trim()
  if (!value) {
    throw new PreviewTokenError('Preview links need BETTER_AUTH_SECRET.', 503)
  }
  return value
}

function sign(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url')
}

export function createPreviewToken(
  userId: string,
  applicationId: string,
  kind: PreviewKind,
) {
  const payload: PreviewPayload = {
    v: VERSION,
    u: userId,
    a: applicationId,
    k: kind,
    e: Date.now() + TTL_MS,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded)}`
}

export function verifyPreviewToken(token: string): PreviewPayload {
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) {
    throw new PreviewTokenError('That preview link is invalid.')
  }
  const expected = sign(encoded)
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new PreviewTokenError('That preview link is invalid.')
  }

  let payload: PreviewPayload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PreviewPayload
  } catch {
    throw new PreviewTokenError('That preview link is invalid.')
  }
  if (
    payload.v !== VERSION ||
    !payload.u ||
    !payload.a ||
    (payload.k !== 'cv' && payload.k !== 'cover-letter')
  ) {
    throw new PreviewTokenError('That preview link is invalid.')
  }
  if (payload.e < Date.now()) {
    throw new PreviewTokenError('That preview link has expired.', 410)
  }
  return payload
}
