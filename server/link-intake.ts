import { isIP } from 'node:net'

import { findApplicationEmail } from '../shared/application-email'
import {
  classifyAts,
  findApplicationUrl,
  isAggregatorUrl,
  type ApplicationForm,
} from '../shared/application-form'
import { NOT_JD_MESSAGE, guardJd } from '../shared/jd-guard'
import { AccountError, saveApplicationSource } from './account'
import {
  prepareApplication,
  type PipelineProgress,
  type PreparedApplication,
} from './application-pipeline'
import { readConfig } from './env'
import { consumeRateLimit, RateLimitError } from './rate-limit'
import { BrowserbaseError, fetchJson } from './research/browserbase'
import { validateJd } from './validate'

export const MAX_LINK_JD_CHARS = 40_000

export class LinkNotPostingError extends AccountError {
  constructor(message: string) {
    super(message, 422)
    this.name = 'LinkNotPostingError'
  }
}

function publicWebUrl(raw: string) {
  const text = raw.trim()
  if (!text) throw new AccountError('Send a link to read.', 400)
  if (text.length > 2_048) throw new AccountError('That link is too long.', 400)

  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new AccountError('Enter a valid http or https link.', 400)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new AccountError('Enter a public http or https link.', 400)
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '::1' ||
    (isIP(host) === 4 &&
      /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host)) ||
    (isIP(host) === 6 && /^(fc|fd|fe80:)/i.test(host))
  ) {
    throw new AccountError('Enter a public link, not a local address.', 400)
  }
  return withScheme
}

const POSTING_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'The job title, without company name or location.',
    },
    text: {
      type: 'string',
      description:
        'The full job posting text: role, responsibilities, requirements, benefits, and exactly how to apply, including any application email or apply link. Exclude navigation, headers, footers, cookie banners, and unrelated job listings.',
    },
  },
  required: ['text'],
}

function cleanPostingText(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n/g, '\n').trim()
}

export async function fetchValidatedPosting(
  userId: string,
  rawUrl: string,
): Promise<{ title: string | null; text: string; form: ApplicationForm | null }> {
  const quota = consumeRateLimit(`link-intake:${userId}`, 3, 60_000)
  if (!quota.allowed) throw new RateLimitError(quota.retryAfter)

  const url = publicWebUrl(rawUrl)
  const config = readConfig()

  let title: string | null = null
  let text = ''
  try {
    const result = await fetchJson(config, url, POSTING_SCHEMA)
    title = typeof result?.title === 'string' ? result.title.trim().slice(0, 120) || null : null
    text = cleanPostingText(result?.text)
  } catch (error) {
    if (error instanceof BrowserbaseError) {
      throw new AccountError('That page could not be read. Paste the posting text instead.', 502)
    }
    throw error
  }

  if (text.length < 40) {
    throw new LinkNotPostingError('That page does not look like a job posting.')
  }
  if (text.length > MAX_LINK_JD_CHARS) {
    throw new AccountError('That posting is too long. Trim it below 40,000 characters.', 413)
  }

  const guard = guardJd(text)
  if (guard.verdict === 'not-jd') {
    throw new LinkNotPostingError(guard.message || NOT_JD_MESSAGE)
  }

  const validation = await validateJd(text, config)
  if (!validation.allowed) {
    throw new LinkNotPostingError(validation.reason || NOT_JD_MESSAGE)
  }

  const form =
    findApplicationUrl(text) ??
    (isAggregatorUrl(url)
      ? null
      : {
          url,
          ats: classifyAts(url) ?? 'custom',
          supported: classifyAts(url) !== 'unsupported',
        })

  return { title, text, form }
}

/**
 * Read a posted link, validate it is a posting, then run the normal
 * application pipeline on the fetched text. The email-vs-form question is
 * answered from the same text: an application email prefills the draft, a
 * form URL is stored on the application for the fill step.
 */
export async function intakeLinkApplication(
  userId: string,
  rawUrl: string,
  options: {
    onProgress?: PipelineProgress
    applicantName?: string | null
  } = {},
): Promise<PreparedApplication & { email: string | null }> {
  const fetched = await fetchValidatedPosting(userId, rawUrl)
  const email = findApplicationEmail(fetched.text)

  await options.onProgress?.('Reading the linked posting…')
  const prepared = await prepareApplication(userId, fetched.text, options)
  const application = await saveApplicationSource(userId, prepared.application.id, {
    sourceUrl: rawUrl.trim(),
    form: fetched.form
      ? { url: fetched.form.url, ats: fetched.form.ats, supported: fetched.form.supported }
      : null,
  })

  return { ...prepared, application, email }
}
