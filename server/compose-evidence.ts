import type { PublicWork } from '../shared/account'
import type { CvStory } from '../shared/cv-fit'
import type { JdClassification } from '../shared/jd-classification'

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

function publicWorkEvidence(publicWork: PublicWork | null, terms: Set<string>) {
  if (!publicWork) return []
  const candidates: { text: string; label: string }[] = []

  for (const source of [publicWork.website, publicWork.github]) {
    if (!source || source.error) continue
    const sourceName = source.kind === 'github' ? 'GitHub' : 'Website'
    if (source.projects.length === 0) {
      const text = clean([source.headline, source.summary].filter(Boolean).join(' '))
      if (text.length >= 30) {
        candidates.push({ text, label: `${sourceName} profile` })
      }
      continue
    }
    for (const project of source.projects) {
      const text = clean(
        [
          `${project.name}:`,
          project.description,
          project.skills.length ? `(${project.skills.join(', ')})` : '',
        ]
          .filter(Boolean)
          .join(' '),
      )
      if (text.length < 20) continue
      candidates.push({ text, label: `${sourceName} project` })
    }
  }

  return candidates
    .map((candidate, index) => ({
      ...candidate,
      index,
      score: scoreLine(candidate.text, terms),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 4)
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

  for (const [index, candidate] of publicWorkEvidence(publicWork, terms).entries()) {
    const key = candidate.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    evidence.push({
      id: `profile:${index + 1}`,
      source: 'profile',
      text: candidate.text,
      label: candidate.label,
    })
  }

  for (const story of stories.slice(0, 8)) {
    const text = clean(story.bullet || story.userText)
    if (!text || text.length < 30) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    evidence.push({
      id: `story:${story.id}`,
      source: 'story',
      text,
      label: [story.title, story.company].filter(Boolean).join(' at ') || 'Experience',
    })
  }

  return evidence.slice(0, 28)
}
