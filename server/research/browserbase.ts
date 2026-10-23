import type { ServerConfig } from '../env'

const API_ROOT = 'https://api.browserbase.com/v1'
const TIMEOUT_MS = 25_000

export class BrowserbaseError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'BrowserbaseError'
    this.status = status
  }
}

export type SearchResult = {
  title: string
  url: string
}

type SearchResponse = {
  results?: { title?: string; url?: string }[]
}

type FetchResponse = {
  statusCode?: number
  content?: unknown
}

function friendlyMessage(message: string, status: number) {
  if (status === 401 || status === 403) {
    return 'Browserbase rejected the API key. Check BROWSERBASE_API_KEY in .env.local.'
  }
  if (status === 402) {
    return 'The Browserbase plan cannot make that request. Check usage and plan limits.'
  }
  if (status === 429) {
    return 'Browserbase is rate limiting requests. Try again in a moment.'
  }
  return message
}

async function post<T>(
  path: string,
  config: ServerConfig,
  body: unknown,
): Promise<T> {
  if (!config.browserbaseKey) {
    throw new BrowserbaseError('Company research needs BROWSERBASE_API_KEY.', 503)
  }

  let response: Response

  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: 'POST',
      headers: {
        'X-BB-API-Key': config.browserbaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new BrowserbaseError('Browserbase took too long to answer.', 504)
    }
    throw new BrowserbaseError('Could not reach Browserbase.', 502)
  }

  const payload = (await response.json().catch(() => null)) as
    | (T & { message?: string; error?: string })
    | null

  if (!response.ok || !payload) {
    const detail = payload?.message ?? payload?.error ?? `Request failed (${response.status}).`
    throw new BrowserbaseError(friendlyMessage(detail, response.status), 502)
  }

  return payload
}

export async function searchWeb(
  config: ServerConfig,
  query: string,
  numResults = 8,
): Promise<SearchResult[]> {
  const result = await post<SearchResponse>('/search', config, {
    query: query.slice(0, 200),
    numResults: Math.min(25, Math.max(1, numResults)),
  })

  return (result.results ?? []).flatMap((entry) => {
    if (!entry.url || !entry.title) return []
    try {
      new URL(entry.url)
      return [{ title: entry.title, url: entry.url }]
    } catch {
      return []
    }
  })
}

export async function fetchMarkdown(
  config: ServerConfig,
  url: string,
): Promise<string> {
  const result = await post<FetchResponse>('/fetch', config, {
    url,
    format: 'markdown',
    allowRedirects: true,
  })

  return typeof result.content === 'string' ? result.content : ''
}
