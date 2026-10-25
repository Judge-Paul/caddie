import type { PublicWork } from '../shared/account'
import type { CvStory } from '../shared/cv-fit'
import type { JdClassification } from '../shared/jd-classification'
import { unifyProjects, type UnifiedProject } from '../shared/projects'

export type ComposeEvidence = {
  id: string
  source: 'cv' | 'story' | 'profile'
  text: string
  label: string
}

function clean(value: string) {
  return value
    .replace(/^[\s•▪◦‣·*-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeNoise(line: string) {
  const words = line.split(/\s+/).filter(Boolean)
  if (words.length < 5) return true
  if (line.length < 40 || line.length > 360) return true
  if (/@|https?:\/\/|www\.|linkedin\.com|github\.com|\+?\d[\d\s().-]{7,}\d/i.test(line)) {
    return true
  }
  const letters = line.replace(/[^A-Za-z]/g, '')
  if (letters.length > 4 && letters === letters.toUpperCase()) return true
  return false
}

function scoreLine(line: string, terms: Set<string>) {
  const lower = line.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (term.length < 3) continue
    if (lower.includes(term)) score += 3
  }
  if (/\d|%|percent|\busers?\b|\bcustomers?\b|\bteams?\b/.test(lower)) score += 2
  if (/\b(project|app|platform|product|built|shipped|launched|redesigned)\b/.test(lower)) {
    score += 1
  }
  return score
}

function jdTerms(jd: JdClassification) {
  const terms = new Set<string>()
  for (const requirement of jd.requirements) {
    terms.add(requirement.label.toLowerCase())
    for (const term of [...requirement.match, ...requirement.items]) {
      terms.add(term.toLowerCase())
    }
  }
  for (const signal of jd.signals) {
    terms.add(signal.label.toLowerCase())
    for (const term of signal.terms) terms.add(term.toLowerCase())
  }
  for (const keyword of jd.keywords) terms.add(keyword.toLowerCase())
  for (const responsibility of jd.responsibilities) {
    for (const word of responsibility.toLowerCase().split(/\s+/)) {
      if (word.length >= 4) terms.add(word)
    }
  }
  return terms
}

/**
 * One evidence entry per project worked on. A GitHub project, a website case
 * study and a stored story about the same work merge into a single entry,
 * with the story kept as context rather than a second project.
 */
function unifiedProjectEvidence(
  unified: UnifiedProject[],
  terms: Set<string>,
) {
  return unified
    .map((project, index) => {
      const head = clean(
        [
          project.name ? `${project.name}:` : '',
          project.description ?? '',
          project.tech.length ? `(${project.tech.join(', ')})` : '',
        ]
          .filter(Boolean)
          .join(' '),
      )
      const context = project.narration.length
        ? clean(project.narration[0]).slice(0, 240)
        : ''
      const text = clean(
        [head, context ? `Context: ${context}` : ''].filter(Boolean).join(' '),
      )
      const label = project.name
        ? `Project: ${project.name}`
        : project.company
          ? `Work at ${project.company}`
          : 'Experience'
      const source: ComposeEvidence['source'] =
        project.sources.includes('github') || project.sources.includes('website')
          ? 'profile'
          : 'story'
      return { text, label, source, index, score: scoreLine(text, terms) }
    })
    .filter((candidate) => candidate.text.length >= 20)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 8)
}

function publicWorkProfileEvidence(publicWork: PublicWork | null) {
  if (!publicWork) return []
  const candidates: { text: string; label: string }[] = []

  for (const source of [publicWork.website, publicWork.github]) {
    if (!source || source.error || source.projects.length > 0) continue
    const sourceName = source.kind === 'github' ? 'GitHub' : 'Website'
    const text = clean([source.headline, source.summary].filter(Boolean).join(' '))
    if (text.length >= 30) {
      candidates.push({ text, label: `${sourceName} profile` })
    }
  }

  return candidates
}

export function buildComposeEvidence(
  cvText: string,
  stories: CvStory[],
  jd: JdClassification,
  publicWork: PublicWork | null = null,
): ComposeEvidence[] {
  const terms = jdTerms(jd)
  const candidates = cvText
    .split(/\r?\n/)
    .map(clean)
    .filter((line) => line && !looksLikeNoise(line))
    .map((text, index) => ({
      text,
      index,
      score: scoreLine(text, terms),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 20)

  const seen = new Set<string>()
  const evidence: ComposeEvidence[] = []

  for (const candidate of candidates) {
    const key = candidate.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    evidence.push({
      id: `cv:${evidence.length + 1}`,
      source: 'cv',
      text: candidate.text,
      label: 'CV evidence',
    })
  }

  const unified = unifyProjects({ publicWork, stories: stories.slice(0, 10) })
  for (const [index, candidate] of unifiedProjectEvidence(unified, terms).entries()) {
    const key = candidate.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    evidence.push({
      id: `project:${index + 1}`,
      source: candidate.source,
      text: candidate.text,
      label: candidate.label,
    })
  }

  for (const candidate of publicWorkProfileEvidence(publicWork)) {
    const key = candidate.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    evidence.push({
      id: `profile:${evidence.length + 1}`,
      source: 'profile',
      text: candidate.text,
      label: candidate.label,
    })
  }

  return evidence.slice(0, 28)
}
