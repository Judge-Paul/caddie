import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import type { TelegramStatus } from '../../shared/account'
import { mongo } from '../mongo'

const LINK_TTL_MS = 15 * 60 * 1000
const LINK_VERSION = 1

type LinkPayload = {
  v: typeof LINK_VERSION
  chat: string
  exp: number
  nonce: string
}

export type TelegramLinkDoc = {
  chatId: string
  userId: string
  username: string | null
  firstName: string | null
  autoApply: boolean
  linkedAt: Date
  updatedAt: Date
}

export class TelegramLinkError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'TelegramLinkError'
    this.status = status
  }
}

function secret() {
  const value = process.env.BETTER_AUTH_SECRET?.trim()
  if (!value) {
    throw new TelegramLinkError(
      'Telegram linking needs BETTER_AUTH_SECRET in .env.local.',
      503,
    )
  }
  return value
}

function sign(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url')
}

export function createTelegramLink(chatId: string) {
  const payload: LinkPayload = {
    v: LINK_VERSION,
    chat: String(chatId),
    exp: Date.now() + LINK_TTL_MS,
    nonce: randomBytes(12).toString('base64url'),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded)}`
}

function verifyTelegramLink(token: string): LinkPayload {
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) {
    throw new TelegramLinkError('That Telegram link is invalid.', 400)
  }
  const expected = sign(encoded)
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new TelegramLinkError('That Telegram link is invalid.', 400)
  }
  let payload: LinkPayload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as LinkPayload
  } catch {
    throw new TelegramLinkError('That Telegram link is invalid.', 400)
  }
  if (payload.v !== LINK_VERSION || !payload.chat || !payload.exp) {
    throw new TelegramLinkError('That Telegram link is invalid.', 400)
  }
  if (payload.exp < Date.now()) {
    throw new TelegramLinkError('That Telegram link has expired. Send /start again.', 410)
  }
  return payload
}

function store() {
  const db = mongo()?.db
  if (!db) {
    throw new TelegramLinkError(
      'Telegram linking needs MONGODB_URI in .env.local.',
      503,
    )
  }
  return db.collection<TelegramLinkDoc>('telegramLinks')
}

function status(doc: TelegramLinkDoc | null): TelegramStatus {
  if (!doc) {
    return {
      connected: false,
      username: null,
      firstName: null,
      autoApply: false,
      linkedAt: null,
    }
  }
  return {
    connected: true,
    username: doc.username,
    firstName: doc.firstName,
    autoApply: doc.autoApply,
    linkedAt: doc.linkedAt.toISOString(),
  }
}

export async function telegramStatus(userId: string) {
  return status(await store().findOne({ userId }))
}

export async function telegramLinkForChat(chatId: string) {
  return store().findOne({ chatId: String(chatId) })
}

export async function linkTelegram(
  userId: string,
  token: string,
  profile: { username?: string | null; firstName?: string | null } = {},
) {
  const payload = verifyTelegramLink(token)
  const collection = store()
  const existingChat = await collection.findOne({ chatId: payload.chat })
  if (existingChat && existingChat.userId !== userId) {
    throw new TelegramLinkError(
      'That Telegram account is already connected to another Caddie account.',
      409,
    )
  }

  const now = new Date()
  await collection.deleteMany({ userId, chatId: { $ne: payload.chat } })
  await collection.updateOne(
    { chatId: payload.chat },
    {
      $set: {
        userId,
        username: profile.username ?? existingChat?.username ?? null,
        firstName: profile.firstName ?? existingChat?.firstName ?? null,
        autoApply: existingChat?.autoApply ?? false,
        updatedAt: now,
      },
      $setOnInsert: { linkedAt: now },
    },
    { upsert: true },
  )

  return {
    chatId: payload.chat,
    telegram: await telegramStatus(userId),
  }
}

export async function unlinkTelegram(userId: string) {
  await store().deleteMany({ userId })
  return status(null)
}

export async function unlinkTelegramChat(chatId: string) {
  await store().deleteMany({ chatId: String(chatId) })
}

export async function setTelegramAuto(chatId: string, autoApply: boolean) {
  await store().updateOne(
    { chatId: String(chatId) },
    { $set: { autoApply, updatedAt: new Date() } },
  )
}

export function telegramLinkUrl(chatId: string) {
  const base = process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:5173'
  const url = new URL(base)
  url.searchParams.set('telegram', createTelegramLink(chatId))
  return url.toString()
}

export async function updateTelegramIdentity(
  chatId: string,
  profile: { username?: string | null; firstName?: string | null },
) {
  await store().updateOne(
    { chatId: String(chatId) },
    {
      $set: {
        username: profile.username ?? null,
        firstName: profile.firstName ?? null,
        updatedAt: new Date(),
      },
    },
  )
}
