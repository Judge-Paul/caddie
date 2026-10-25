/**
 * One project the candidate worked on, no matter where it was described.
 *
 * A CV project, a piece of work done at a job, a GitHub repo and a website
 * case study can all be the same underlying project. This module merges those
 * sources into a single identity so prompts and evidence treat them as one
 * thing worked on. Narration (the candidate's stored stories) attaches to the
 * project as context instead of appearing as another separate project.
 */

import type { PublicWork } from './account'
import type { CvProject, CvProjectKind } from './cv-classification'
import type { CvStory } from './cv-fit'

export type ProjectSource = 'cv' | 'github' | 'website' | 'story'

export type UnifiedProject = {
  /** Stable dedupe key: url, name+company, name, or story id. */
  key: string
  name: string | null
  company: string | null
  roleTitle: string | null
  url: string | null
  dates: string | null
  kind: CvProjectKind
  tech: string[]
  description: string | null
  bullets: string[]
  /** The candidate's own narration about this project. Context, not a project. */
  narration: string[]
  sources: ProjectSource[]
  cvProjectId: string | null
  cvRoleId: string | null
}

export function normalizeProjectName(value: string | null): string {
  if (!value) return ''
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeCompany(value: string | null): string {
  if (!value) return ''
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function normalizeProjectUrl(value: string | null): string {
  if (!value) return ''
  const raw = value.trim().toLowerCase()
  if (!raw) return ''
  const withoutScheme = raw.replace(/^https?:\/\//, '').replace(/^www\./, '')
  return withoutScheme.replace(/\/+$/, '')
}

function sameCompany(left: string | null, right: string | null): boolean {
  const a = normalizeCompany(left)
  const b = normalizeCompany(right)
  if (!a || !b) return true
  return a === b || a.includes(b) || b.includes(a)
}

function mergeTech(into: string[], extra: string[], max = 12) {
  const seen = new Set(into.map((entry) => entry.toLowerCase()))
  for (const entry of extra) {
    const clean = entry.trim()
    if (!clean || seen.has(clean.toLowerCase())) continue
    seen.add(clean.toLowerCase())
    into.push(clean)
    if (into.length >= max) break
  }
}

function mergeSources(into: ProjectSource[], extra: ProjectSource) {
  if (!into.includes(extra)) into.push(extra)
}

function keyFor(parts: { url: string; name: string; company: string }, fallback: string) {
  if (parts.url) return `url:${parts.url}`
  if (parts.name && parts.company) return `name:${parts.name}@${parts.company}`
  if (parts.name) return `name:${parts.name}`
  return fallback
}

/**
 * The CV project a story narrates, by explicit link first and by
 * title/company match second. Null means the story is unattributed.
 */
export function storyProjectFor(
  story: CvStory,
  cvProjects: Pick<CvProject, 'id' | 'name' | 'company'>[],
): Pick<CvProject, 'id' | 'name' | 'company'> | null {
  if (story.projectId) {
    const direct = cvProjects.find((project) => project.id === story.projectId)
    if (direct) return direct
  }
  const title = normalizeProjectName(story.title)
  if (!title) return null
  return (
    cvProjects.find(
      (project) =>
        normalizeProjectName(project.name) === title &&
        sameCompany(project.company, story.company),
    ) ?? null
  )
}

/** Human label for a story's project link, for prompt annotations. */
export function storyProjectName(
  story: CvStory,
  cvProjects: Pick<CvProject, 'id' | 'name' | 'company'>[],
): string | null {
  return storyProjectFor(story, cvProjects)?.name ?? null
}

export function unifyProjects(input: {
  cv?: CvProject[]
  publicWork?: PublicWork | null
  stories?: CvStory[]
}): UnifiedProject[] {
  const cvProjects = input.cv ?? []
  const stories = input.stories ?? []
  const unified: UnifiedProject[] = []

  for (const project of cvProjects) {
    unified.push({
      key: keyFor(
        {
          url: normalizeProjectUrl(project.url),
          name: normalizeProjectName(project.name),
          company: normalizeCompany(project.company),
        },
        `cv:${project.id}`,
      ),
      name: project.name,
      company: project.company,
      roleTitle: null,
      url: project.url,
      dates: project.dates,
      kind: project.kind,
      tech: [...project.tech],
      description: project.description,
      bullets: project.bullets.map((bullet) => bullet.text),
      narration: [],
      sources: ['cv'],
      cvProjectId: project.id,
      cvRoleId: project.roleId,
    })
  }

  const findByUrl = (url: string) =>
    url ? unified.find((entry) => normalizeProjectUrl(entry.url) === url) : undefined

  const findByName = (name: string, company: string | null) =>
    name
      ? unified.find(
          (entry) =>
            normalizeProjectName(entry.name) === name &&
            sameCompany(entry.company, company),
        )
      : undefined

  if (input.publicWork) {
    const feeds: { kind: 'github' | 'website'; projects: { name: string; description: string | null; url: string | null; skills: string[] }[] }[] = [
      { kind: 'github', projects: input.publicWork.github?.projects ?? [] },
      { kind: 'website', projects: input.publicWork.website?.projects ?? [] },
    ]
    for (const feed of feeds) {
      for (const item of feed.projects) {
        const url = normalizeProjectUrl(item.url)
        const name = normalizeProjectName(item.name)
        const match = findByUrl(url) ?? findByName(name, null)
        if (match) {
          mergeSources(match.sources, feed.kind)
          if (!match.url && item.url) match.url = item.url
          if (!match.description && item.description) match.description = item.description
          mergeTech(match.tech, item.skills)
          continue
        }
        unified.push({
          key: keyFor({ url, name, company: '' }, `ext:${feed.kind}:${name || url}`),
          name: item.name || null,
          company: null,
          roleTitle: null,
          url: item.url,
          dates: null,
          kind: 'unknown',
          tech: [...item.skills].slice(0, 12),
          description: item.description,
          bullets: [],
          narration: [],
          sources: [feed.kind],
          cvProjectId: null,
          cvRoleId: null,
        })
      }
    }
  }

  for (const story of stories) {
    const narration = [
      story.userText,
      story.bullet && story.bullet !== story.userText
        ? `Approved CV bullet: ${story.bullet}`
        : null,
    ]
      .filter(Boolean)
      .join('\n') as string

    const cvMatch = storyProjectFor(story, cvProjects)
    if (cvMatch) {
      const entry = unified.find((item) => item.cvProjectId === cvMatch.id)
      if (entry) {
        if (!entry.narration.includes(narration)) entry.narration.push(narration)
        mergeSources(entry.sources, 'story')
        mergeTech(entry.tech, story.skills)
        if (!entry.company && story.company) entry.company = story.company
        if (
          !entry.roleTitle &&
          story.title &&
          normalizeProjectName(story.title) !== normalizeProjectName(entry.name)
        ) {
          entry.roleTitle = story.title
        }
        continue
      }
    }

    const name = normalizeProjectName(story.title)
    const extMatch = findByName(name, story.company)
    if (extMatch) {
      if (!extMatch.narration.includes(narration)) extMatch.narration.push(narration)
      mergeSources(extMatch.sources, 'story')
      mergeTech(extMatch.tech, story.skills)
      if (!extMatch.company && story.company) extMatch.company = story.company
      continue
    }

    unified.push({
      key: story.projectId
        ? `cvlink:${story.projectId}:${story.id}`
        : `story:${story.id}`,
      name: story.title,
      company: story.company,
      roleTitle: null,
      url: null,
      dates: null,
      kind: story.company ? 'work' : 'unknown',
      tech: [...story.skills].slice(0, 12),
      description: null,
      bullets: story.bullet ? [story.bullet] : [],
      narration: [narration],
      sources: ['story'],
      cvProjectId: story.projectId ?? null,
      cvRoleId: story.roleId,
    })
  }

  return unified
}
