import {
  companyKey,
  normaliseCompanyProfile,
  type CompanyProfile,
  type ResearchResult,
} from '../../shared/jd-classification'
import { readCache, writeCache } from '../cache'
import { rememberIdentity } from '../company-identity'
import type { ServerConfig } from '../env'
import {
  BrowserbaseError,
  fetchJson,
  searchWeb,
  type SearchResult,
} from './browserbase'
import { COMPANY_PAGE_SCHEMA } from './schema'

const NAMESPACE = 'research-v4'
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
  'ashbyhq.com',
  'greenhouse.io',
  'lever.co',
  'workable.com',
  'tracxn.com',
  'prepdb.fyi',
  'altss.com',
])

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function hostInSet(host: string, set: Set<string>) {
  for (const domain of set) {
    if (host === domain || host.endsWith(`.${domain}`)) return true
  }
  return false
}

function hostSlug(host: string) {
  return host.replace(/[^a-z0-9]/g, '')
}

function rootUrl(url: string) {
  try {
    return `${new URL(url).origin}/`
  } catch {
    return url
  }
}

/** 2 for a whole label match (cardboard.ai), 1 for a partial one (usecardboard.com). */
function officialRank(url: string, slug: string) {
  const host = hostOf(url)
  if (host.split('.').includes(slug)) return 2
  if (hostSlug(host).includes(slug)) return 1
  return 0
}

/** Pick the official domain by name match, then directories, then the rest. */
function pickPages(company: string, results: SearchResult[]) {
  const byHost = new Map<string, SearchResult>()
  const slug = companyKey(company).replace(/-/g, '')

  for (const result of results) {
    const host = hostOf(result.url)
    if (!host || hostInSet(host, BLOCKED_HOSTS) || byHost.has(host)) continue

    let path = ''
    try {
      path = new URL(result.url).pathname
    } catch {
      continue
    }

    // A directory's company profile is useful; its job and careers pages are not.
    if (hostInSet(host, AGGREGATORS) && /\/(jobs|careers)\b/i.test(path)) continue

    byHost.set(host, result)
  }

  const unique = [...byHost.values()].map((result) => ({
    result,
    rank: officialRank(result.url, slug),
  }))

  const official = unique
    .filter((entry) => entry.rank > 0)
    .sort((left, right) => right.rank - left.rank)
  const directories = unique.filter(
    (entry) =>
      entry.rank === 0 && hostInSet(hostOf(entry.result.url), AGGREGATORS),
  )
  const others = unique.filter(
    (entry) => entry.rank === 0 && !hostInSet(hostOf(entry.result.url), AGGREGATORS),
  )

  return [...official, ...directories, ...others]
    .slice(0, MAX_PAGES)
    .map((entry) =>
      entry.rank > 0
        ? { ...entry.result, url: rootUrl(entry.result.url) }
        : entry.result,
    )
}

type PageData = {
  url: string
  title: string
  data: Record<string, unknown>
}

/**
 * Browserbase extracts JSON against a schema, so no chat model has to read the
 * page. The fields are optional: a directory page contributes founders/stage,
 * the company site contributes the summary and signals.
 */
async function readPages(config: ServerConfig, pages: SearchResult[]): Promise<PageData[]> {
  const results = await Promise.allSettled(
    pages.map((page) => fetchJson(config, page.url, COMPANY_PAGE_SCHEMA)),
  )

  return pages.flatMap((page, index) => {
    const result = results[index]
    if (!result || result.status !== 'fulfilled' || !result.value) return []
    return [{ url: page.url, title: page.title, data: result.value }]
  })
}

function firstString(pages: PageData[], key: string): string | null {
  for (const page of pages) {
    const value = page.data[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function arrayOf(pages: PageData[], key: string): unknown[] {
  return pages.flatMap((page) =>
    Array.isArray(page.data[key]) ? (page.data[key] as unknown[]) : [],
  )
}

function mergeProfile(company: string, pages: PageData[]): CompanyProfile {
  const official = pages.filter((page) => !AGGREGATORS.has(hostOf(page.url)))
  const directories = pages.filter((page) => AGGREGATORS.has(hostOf(page.url)))
  const ordered = [...official, ...directories]

  const raw = {
    name: company,
    summary: firstString(ordered, 'summary'),
    sectors: arrayOf(ordered, 'sectors'),
    founders: arrayOf(ordered, 'founders'),
    stage: firstString(directories, 'stage') ?? firstString(ordered, 'stage'),
    funding: firstString(directories, 'funding') ?? firstString(ordered, 'funding'),
    links: arrayOf(ordered, 'links'),
    // The official page's signals come first; keep the list focused.
    signals: arrayOf(ordered, 'signals').slice(0, 3),
    sources: pages.map((page) => page.url),
  }

  const profile = normaliseCompanyProfile(raw, company)

  if (profile.links.length === 0) {
    profile.links = pages.slice(0, 3).map((page) => ({
      title: page.title,
      url: page.url,
    }))
  }

  return profile
}

export async function researchCompany(
  input: { company: string; role: string; fields: string[]; summary: string },
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
  const cached = await readCache<CompanyProfile>(NAMESPACE, key, TTL_MS)

  if (cached) {
    return {
      profile: cached,
      meta: { cached: true, latencyMs: 0, sourceCount: cached.sources.length },
    }
  }

  // The role fields disambiguate a company name; without them, "Cardboard" can
  // mean Google's VR viewer. Avoid the hiring summary when fields exist: it
  // pulls job boards.
  const context =
    input.fields.length > 0 ? input.fields.join(' ') : input.summary || input.role
  const query = `"${input.company}" ${context} company founders`.slice(0, 200)

  const results = await searchWeb(config, query, 8)
  if (results.length === 0) {
    throw new BrowserbaseError('Browserbase found no pages for that company.', 502)
  }

  const pages = await readPages(config, pickPages(input.company, results))
  if (pages.length === 0) {
    throw new BrowserbaseError('Could not read any company pages for that name.', 502)
  }

  const profile = mergeProfile(input.company, pages)

  if (
    !profile.summary &&
    profile.sectors.length === 0 &&
    profile.founders.length === 0 &&
    profile.signals.length === 0 &&
    profile.links.length === 0
  ) {
    throw new BrowserbaseError('The company pages did not contain usable details.', 502)
  }

  await writeCache(NAMESPACE, key, profile)
  await rememberIdentity(profile.name || input.company, profile.sectors)

  return {
    profile,
    meta: {
      cached: false,
      latencyMs: Math.round(performance.now() - started),
      sourceCount: pages.length,
    },
  }
}
