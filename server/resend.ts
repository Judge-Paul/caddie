import { AccountError } from './account'

const API_ROOT = 'https://api.resend.com'
const TIMEOUT_MS = 20_000

type ResendDomain = {
  id?: string
  name?: string
  status?: string
}

type ResendList = {
  data?: ResendDomain[]
}

type ResendErrorPayload = {
  message?: string
  name?: string
}

function domainOf(email: string) {
  return email.split('@')[1]?.trim().toLowerCase() ?? ''
}

async function request<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new AccountError('Resend took too long to answer. Try again.', 504)
    }
    throw new AccountError('Could not reach Resend. Try again.', 502)
  }

  const payload = (await response.json().catch(() => null)) as
    | (T & ResendErrorPayload)
    | null

  if (!response.ok) {
    if (
      response.status === 401 ||
      response.status === 403 ||
      /invalid api key/i.test(payload?.message ?? '')
    ) {
      throw new AccountError(
        'Resend rejected that API key. Check the key and try again.',
        422,
      )
    }
    throw new AccountError(
      payload?.message || `Resend returned ${response.status}.`,
      422,
    )
  }

  if (!payload) {
    throw new AccountError('Resend returned an unreadable response.', 502)
  }

  return payload
}

export async function verifyResendKey(apiKey: string, email: string) {
  const domain = domainOf(email)
  if (!domain) throw new AccountError('Enter a valid sending email address.', 400)

  const result = await request<ResendList>(apiKey, '/domains')
  const match = (result.data ?? []).find(
    (entry) => entry.name?.trim().toLowerCase() === domain,
  )

  if (!match) {
    throw new AccountError(
      `Resend does not have ${domain}. Add and verify that domain in Resend first.`,
      422,
    )
  }

  if (match.status !== 'verified') {
    throw new AccountError(
      `Resend has not verified ${domain} yet (status: ${match.status ?? 'unknown'}).`,
      422,
    )
  }

  return { domain, verifiedAt: new Date() }
}

export type ResendAttachment = {
  filename: string
  content: string
}

export async function sendResendEmail(input: {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
  attachments?: ResendAttachment[]
}) {
  const payload = await request<{ id?: string }>(input.apiKey, '/emails', {
    method: 'POST',
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    }),
  })

  if (!payload.id) {
    throw new AccountError('Resend accepted the request but returned no email id.', 502)
  }

  return { id: payload.id }
}

export { domainOf }
