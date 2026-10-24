import type { ChatMessage } from './cloudflare'
import type { ComposeEvidence } from './compose-evidence'
import type { JdClassification } from '../shared/jd-classification'
import { PROMPT_SAFETY, untrusted } from './prompt-safety'

export type ComposeAngle =
  | 'direct-match'
  | 'problem-solution'
  | 'craft'
  | 'transferable'
  | 'company'

export const STRATEGY_SYSTEM_PROMPT = `You are planning a cover letter before anyone writes it. Return one JSON object and nothing else.

${PROMPT_SAFETY}

Your job is to decide what the letter is selling and how it should open. Do not write the letter yet.

Choose one angle:
- direct-match: the selected evidence is a project, product or role that directly mirrors the company's product or core problem.
- problem-solution: the candidate solved the same kind of problem in a different context.
- craft: the role's central need is a craft or technical depth, and the evidence proves that depth.
- transferable: there is no genuine core match; lead with the strongest transferable pattern and a credible reason for this role. Do not pretend it is a direct match.
- company: use only when the posting gives one specific company detail worth building around; never use generic praise.

Rules
- Select one hero evidence ID and at most one supporting evidence ID from the list. The hero is the fact that makes the strongest case for this role. The support must prove a different core need, not repeat the hero.
- Direct-match and company angles require real evidence or a specific company fact. If neither exists, use transferable.
- companyInsight must be grounded in the job summary, responsibilities or requirements. Do not invent news, funding, product details or culture.
- The hook is one or two sentences, 25–60 words. It must lead with the hero evidence: a concrete project, problem or result, not a general statement about the company or industry. It can name the company or role after the concrete fact. Never start with "I am writing", "I am excited" or "I am passionate".
- thesis is one sentence: what are we selling about this candidate for this role?
- avoid lists CV facts that should not appear in this letter; keep the letter from becoming a CV summary.
- Do not select every metric or tool. The writer may use at most two metrics.

Return exactly:
{
  "angle": "direct-match | problem-solution | craft | transferable | company",
  "thesis": "...",
  "hook": "...",
  "companyInsight": "...",
  "heroId": "cv:1",
  "supportId": "cv:2",
  "reason": "one line explaining the choice",
  "avoid": ["..."]
}`

function jobBlock(jd: JdClassification) {
  const requirements = jd.requirements
    .slice(0, 24)
    .map(
      (item) =>
        `- ${item.importance === 'must' ? 'Must' : 'Nice'}: ${item.label}${
          item.match.length ? ` (${item.match.slice(0, 4).join(', ')})` : ''
        }`,
    )
    .join('\n')
  const responsibilities = jd.responsibilities
    .slice(0, 8)
    .map((item) => `- ${item}`)
    .join('\n')

  return `Role: ${jd.role.title || 'Unknown role'}
Company: ${jd.company.name || 'Unknown company'}
Summary: ${jd.summary}
Work: ${[jd.work.mode, jd.work.location, jd.work.employment].filter(Boolean).join(' · ') || 'not stated'}

Requirements:
${requirements || '(none)'}

Responsibilities:
${responsibilities || '(none)'}`
}

function evidenceBlock(evidence: ComposeEvidence[]) {
  return evidence
    .map(
      (item) =>
        `- ${item.id} [${item.source}: ${item.label}] ${item.text}`,
    )
    .join('\n')
}

export function strategyMessages(input: {
  kind: 'cover-letter' | 'email'
  jd: JdClassification
  evidence: ComposeEvidence[]
}): ChatMessage[] {
  return [
    { role: 'system', content: STRATEGY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${untrusted('job', jobBlock(input.jd), 4_000)}

${untrusted('evidence_candidates', evidenceBlock(input.evidence), 10_000)}

Plan a ${input.kind === 'cover-letter' ? 'cover letter' : 'short application email'}. Return only the JSON object.`,
    },
  ]
}
