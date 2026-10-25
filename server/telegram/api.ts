const API_ROOT = process.env.TELEGRAM_API_ROOT?.trim() || 'https://api.telegram.org'
const TIMEOUT_MS = 20_000

export class TelegramApiError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'TelegramApiError'
    this.status = status
  }
}

export function telegramToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (!token) {
    throw new TelegramApiError(
      'Telegram is not configured. Add TELEGRAM_BOT_TOKEN to .env.local.',
      503,
    )
  }
  return token
}

async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_ROOT}/bot${telegramToken()}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new TelegramApiError('Telegram could not be reached.', 502)
  }

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; result?: T; description?: string }
    | null
  if (!payload?.ok) {
    throw new TelegramApiError(
      payload?.description || `Telegram returned ${response.status}.`,
      502,
    )
  }
  return payload.result as T
}

export async function sendTelegramText(chatId: string, text: string) {
  return call<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text: text.slice(0, 4_000),
    disable_web_page_preview: true,
  })
}

export async function telegramChatInfo(chatId: string) {
  return call<{
    id: number
    username?: string
    first_name?: string
  }>('getChat', { chat_id: chatId })
}

export async function downloadTelegramFile(fileId: string) {
  const file = await call<{ file_path?: string; file_size?: number }>('getFile', {
    file_id: fileId,
  })
  if (!file.file_path) {
    throw new TelegramApiError('Telegram did not provide that file.', 502)
  }
  if (file.file_size && file.file_size > 20 * 1024 * 1024) {
    throw new TelegramApiError('That file is larger than 20 MB.', 413)
  }

  let response: Response
  try {
    response = await fetch(
      `${API_ROOT}/file/bot${telegramToken()}/${file.file_path}`,
      { signal: AbortSignal.timeout(30_000) },
    )
  } catch {
    throw new TelegramApiError('Telegram could not send that file.', 502)
  }
  if (!response.ok) {
    throw new TelegramApiError('Telegram could not send that file.', 502)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > 20 * 1024 * 1024) {
    throw new TelegramApiError('That file is larger than 20 MB.', 413)
  }
  return bytes
}
