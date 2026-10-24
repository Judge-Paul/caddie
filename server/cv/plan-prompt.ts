import type { ChatMessage } from '../cloudflare'
import type { CvStory, FitGap, FitMessage } from '../../shared/cv-fit'
import type { CvMap, CvMapTarget } from '../../shared/cv-map'
import type { CvTargetAudit } from '../../shared/cv-audit'
import type { CompanyProfile, JdClassification } from '../../shared/jd-classification'
import { PROMPT_SAFETY, untrusted } from '../prompt-safety'

export const PLAN_SYSTEM_PROMPT = `You plan CV edits from the candidate's own facts. Return one JSON object and nothing else.

${PROMPT_SAFETY}

Rules
- Use ONLY facts the candidate stated in this conversation or in their stored stories. Never invent employers, tools, metrics, dates or outcomes.
- The candidate may describe several facts and several gaps in one message. You may return one to three edits.
- Place evidence in the most specific existing role or project. A project belongs to its role; do not move a fact to a different employer.
- The CV map is the source of structure. If the candidate names a company, project or product that is not in the CV map or stored stories, or its parent is ambiguous, ask one short question instead of guessing.
- If the named project is already in the CV map, use its project targets.
- You may only choose target block IDs from the candidate list. Those are the whole-block, editable, non-protected targets.
- Do not choose a target that is not in the list. Do not create, delete or insert paragraphs in this pass.
- Rewrite the chosen target into one past-tense bullet, no first person, no "I", no bullet glyph. Keep it between the target's min and max characters; do not pad with vague filler. The rendered bullet must fill the same space as the original.
- Mention a gap term only when the candidate's fact supports it. Do not echo unsupported requirements.
- The final CV must keep the same line count and page count. Prefer fewer, shorter edits when in doubt.
- Avoid duplicating an existing bullet.

Return a plan:
{
  "type": "plan",
  "edits": [
    { "blockId": "p:6", "text": "...", "gapLabels": ["..."], "rationale": "..." }
  ],
  "note": "one short line"
}

If a fact or entity is unresolved:
{ "type": "question", "question": "..." }

If no existing target can hold the evidence without changing the layout:
{ "type": "no-fit", "reason": "..." }`

function roleLabel(target: CvMapTarget, map: CvMap) {
  for (const role of map.roles) {
    if (role.id === target.roleId) {
      const project = role.projects.find((entry) => entry.id === target.projectId)
      if (project) return `${[role.company, role.title].filter(Boolean).join(' / ')} / ${project.name ?? 'Project'}`
      return [role.company, role.title].filter(Boolean).join(' / ') || 'Role'
    }
  }

  const project = map.orphanProjects.find((entry) => entry.id === target.projectId)
  return project?.name ?? 'Project'
}

function mapLines(map: CvMap) {
  const lines: string[] = []

  for (const role of map.roles.slice(0, 8)) {
    lines.push(
      `ROLE ${role.id}: ${[role.company, role.title].filter(Boolean).join(' / ') || 'Untitled role'} (${role.dates ?? 'dates unknown'})`,
    )
    for (const bullet of role.bullets.slice(0, 16)) {
      if (bullet.blockId) lines.push(`  ${bullet.blockId}: ${bullet.text.slice(0, 180)}`)
    }
    for (const project of role.projects.slice(0, 10)) {
      lines.push(
        `  PROJECT ${project.id}: ${project.name ?? 'Untitled project'} [${project.kind}]${project.product ? ` — ${project.product.slice(0, 120)}` : ''}`,
      )
      if (project.descriptionTarget?.blockId) {
        lines.push(`    ${project.descriptionTarget.blockId}: ${project.descriptionTarget.text.slice(0, 180)}`)
      }
      for (const bullet of project.bullets.slice(0, 8)) {
        if (bullet.blockId) lines.push(`    ${bullet.blockId}: ${bullet.text.slice(0, 180)}`)
      }
    }
  }

  for (const project of map.orphanProjects.slice(0, 8)) {
    lines.push(
      `PROJECT ${project.id}: ${project.name ?? 'Untitled project'} [${project.kind}]${project.product ? ` — ${project.product.slice(0, 120)}` : ''}`,
    )
    if (project.descriptionTarget?.blockId) {
      lines.push(`  ${project.descriptionTarget.blockId}: ${project.descriptionTarget.text.slice(0, 180)}`)
    }
    for (const bullet of project.bullets.slice(0, 8)) {
      if (bullet.blockId) lines.push(`  ${bullet.blockId}: ${bullet.text.slice(0, 180)}`)
    }
  }

  return lines.join('\n') || '(no roles or projects were read)'
}

function gapLines(gaps: FitGap[]) {
  return gaps
    .slice(0, 12)
    .map(
      (gap) =>
        `- ${gap.label} [${gap.kind}]${gap.terms.length ? ` (${gap.terms.slice(0, 5).join(', ')})` : ''}`,
    )
    .join('\n')
}

function storyLines(stories: CvStory[]) {
  return stories
    .slice(0, 6)
    .map((story) => {
      const where = [story.title, story.company].filter(Boolean).join(' at ')
      return `- ${where || 'Experience'}: ${story.userText.slice(0, 500)}`
    })
    .join('\n')
}

function historyLines(history: FitMessage[]) {
  return history
    .slice(-6)
    .map((entry) => `${entry.role}: ${entry.content.slice(0, 500)}`)
    .join('\n')
}

function candidateLines(candidates: CvTargetAudit[], map: CvMap) {
  return candidates
    .slice(0, 10)
    .map((entry) => {
      const flags = [
        entry.target.kind,
        entry.safe ? 'safe' : '',
        entry.generic ? 'generic' : '',
        entry.related ? 'related' : '',
      ]
        .filter(Boolean)
        .join(', ')
      return `- ${entry.target.blockId} | ${flags} | ${roleLabel(entry.target, map)} | min ${Math.floor(entry.target.text.length * 0.9)} / max ${Math.min(240, entry.target.text.length)} chars | ${entry.target.text.slice(0, 180)}`
    })
    .join('\n')
}

export function planMessages(input: {
  map: CvMap
  jd: JdClassification
  company: CompanyProfile | null
  gaps: FitGap[]
  message: string
  history: FitMessage[]
  stories: CvStory[]
  candidates: CvTargetAudit[]
}): ChatMessage[] {
  const jd = input.jd
  return [
    { role: 'system', content: PLAN_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${untrusted('job', `Role: ${jd.role.title || 'Unknown role'}
Company: ${jd.company.name || 'Unknown company'}
Summary: ${jd.summary}
Company research: ${input.company?.summary || 'none'}`, 3_000)}

${untrusted('missing_skills', gapLines(input.gaps) || '(none listed)', 3_000)}

${untrusted('cv_map', mapLines(input.map), 8_000)}

${untrusted('targets', candidateLines(input.candidates, input.map) || '(none)', 5_000)}

${untrusted('stored_experience', storyLines(input.stories) || '(none)', 4_000)}

${untrusted('conversation', historyLines(input.history) || '(none)', 3_000)}

${untrusted('candidate_message', input.message, 3_000)}

Return the JSON object only.`,
    },
  ]
}
