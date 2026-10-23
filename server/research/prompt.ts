import type { ChatMessage } from '../cloudflare'
import { SECTORS } from '../../shared/jd-classification'

type Source = { title: string; url: string; content: string }

export type ResearchInput = {
  company: string
  role: string
  jd: string
  sources: Source[]
}

/**
 * The research pass only reads public pages about the company. It never sees the
 * CV, and it must quote what the sources actually say.
 */
const RESEARCH_SYSTEM_PROMPT = `You research companies for a job applicant. Read the supplied sources and return one JSON object and nothing else.

Field rules
- name: the company's common name.
- summary: 1-2 factual sentences about what the company builds. No marketing language.
- sectors: 1-4 of ${SECTORS.join(' | ')}. Describe the product. A consumer video editor is ["media", "consumer"]; an AI-native one also gets "ai". Use the same sector words every time.
- founders: only people a source names as a founder or co-founder, with their role when stated. [] when none are named.
- stage: the funding stage or accelerator only when stated, e.g. "YC W26", "Seed", "Series A". null otherwise.
- funding: amount, investors or notable backers only when stated. null otherwise.
- links: up to 4 official product or company links worth opening.
- signals: 2-5 areas of relevant experience the company's work implies for this role. These are shown in amber as worth showing, never as requirements.
  Each signal: label (short), terms (1-6 short terms that could appear in a CV, drawn from the sources or the role), reason (one sentence tying it to the company), evidence (a short quote from a source, max 140 chars).
  Example for a consumer video editor: label "Video capture and processing", terms ["video", "4K", "HDR", "camera"], reason "The product is built around editing real phone footage".
- sources: the URLs you actually used.

Never invent a founder, funding amount, sector or product. If a field is not supported by the sources, use null or [].

Return exactly this shape:
{
  "name": "...",
  "summary": "...",
  "sectors": ["..."],
  "founders": [{ "name": "...", "role": "..." }],
  "stage": null,
  "funding": null,
  "links": [{ "title": "...", "url": "https://..." }],
  "signals": [
    {
      "label": "...",
      "terms": ["..."],
      "reason": "...",
      "evidence": "..."
    }
  ],
  "sources": ["https://..."]
}`

export function researchMessages(input: ResearchInput): ChatMessage[] {
  const results = input.sources
    .map((source, index) => {
      const body = source.content.trim().slice(0, 6000)
      return `[${index + 1}] ${source.title}\n${source.url}\n\n${body}`
    })
    .join('\n\n---\n\n')

  return [
    { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Company: ${input.company}
Role being hired: ${input.role}

Posting excerpt:
"""
${input.jd.slice(0, 2500)}
"""

Sources:
${results}

Research only from these sources. Respond with the JSON object only.`,
    },
  ]
}
