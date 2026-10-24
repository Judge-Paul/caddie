import type { CvMap, CvMapTarget } from './cv-map'
import type { Requirement } from './jd-classification'

export type CvTargetAudit = {
  target: CvMapTarget
  protected: boolean
  related: boolean
  safe: boolean
  generic: boolean
  coveredMust: string[]
  coveredNice: string[]
  reasons: string[]
}

export type CvAudit = {
  targets: CvTargetAudit[]
  protectedBlockIds: string[]
  swapTargets: CvTargetAudit[]
}

function phraseIn(text: string, term: string) {
  return text.toLowerCase().includes(term.toLowerCase())
}

function coveredLabels(target: CvMapTarget, requirement: Requirement) {
  const terms = requirement.match.length > 0 ? requirement.match : requirement.items
  return terms.some((term) => phraseIn(target.text, term))
}

function genericText(text: string) {
  return /\b(helped|assisted|collaborated|responsible for|worked with|involved in)\b/i.test(text)
}

export function auditCv(
  map: CvMap,
  requirements: Requirement[],
): CvAudit {
  const targets: CvMapTarget[] = []

  for (const role of map.roles) {
    targets.push(...role.bullets)
    for (const project of role.projects) {
      if (project.descriptionTarget) targets.push(project.descriptionTarget)
      targets.push(...project.bullets)
    }
  }

  for (const project of map.orphanProjects) {
    if (project.descriptionTarget) targets.push(project.descriptionTarget)
    targets.push(...project.bullets)
  }

  const audited = targets.map((target) => {
    const coveredMust: string[] = []
    const coveredNice: string[] = []
    const reasons: string[] = []

    for (const requirement of requirements) {
      if (!coveredLabels(target, requirement)) continue
      if (requirement.importance === 'must') coveredMust.push(requirement.label)
      else coveredNice.push(requirement.label)
    }

    const generic = genericText(target.text)
    const protectedTarget = coveredMust.length > 0
    const related = !protectedTarget && coveredNice.length > 0
    const safe = !protectedTarget && !related && !generic

    if (protectedTarget) {
      reasons.push(`Covers ${coveredMust.slice(0, 2).join(', ')}`)
    }
    if (related) {
      reasons.push(`Worth showing for ${coveredNice.slice(0, 2).join(', ')}`)
    }
    if (generic) reasons.push('Generic phrasing')
    if (safe) reasons.push('Not tied to this posting')

    return {
      target,
      protected: protectedTarget,
      related,
      safe,
      generic,
      coveredMust,
      coveredNice,
      reasons,
    }
  })

  return {
    targets: audited,
    protectedBlockIds: audited
      .filter((entry) => entry.protected && entry.target.blockId)
      .map((entry) => entry.target.blockId as string),
    swapTargets: audited
      .filter(
        (entry) =>
          !entry.protected &&
          entry.target.blockId &&
          entry.target.wholeBlock,
      )
      .sort((left, right) => {
        const rank = (entry: CvTargetAudit) =>
          entry.safe ? 0 : entry.generic ? 1 : 2
        if (rank(left) !== rank(right)) return rank(left) - rank(right)
        return left.target.text.length - right.target.text.length
      }),
  }
}
