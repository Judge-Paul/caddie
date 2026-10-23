import {
  companyKey,
  extractJson,
  normaliseCompanyProfile,
  type ResearchResult,
} from '../../shared/jd-classification'
import { readCache, writeCache } from '../cache'
import { runChat } from '../cloudflare'
import { rememberIdentity } from '../company-identity'
import type { ServerConfig } from '../env'
import {
  BrowserbaseError,
  fetchMarkdown,
  searchWeb,
  type SearchResult,
} from './browserbase'
import { researchMessages } from './prompt'
import type { ResearchInput } from './prompt'

const NAMESPACE = 'research-v1'
const TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_PAGES = 4

const BLOCKED_HOSTS = new Set([
  'x.com',
  'twitter.com',
  'youtube.com',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'reddit.com',
])

/** Directories and job boards are useful for funding and founders, but the
 * company's own site should be read first. */
const AGGREGATORS = new Set([
  'ycombinator.com',
  'news.ycombinator.com',
  'builtin.com',
  'crunchbase.com',
  'wellfound.com',
  'engg.space',
  'theirstack.com',
  'otta.com',
  'glassdoor.com',
  'g2.com',
])

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Social and video results rarely carry company facts and are expensive to read. */
function pickPages(results: SearchResult[]) {
  const byHost = new Map<string, SearchResult>()

  for (const result of results) {
    const host = hostOf(result.url)
    if (!host || BLOCKED_HOSTS.has(host) || byHost.has(host)) continue
    byHost.set(host, result)
  }

  const unique = [...byHost.values()]
  const official = unique.find((result) => !AGGREGATORS.has(hostOf(result.url)))
  const ordered = official ? [official, ...unique.filter((item) => item !== official)] : unique

  return ordered.slice(0, MAX_PAGES)
}

async function readSources(config: ServerConfig, pages: SearchResult[]) {
  const fetched = await Promise.allSettled(
    pages.map((page) => fetchMarkdown(config, page.url)),
  )

  return pages.flatMap((page, index) => {
    const result = fetched[index]
    if (!result || result.status !== 'fulfilled') return []
    const content = result.value.trim()
    if (content.length < 200) return []
    return [{ title: page.title, url: page.url, content }]
  })
}

export async function researchCompany(
  input: { company: string; role: string; jd: string },
  config: ServerConfig,
): Promise<ResearchResult> {
  if (!config.browserbaseKey) {
    throw new BrowserbaseError(
      'Company research is not configured. Add BROWSERBASE_API_KEY to .env.local.',
      503,
    )
  }

  const started = performance.now()
  const key = companyKey(input.company)
  const cached = await readCache<ResearchResult['profile']>(NAMESPACE, key, TTL_MS)

  if (cached) {
    return {
      profile: cached,
      meta: { cached: true, latencyMs: 0, sourceCount: cached.sources.length },
    }
  }

  const query = `${input.company} ${input.role} company founders`.slice(0, 200)
  const results = await searchWeb(config, query, 8)
  if (results.length === 0) {
    throw new BrowserbaseError('Browserbase found no pages for that company.', 502)
  }

  const sources = await readSources(config, pickPages(results))
  if (sources.length === 0) {
    throw new BrowserbaseError('Could not read any company pages for that name.', 502)
  }

  const researchInput: ResearchInput = {
    company: input.company,
    role: input.role,
    jd: input.jd,
    sources,
  }

  let lastReply = ''

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const messages =
      attempt === 1
        ? researchMessages(researchInput)
        : [
            ...researchMessages(researchInput),
            { role: 'assistant' as const, content: lastReply.slice(0, 4000) },
            {
              role: 'user' as const,
              content:
                'That reply was not a single valid JSON object. Return only the JSON object with every brace closed and no prose.',
            },
          ]

    const reply = await runChat(config, {
      model: config.gemmaModel,
      messages,
      maxTokens: 1800,
      temperature: 0,
    })
    lastReply = reply.text

    try {
      const profile = normaliseCompanyProfile(extractJson(reply.text), input.company)

      if (!profile.summary && profile.sectors.length === 0 && profile.signals.length === 0) {
        throw new Error('The research returned no company facts.')
      }

      if (profile.sources.length === 0) {
        profile.sources = sources.map((source) => source.url)
      }
      if (profile.links.length === 0) {
        profile.links = sources.slice(0, 3).map((source) => ({
          title: source.title,
          url: source.url,
        }))
      }

      await writeCache(NAMESPACE, key, profile)
      await rememberIdentity(profile.name || input.company, profile.sectors)

      return {
        profile,
        meta: {
          cached: false,
          latencyMs: Math.round(performance.now() - started),
          sourceCount: sources.length,
        },
      }
    } catch {
      // one repair attempt
    }
  }

  throw new BrowserbaseError(
    `Could not read company data for ${input.company}. Try again.`,
    502,
  )
}
