import type { ServerConfig } from './env'

const API_ROOT = 'https://api.cloudflare.com/client/v4/accounts'
const REQUEST_TIMEOUT_MS = 60_000

export class CloudflareError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'CloudflareError'
    this.status = status
  }
}

type Envelope<T> = {
  success?: boolean
  result?: T
  errors?: { message?: string; code?: number }[]
}

/** Turn Cloudflare's operator-facing errors into something a reader can act on. */
function friendlyMessage(message: string, status: number) {
  if (/insufficient balance/i.test(message)) {
    return 'This model needs Cloudflare credits on the account (or a BYOK key) before it can run.'
  }
  if (/no such model/i.test(message)) {
    return 'Cloudflare does not offer that model on this account.'
  }
  if (/authentication|unauthorized|invalid api token/i.test(message) || status === 401) {
    return 'Cloudflare rejected the API token. Check CF_API_KEY in .env.local.'
  }
  return message
}

async function postJson<T>(
  url: string,
  config: ServerConfig,
  body: unknown,
): Promise<T> {
  let response: Response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new CloudflareError('The model took too long to answer. Try again.', 504)
    }
    throw new CloudflareError('Could not reach Cloudflare Workers AI.', 502)
  }

  const payload = (await response.json().catch(() => null)) as Envelope<T> | null

  if (!payload) {
    throw new CloudflareError('Cloudflare returned an unreadable response.', 502)
  }

  if (payload.success === false || payload.result === undefined) {
    const detail = payload.errors?.[0]?.message ?? `Request failed (${response.status}).`
    throw new CloudflareError(friendlyMessage(detail, response.status), 502)
  }

  return payload.result
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ChatUsage = Record<string, number>

export type ChatResult = {
  text: string
  usage?: ChatUsage
}

type ChatCompletion = {
  choices?: { message?: { content?: string | null } }[]
  usage?: ChatUsage
}

export async function runChat(
  config: ServerConfig,
  options: {
    model: string
    messages: ChatMessage[]
    maxTokens: number
    temperature?: number
    /** Gemma 4 reasons before it answers; the classifier wants the answer only. */
    thinking?: boolean
  },
): Promise<ChatResult> {
  const result = await postJson<ChatCompletion>(
    `${API_ROOT}/${config.accountId}/ai/run/${options.model}`,
    config,
    {
      messages: options.messages,
      max_completion_tokens: options.maxTokens,
      temperature: options.temperature ?? 0.1,
      chat_template_kwargs: { enable_thinking: options.thinking ?? false },
    },
  )

  return {
    text: result.choices?.[0]?.message?.content ?? '',
    usage: result.usage,
  }
}

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | {
      type: 'choice'
      choice: string
      confidence?: number
      probabilities?: Record<string, number>
    }
  | { type: 'score'; score: number; confidence?: number }

export type JevResult = {
  answers: Record<string, JevAnswer>
  usage?: ChatUsage
}

type JevResponse = {
  answers?: Record<string, JevAnswer>
  usage?: ChatUsage
}

/**
 * `typesafe/jev-1.14.0` is a decision model: it answers typed questions about a
 * state and cannot generate text. It is billed as a third-party model, so it
 * needs Cloudflare credits even when the account's Workers AI allowance is free.
 */
export async function runJev(
  config: ServerConfig,
  input: { state: string; questions: Record<string, JevQuestion> },
): Promise<JevResult> {
  const result = await postJson<JevResponse>(`${API_ROOT}/${config.accountId}/ai/run`, config, {
    model: config.jevModel,
    input,
  })

  return {
    answers: result.answers ?? {},
    usage: result.usage,
  }
}
