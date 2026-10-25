import { isIP } from 'node:net'

import type {
  PublicWork,
  PublicWorkProject,
  PublicWorkSource,
} from '../shared/account'
import { fetchJson, type JsonSchema } from './research/browserbase'

export class PublicWorkInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublicWorkInputError'
  }
}

export type NormalisedPublicLinks = {
  website: string | null
  github: { login: string; url: string } | null
}

const MAX_URL = 2_048
const MAX_TEXT = 600
const MAX_PROJECTS = 6
const MAX_SKILLS = 16

const WEBSITE_PROFILE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'The page or site title, without a tagline.',
    },
    headline: {
      type: 'string',
      description:
        'A short professional headline, such as "Product engineer" or "Designer and founder", only if stated.',
    },
    summary: {
      type: 'string',
      description:
        'Two or three factual sentences about the person and the work they do, only if stated.',
    },
    skills: {
      type: 'array',
      description: 'Technologies, tools or disciplines named on the page.',
      items: { type: 'string' },
    },
    projects: {
      type: 'array',
      description:
        'Selected projects, products, roles or case studies with concrete work the person did. Do not include blog posts, essays, articles or newsletter issues.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          url: { type: 'string' },
          skills: { type: 'array', items: { type: 'string' } },
        },
        required: ['name'],
      },
    },
  },
}

function text(value: unknown, max = MAX_TEXT) {
  if (typeof value !== 'string') return null
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, max) : null
}

function textList(value: unknown, max: number, maxLength = 40) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    const item = text(entry, maxLength)
    if (!item) continue
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
    if (result.length >= max) break
  }
  return result
}

function privateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local')) return true
  if (isIP(host) === 4) {
    return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(
      host,
    )
  }
  if (isIP(host) === 6) {
    return host === '::1' || /^(fc|fd|fe80):/i.test(host)
  }
  return false
}

function normaliseWebsite(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new PublicWorkInputError('Enter a website URL.')
  const raw = value.trim()
  if (!raw) return null
  if (raw.length > MAX_URL) throw new PublicWorkInputError('That website URL is too long.')

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new PublicWorkInputError('Enter a valid website URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new PublicWorkInputError('Enter a public http or https website URL.')
  }
  if (privateHost(url.hostname)) {
    throw new PublicWorkInputError('Enter a public website, not a local address.')
  }

  url.hash = ''
  return url.toString()
}

function normaliseGithub(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new PublicWorkInputError('Enter a GitHub username or URL.')
  const raw = value.trim().replace(/^@/, '')
  if (!raw) return null

  let login = raw
  if (/^https?:\/\//i.test(raw) || /^www\./i.test(raw)) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
      if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
        throw new Error('host')
      }
      login = url.pathname.split('/').filter(Boolean)[0] ?? ''
    } catch {
      throw new PublicWorkInputError('Enter a github.com profile URL.')
    }
  } else if (/^github\.com\//i.test(raw)) {
    login = raw.split('/').filter(Boolean)[1] ?? ''
  }

  login = login.replace(/^@/, '')
  if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(login)) {
    throw new PublicWorkInputError('Enter a valid GitHub username or profile URL.')
  }

  return {
    login,
    url: `https://github.com/${login}`,
  }
}

export function normalisePublicLinks(input: {
  website?: unknown
  github?: unknown
}): NormalisedPublicLinks {
  return {
    website: normaliseWebsite(input.website),
    github: normaliseGithub(input.github),
  }
}

function sourceBase(
  kind: PublicWorkSource['kind'],
  url: string,
): PublicWorkSource {
  return {
    kind,
    url,
    label: null,
    headline: null,
    summary: null,
    skills: [],
    projects: [],
    readAt: new Date().toISOString(),
    error: null,
  }
}

function projectUrl(value: unknown, sourceUrl: string) {
  const raw = text(value, 500)
  if (!raw) return null
  try {
    const url = new URL(raw, sourceUrl)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url.toString()
  } catch {
    return null
  }
}

function websiteProjects(value: unknown, sourceUrl: string): PublicWorkProject[] {
  if (!Array.isArray(value)) return []
  const projects: PublicWorkProject[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const name = text(record.name, 120)
    if (!name) continue
    projects.push({
      name,
      description: text(record.description, 400),
      url: projectUrl(record.url, sourceUrl),
      skills: textList(record.skills, 6),
    })
    if (projects.length >= MAX_PROJECTS) break
  }
  return projects
}

async function readWebsite(
  url: string,
  browserbaseKey: string | null,
): Promise<PublicWorkSource> {
  const source = sourceBase('website', url)
  if (!browserbaseKey) {
    source.error = 'Website reading needs BROWSERBASE_API_KEY.'
    return source
  }

  try {
    const data = await fetchJson({ browserbaseKey }, url, WEBSITE_PROFILE_SCHEMA)
    if (!data) {
      source.error = 'That page did not return readable profile content.'
      return source
    }

    source.label =
      text(data.title, 120) || new URL(url).hostname.replace(/^www\./, '')
    source.headline = text(data.headline, 200)
    source.summary = text(data.summary, MAX_TEXT)
    source.skills = textList(data.skills, MAX_SKILLS)
    source.projects = websiteProjects(data.projects, url)

    if (
      !source.headline &&
      !source.summary &&
      source.skills.length === 0 &&
      source.projects.length === 0
    ) {
      source.error = 'That page did not contain public profile details Caddie could use.'
    }
  } catch (error) {
    source.error =
      error instanceof Error ? error.message : 'That website could not be read.'
  }

  return source
}

type GithubUser = {
  login?: unknown
  name?: unknown
  bio?: unknown
  html_url?: unknown
  public_repos?: unknown
}

type GithubRepo = {
  name?: unknown
  description?: unknown
  html_url?: unknown
  fork?: unknown
  archived?: unknown
  language?: unknown
  topics?: unknown
  stargazers_count?: unknown
}

function githubHeaders(token: string | null) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Caddie/1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function githubJson<T>(
  path: string,
  token: string | null,
): Promise<{ data: T | null; error: string | null }> {
  let response: Response
  try {
    response = await fetch(`https://api.github.com${path}`, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    return { data: null, error: 'GitHub could not be reached. Try again.' }
  }

  if (response.status === 404) {
    return { data: null, error: 'That GitHub profile was not found.' }
  }
  if (response.status === 403 || response.status === 429) {
    return {
      data: null,
      error:
        response.headers.get('x-ratelimit-remaining') === '0'
          ? 'GitHub rate limit reached. Try again later.'
          : 'GitHub refused that request.',
    }
  }
  if (!response.ok) {
    return { data: null, error: `GitHub returned ${response.status}.` }
  }

  return {
    data: (await response.json().catch(() => null)) as T | null,
    error: null,
  }
}

async function readGithub(
  login: string,
  url: string,
  token: string | null,
): Promise<PublicWorkSource> {
  const source = sourceBase('github', url)
  const [userResult, reposResult] = await Promise.all([
    githubJson<GithubUser>(`/users/${encodeURIComponent(login)}`, token),
    githubJson<GithubRepo[]>(
      `/users/${encodeURIComponent(login)}/repos?type=owner&sort=updated&per_page=12`,
      token,
    ),
  ])

  if (!userResult.data) {
    source.error = userResult.error ?? 'That GitHub profile could not be read.'
    return source
  }

  const user = userResult.data
  source.label = text(user.name, 120) ?? text(user.login, 80) ?? `@${login}`
  source.headline = text(user.name, 200)
  source.summary = text(user.bio, MAX_TEXT)
  source.url = text(user.html_url, 500) ?? url

  if (Array.isArray(reposResult.data)) {
    const skills = new Set<string>()
    for (const repo of reposResult.data) {
      if (
        !repo ||
        repo.fork === true ||
        repo.archived === true ||
        typeof repo.name !== 'string'
      ) {
        continue
      }
      const language = text(repo.language, 40)
      const topics = textList(repo.topics, 4)
      for (const skill of [...(language ? [language] : []), ...topics]) {
        if (skills.size >= MAX_SKILLS) break
        skills.add(skill)
      }
      source.projects.push({
        name: text(repo.name, 80) ?? repo.name.slice(0, 80),
        description: text(repo.description, 400),
        url: text(repo.html_url, 500),
        skills: textList(
          [...(language ? [language] : []), ...topics],
          6,
        ),
      })
      if (source.projects.length >= MAX_PROJECTS) break
    }
    source.skills = [...skills]
  }

  if (reposResult.error && source.projects.length === 0) {
    source.error = reposResult.error
  }

  return source
}

export async function readPublicWork(
  links: NormalisedPublicLinks,
  options: { browserbaseKey: string | null; githubToken: string | null },
): Promise<PublicWork> {
  const [website, github] = await Promise.all([
    links.website
      ? readWebsite(links.website, options.browserbaseKey)
      : Promise.resolve(null),
    links.github
      ? readGithub(links.github.login, links.github.url, options.githubToken)
      : Promise.resolve(null),
  ])

  return {
    website,
    github,
    updatedAt: new Date().toISOString(),
  }
}
