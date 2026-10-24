import type { SaveSendingInput, SendingSettings } from '../shared/account'
import { AccountError } from './account'
import { decryptSecret, encryptSecret } from './crypto'
import { mongo } from './mongo'
import { verifyResendKey } from './resend'

export type StoredSending = {
  email: string
  fromName: string | null
  domain: string
  keyCiphertext: string
  keyLast4: string
  verifiedAt: Date
}

type ProfileDoc = {
  userId: string
  sending?: StoredSending | null
}

function store() {
  const mongoStore = mongo()
  if (!mongoStore) {
    throw new AccountError(
      'Accounts are not configured. Add MONGODB_URI to .env.local.',
      503,
    )
  }
  return mongoStore
}

async function profileOf(userId: string) {
  return store().db.collection<ProfileDoc>('profiles').findOne({ userId })
}

export function sendingDto(sending?: StoredSending | null): SendingSettings {
  return {
    email: sending?.email ?? null,
    fromName: sending?.fromName ?? null,
    domain: sending?.domain ?? null,
    hasKey: Boolean(sending?.keyCiphertext),
    keyLast4: sending?.keyLast4 ?? null,
    verified: Boolean(sending?.keyCiphertext && sending?.verifiedAt),
    verifiedAt: sending?.verifiedAt?.toISOString() ?? null,
  }
}

export async function getSending(userId: string) {
  return sendingDto((await profileOf(userId))?.sending)
}

function cleanEmail(value: string) {
  const email = value.trim()
  if (
    !email ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new AccountError('Enter a valid sending email address.', 400)
  }
  return email
}

function cleanName(value: string | null | undefined) {
  const name = (value ?? '').replace(/[<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim()
  if (name.length > 80) {
    throw new AccountError('Keep the sender name under 80 characters.', 400)
  }
  return name || null
}

export async function saveSending(userId: string, input: SaveSendingInput) {
  const email = cleanEmail(input.email)
  const fromName = cleanName(input.fromName)
  const profile = await profileOf(userId)
  const previous = profile?.sending ?? null

  const nextKey = input.apiKey?.trim() ?? ''
  if (nextKey && (nextKey.length < 10 || nextKey.length > 200)) {
    throw new AccountError('That does not look like a Resend API key.', 400)
  }

  const storedKey = previous?.keyCiphertext
    ? decryptSecret(previous.keyCiphertext)
    : null
  const apiKey = nextKey || storedKey

  if (!apiKey) {
    throw new AccountError('Add a Resend API key before saving.', 400)
  }

  const verification = await verifyResendKey(apiKey, email)
  const keyCiphertext = nextKey ? encryptSecret(nextKey) : previous!.keyCiphertext
  const keyLast4 = nextKey ? nextKey.slice(-4) : previous!.keyLast4

  const sending: StoredSending = {
    email,
    fromName,
    domain: verification.domain,
    keyCiphertext,
    keyLast4,
    verifiedAt: verification.verifiedAt,
  }

  await store().db.collection<ProfileDoc>('profiles').updateOne(
    { userId },
    {
      $set: { sending, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  )

  return sendingDto(sending)
}

export async function testSending(userId: string) {
  const profile = await profileOf(userId)
  const sending = profile?.sending
  if (!sending?.keyCiphertext || !sending.email) {
    throw new AccountError('Connect Resend in Profile first.', 409)
  }

  const apiKey = decryptSecret(sending.keyCiphertext)
  const verification = await verifyResendKey(apiKey, sending.email)
  const next: StoredSending = {
    ...sending,
    domain: verification.domain,
    verifiedAt: verification.verifiedAt,
  }

  await store().db.collection<ProfileDoc>('profiles').updateOne(
    { userId },
    { $set: { sending: next, updatedAt: new Date() } },
  )

  return sendingDto(next)
}

export async function deleteSending(userId: string) {
  const profile = await profileOf(userId)
  if (!profile?.sending) return sendingDto(null)

  await store().db.collection<ProfileDoc>('profiles').updateOne(
    { userId },
    { $unset: { sending: '' }, $set: { updatedAt: new Date() } },
  )

  return sendingDto(null)
}

export async function deleteSendingKey(userId: string) {
  const profile = await profileOf(userId)
  if (!profile?.sending) return sendingDto(null)

  await store().db.collection<ProfileDoc>('profiles').updateOne(
    { userId },
    {
      $unset: {
        'sending.keyCiphertext': '',
        'sending.keyLast4': '',
        'sending.verifiedAt': '',
      },
      $set: { updatedAt: new Date() },
    },
  )

  return getSending(userId)
}

export async function sendingForSend(userId: string) {
  const profile = await profileOf(userId)
  const sending = profile?.sending
  if (!sending?.keyCiphertext || !sending.email) {
    throw new AccountError('Connect Resend in Profile before sending.', 409)
  }

  return {
    apiKey: decryptSecret(sending.keyCiphertext),
    email: sending.email,
    fromName: sending.fromName,
    domain: sending.domain,
  }
}
