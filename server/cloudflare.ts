import type { ServerConfig } from './env'

const API_ROOT = 'https://api.cloudflare.com/client/v4/accounts'
const REQUEST_TIMEOUT_MS = 60_000
const MAX_TRANSPORT_ATTEMPTS = 2
const RETRY_DELAY_MS = 500

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
    let response: Response

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ''

      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new CloudflareError(
          'The model took too long to answer. Try again.',
          504,
        )
      }

      console.error(
        `[cloudflare] transport failure (attempt ${attempt}/${MAX_TRANSPORT_ATTEMPTS})`,
        error instanceof Error
          ? { name: error.name, cause: error.cause }
          : error,
      )

      if (attempt < MAX_TRANSPORT_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt)
        continue
      }

      throw new CloudflareError('Could not reach Cloudflare Workers AI.', 502)
    }

    // Retry a rate limit or server error once. Client and auth errors do not
    // improve on a retry.
    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < MAX_TRANSPORT_ATTEMPTS
    ) {
      console.error(
        `[cloudflare] retrying HTTP ${response.status} (attempt ${attempt}/${MAX_TRANSPORT_ATTEMPTS})`,
      )
      await sleep(RETRY_DELAY_MS * attempt)
      continue
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

  throw new CloudflareError('Could not reach Cloudflare Workers AI.', 502)
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
    /** Deep CV reads may need longer than the default request timeout. */
    timeoutMs?: number
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
    options.timeoutMs,
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

/** Clef uses the same System One questions as JEV, with a different request body. */
export type ClefQuestion = JevQuestion
export type ClefAnswer = JevAnswer
export type ClefResult = {
  answers: Record<string, ClefAnswer>
  usage?: ChatUsage
}

type ClefResponse = {
  answers?: Record<string, ClefAnswer>
  usage?: ChatUsage
}

export async function runClef(
  config: ServerConfig,
  input: { state: string; questions: Record<string, ClefQuestion> },
): Promise<ClefResult> {
  const selector = config.clefModel.split('/').pop() ?? 'clef-flash'
  const result = await postJson<ClefResponse>(
    `${API_ROOT}/${config.accountId}/ai/run/${config.clefModel}`,
    config,
    { model: selector, state: input.state, questions: input.questions },
  )

  return {
    answers: result.answers ?? {},
    usage: result.usage,
  }
}
