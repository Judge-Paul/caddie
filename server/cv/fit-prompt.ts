import type { ChatMessage } from '../cloudflare'
import type { CvRole } from '../../shared/cv-classification'
import type { CvStory, FitGap, FitMessage } from '../../shared/cv-fit'
import type { CompanyProfile } from '../../shared/jd-classification'

/**
 * The assistant writes one bullet from the candidate's own facts. It is allowed
 * to condense and rephrase, never to add a tool, metric, employer or outcome.
 */
export const FIT_SYSTEM_PROMPT = `You write one CV bullet from the candidate's own facts. Return one JSON object and nothing else.

Rules
- Use ONLY facts the candidate stated in this conversation or in their stored stories. Never invent metrics, tools, employers, dates or outcomes.
- If the facts are not enough to write a truthful bullet about the requested gap, ask one short, specific question instead of guessing.
- The bullet must mention the gap term(s) only when the candidate's fact supports them.
- Do not repeat the company name; the role already names it.
- Write one sentence in past tense, no first person, no "I", no bullet glyph.
- Keep the first bullet within maxChars. If you can, also provide a shorter second bullet using the same facts, so it can fit a tighter line.
- Do not move a fact from one employer to another. Stored stories are labelled with their role.
- Avoid duplicating an existing bullet in this role.

Return this shape:
{
  "bullets": [
    { "text": "...", "rationale": "one line explaining what it covers", "factsUsed": ["..."] }
  ],
  "question": null
}

If you need a fact first:
{ "bullets": [], "question": "What did you build or scale with AI agents at that role?" }`

export type FitPromptInput = {
  gap: FitGap
  role: CvRole
  message: string
  history: FitMessage[]
  stories: CvStory[]
  company: CompanyProfile | null
  maxChars: number
}

export function fitMessages(input: FitPromptInput): ChatMessage[] {
  const bullets = input.role.bullets
    .map((bullet) => `- ${bullet.text}`)
    .join('\n')

  const stories = input.stories
    .slice(0, 8)
    .map(
      (story) =>
        `- [${story.company ?? 'unknown role'} / ${story.title ?? 'unknown title'}] ${story.userText}${
          story.bullet ? ` (approved as: ${story.bullet})` : ''
        }`,
    )
    .join('\n')

  const history = input.history
    .slice(-6)
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join('\n')

  return [
    { role: 'system', content: FIT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Gap to close: ${input.gap.label}${input.gap.kind === 'must' ? ' (must have)' : ' (worth showing)'}
Gap terms: ${input.gap.terms.join(', ')}

Target role: ${input.role.title ?? 'unknown title'} at ${input.role.company ?? 'unknown company'} (${input.role.dates ?? 'dates unknown'})
Existing bullets:
${bullets || '(none)'}

Stored confirmed facts:
${stories || '(none)'}

Conversation:
${history || '(none)'}

Candidate's latest message:
"""
${input.message}
"""

Max characters for the first bullet: ${input.maxChars}
Respond with the JSON object only.`,
    },
  ]
}
