import type { ChatMessage } from './cloudflare'
import type { CvStory } from '../shared/cv-fit'
import type { JdClassification } from '../shared/jd-classification'
import { PROMPT_SAFETY, untrusted } from './prompt-safety'

const SYSTEM = `You write application material for one specific role. Return one JSON object and nothing else.

${PROMPT_SAFETY}

The candidate's CV and experience notes are the only source of facts. Never invent an employer, tool, metric, date, degree or outcome. You may select, order and connect facts, but do not add new ones. Do not claim a requirement the evidence does not support. If the posting names a requirement, category or label that is not explicit in the CV or notes, leave it out rather than echoing it. Use the candidate's own terms for tools. Do not state years of experience unless the CV states them. Do not use placeholders such as [Company] or [name].

Voice: direct, specific, calm. No "I am excited to apply", no generic praise, no adjectives that could describe any company. Prefer concrete work over self-description.

Return JSON only, with no code fence or commentary.`

export type ComposePromptInput = {
  kind: 'cover-letter' | 'email'
  cvText: string
  jd: JdClassification
  stories: CvStory[]
}

function requirementLines(jd: JdClassification) {
  return jd.requirements
    .map((item) => {
      const terms = [...item.match, ...item.items].filter(Boolean)
      return `- ${item.importance === 'must' ? 'Must' : 'Nice'}: ${item.label}${
        terms.length ? ` (${terms.slice(0, 4).join(', ')})` : ''
      }`
    })
    .slice(0, 24)
    .join('\n')
}

function storyLines(stories: CvStory[]) {
  return stories
    .slice(0, 8)
    .map((story) => {
      const where = [story.title, story.company].filter(Boolean).join(' at ')
      return `- ${where || 'Experience'}: ${story.userText.slice(0, 500)}${
        story.skills.length ? ` [skills: ${story.skills.slice(0, 8).join(', ')}]` : ''
      }`
    })
    .join('\n')
}

export function composeMessages(input: ComposePromptInput): ChatMessage[] {
  const cv = input.cvText.replace(/\s+/g, ' ').trim().slice(0, 10_000)
  const jd = input.jd

  const role = `Role: ${jd.role.title || 'Unknown role'}
Company: ${jd.company.name || 'Unknown company'}
Summary: ${jd.summary}
Work: ${[jd.work.mode, jd.work.location, jd.work.employment].filter(Boolean).join(' · ') || 'not stated'}
Compensation: ${jd.compensation.salary || 'not stated'}

Requirements:
${requirementLines(jd) || '(none)'}

Responsibilities:
${jd.responsibilities.slice(0, 8).map((entry) => `- ${entry}`).join('\n') || '(none)'}`

  const experiences = storyLines(input.stories) || '(none saved)'

  if (input.kind === 'cover-letter') {
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `${untrusted('job', role, 3_000)}

${untrusted('cv_text', cv, 10_000)}

${untrusted('experience_notes', experiences, 5_000)}

Write a cover letter in plain text, 260–340 words.
- Open with the role and the strongest concrete overlap; do not announce that you are applying in the first sentence.
- Use 3–4 short paragraphs. No address block, no date, no bullet list, no markdown.
- Make at least two claims traceable to the CV or notes.
- Use a greeting and a sign-off. Use the candidate's name from the CV if it is present; otherwise close with "Sincerely," only.
- Do not mention a gap or weakness.
- Do not repeat the job description back to the reader.

Return exactly:
{"coverLetter":"..."}`,
      },
    ]
  }

  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `${untrusted('job', role, 3_000)}

${untrusted('cv_text', cv, 10_000)}

${untrusted('experience_notes', experiences, 5_000)}

Write a short application email in plain text.
- Subject: specific to the role and company, under 80 characters, no exclamation mark.
- Body: 90–140 words, 2–3 short paragraphs. Say what the candidate brings and name one or two concrete facts from the CV or notes. Do not mention an attachment; the sender controls whether the CV is attached.
- No markdown, no bullet list, no placeholders.
- Greet the hiring team and sign with the candidate's name from the CV if present.

Return exactly:
{"subject":"...","body":"..."}`,
    },
  ]
}
