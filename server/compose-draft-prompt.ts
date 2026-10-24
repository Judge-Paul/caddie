import type { ChatMessage } from './cloudflare'
import type { ComposeEvidence } from './compose-evidence'
import type { ComposeAngle } from './compose-strategy-prompt'
import type { JdClassification } from '../shared/jd-classification'
import { PROMPT_SAFETY, untrusted } from './prompt-safety'

export type ComposeStrategy = {
  angle: ComposeAngle
  thesis: string
  hook: string
  companyInsight: string
  heroId: string
  supportId: string | null
  reason: string
  avoid: string[]
}

export const DRAFT_SYSTEM_PROMPT = `You write one application message from a strategy and selected evidence. Return one JSON object and nothing else.

${PROMPT_SAFETY}

Rules
- Use ONLY the selected evidence and job facts. Never invent an employer, tool, metric, date or outcome. Every clause must be literally supported by the selected evidence or job facts.
- Do not add causes, adoption, stability, error reduction, user counts or growth that the evidence does not state. Do not turn "downloads" into "users". If evidence says releases were managed, do not infer that errors fell.
- Do not summarize the CV. Do not list every role, metric or tool. The letter is not a CV in prose.
- Expand the hero evidence into specific sentences: the context, the action and the outcome. Do not compress it into "my experience". The supporting evidence, if present, proves a different need in its own short passage. At most two metrics and two technologies in the whole message.
- Follow the strategy's angle and hook idea. Use the strategy hook as the opening paragraph; keep its concrete facts and do not replace it with a general statement. Mention the exact role title once, naturally. The first sentence must lead with the hero evidence: a concrete project, problem or outcome. Do not open with the company's focus, an industry observation, or a general claim about your experience. The first paragraph can name the role and company after the hook.
- Include one specific, grounded sentence about the company or role. Do not use generic praise.
- If the strategy is transferable, be honest and concrete about the transferable pattern; do not invent a direct connection.
- Do not start with "I am writing", "I am excited" or "I am passionate". Avoid "I am particularly interested", "aligns perfectly", "I am confident" and "I believe I would be a great fit".
- No markdown, no bullet list, no headings. Avoid "During my time at", "I am well-versed", "I am proficient" and "my background allows me to".

Cover letter: 3–4 paragraphs, 180–280 words. Do not finish below 170 words; add concrete detail from the selected evidence, never generic filler. Open with the hook, then the hero proof, then the company/role connection, then a short close. Include a greeting and sign-off using the candidate's name when provided.
Email: 90–140 words, 2–3 short paragraphs, subject under 80 characters. Do not claim the CV is attached; the sender controls that.

Return exactly:
{"coverLetter":"..."}
or
{"subject":"...","body":"..."}`

function jobBlock(jd: JdClassification) {
  return `Role: ${jd.role.title || 'Unknown role'}
Company: ${jd.company.name || 'Unknown company'}
Summary: ${jd.summary}
Work: ${[jd.work.mode, jd.work.location, jd.work.employment].filter(Boolean).join(' · ') || 'not stated'}`
}

function strategyBlock(strategy: ComposeStrategy) {
  return `Angle: ${strategy.angle}
Thesis: ${strategy.thesis}
Hook: ${strategy.hook}
Company insight: ${strategy.companyInsight}
Reason: ${strategy.reason}
Avoid: ${strategy.avoid.join(' · ') || '(none)'}`
}

function evidenceBlock(
  evidence: ComposeEvidence[],
  strategy: ComposeStrategy,
) {
  const chosen = evidence.filter(
    (item) => item.id === strategy.heroId || item.id === strategy.supportId,
  )
  return chosen
    .map(
      (item) =>
        `- ${item.id} [${item.source}: ${item.label}] ${item.text}`,
    )
    .join('\n')
}

export function draftMessages(input: {
  kind: 'cover-letter' | 'email'
  jd: JdClassification
  strategy: ComposeStrategy
  evidence: ComposeEvidence[]
  candidateName: string | null
}): ChatMessage[] {
  return [
    { role: 'system', content: DRAFT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${untrusted('job', jobBlock(input.jd), 2_000)}

${untrusted('strategy', strategyBlock(input.strategy), 2_000)}

${untrusted('selected_evidence', evidenceBlock(input.evidence, input.strategy), 4_000)}

Candidate name: ${input.candidateName || 'not provided'}

Write the ${input.kind === 'cover-letter' ? 'cover letter' : 'email'} now. Return only the JSON object.`,
    },
  ]
}
