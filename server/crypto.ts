import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export class SecretError extends Error {
  readonly status = 503

  constructor(message: string) {
    super(message)
    this.name = 'SecretError'
  }
}

function encryptionKey() {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim()
  if (!raw) {
    throw new SecretError(
      'Add APP_ENCRYPTION_KEY to .env.local before saving a sending key.',
    )
  }

  const key = Buffer.from(raw, 'base64')
  if (key.byteLength !== 32) {
    throw new SecretError(
      'APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded. Generate one with: openssl rand -base64 32',
    )
  }

  return key
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
}

export function decryptSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !encrypted) {
    throw new SecretError('The stored sending key is unreadable. Reconnect Resend.')
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(iv, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch (error) {
    if (error instanceof SecretError) throw error
    throw new SecretError('The stored sending key could not be opened. Reconnect Resend.')
  }
}
