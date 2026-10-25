import { mongo } from '../mongo'
import type { TelegramLinkDoc } from './links'

export type TelegramSessionState =
  | 'idle'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_email'

export type TelegramHistoryMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type TelegramSessionDoc = {
  chatId: string
  userId: string
  activeApplicationId: string | null
  state: TelegramSessionState
  pendingEmail: string | null
  history: TelegramHistoryMessage[]
  updatedAt: Date
}

function collection() {
  const db = mongo()?.db
  if (!db) throw new Error('Telegram needs MONGODB_URI in .env.local.')
  return db.collection<TelegramSessionDoc>('telegramSessions')
}

export async function getTelegramSession(chatId: string, userId: string) {
  return collection().findOne({ chatId: String(chatId), userId })
}

export async function saveTelegramSession(
  chatId: string,
  userId: string,
  patch: Partial<
    Pick<
      TelegramSessionDoc,
      'activeApplicationId' | 'state' | 'pendingEmail' | 'history'
    >
  >,
) {
  await collection().updateOne(
    { chatId: String(chatId) },
    {
      $set: { ...patch, userId, updatedAt: new Date() },
      $setOnInsert: { chatId: String(chatId) },
    },
    { upsert: true },
  )
}

export async function clearTelegramSession(chatId: string) {
  await collection().updateOne(
    { chatId: String(chatId) },
    {
      $set: {
        activeApplicationId: null,
        state: 'idle',
        pendingEmail: null,
        history: [],
        updatedAt: new Date(),
      },
    },
  )
}

export function withHistory(
  history: TelegramHistoryMessage[] | undefined,
  message: TelegramHistoryMessage,
) {
  return [...(history ?? []), message].slice(-10)
}

export async function telegramUser(
  link: TelegramLinkDoc,
): Promise<{ id: string; name: string; email: string; image: string | null } | null> {
  const db = mongo()?.db
  if (!db) return null
  const { ObjectId } = await import('mongodb')
  if (!ObjectId.isValid(link.userId)) return null
  const user = await db.collection('user').findOne({
    _id: new ObjectId(link.userId),
  })
  if (!user) return null
  return {
    id: link.userId,
    name: typeof user.name === 'string' ? user.name : '',
    email: typeof user.email === 'string' ? user.email : '',
    image: typeof user.image === 'string' ? user.image : null,
  }
}
