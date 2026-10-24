import type { ChatMessage } from '../cloudflare'
import type { CvBlock } from '../../shared/cv-classification'

/**
 * The model sees numbered DOCX blocks, not a rendered PDF. That keeps every
 * extracted field tied to a block the edit API can rewrite later.
 */
export const CV_SYSTEM_PROMPT = `You extract a CV into structured data for a CV matcher. The input is a list of text blocks from a DOCX. Each block has an id like p:12. Return one JSON object and nothing else.

Rules
- Copy text verbatim. Never rewrite, summarise or invent. The CV's own words are the output.
- Group experience into roles, one role per job. Company, title, dates and location may share one block. For each field add an anchor with the blockId and the exact substring in "find". If the field is the whole block, use null for find.
- Bullets belong to the role above them. Each bullet is { "text": "...", "anchor": { "blockId": "p:6", "find": null } }.
- Education and projects use the same idea. Put degrees in "degree" and institutions in "institution".
- skills, languages and certifications are flat lists of the exact terms stated, plus an anchor for the line they came from.
- contact: name, headline, email, phone, location, links. Use null when absent, and anchors for the fields that exist.
- summary: the CV's profile/summary paragraph verbatim, or null. Do not write a new summary.
- A find value must be an exact substring of that block. If you cannot quote it exactly, use null. Never point an anchor at a block that does not contain the field.
- Ignore empty blocks, page numbers and decorative separators.
- Do not invent dates, employers, titles or skills.

Return exactly this shape:
{
  "contact": {
    "name": "Ava Chen",
    "headline": "Senior Frontend Engineer",
    "email": "ava.chen@hey.com",
    "phone": "+49 30 5550 1182",
    "location": "Berlin, Germany",
    "links": ["linkedin.com/in/avachen"],
    "anchors": {
      "name": { "blockId": "p:0", "find": null },
      "headline": { "blockId": "p:1", "find": "Senior Frontend Engineer" },
      "email": { "blockId": "p:1", "find": "ava.chen@hey.com" },
      "phone": { "blockId": "p:1", "find": "+49 30 5550 1182" },
      "location": { "blockId": "p:1", "find": "Berlin, Germany" }
    }
  },
  "summary": "Frontend engineer with eight years of experience.",
  "summaryAnchor": { "blockId": "p:3", "find": null },
  "roles": [
    {
      "company": "Northwind Labs",
      "title": "Senior Frontend Engineer",
      "dates": "2021 — Present",
      "location": "Berlin",
      "summary": null,
      "anchors": {
        "company": { "blockId": "p:5", "find": "Northwind Labs" },
        "title": { "blockId": "p:5", "find": "Senior Frontend Engineer" },
        "dates": { "blockId": "p:5", "find": "2021 — Present" },
        "location": { "blockId": "p:5", "find": "Berlin" }
      },
      "bullets": [
        { "text": "Led the rebuild of the design system.", "anchor": { "blockId": "p:6", "find": null } }
      ]
    }
  ],
  "education": [
    {
      "institution": "TU Delft",
      "degree": "BSc Computer Science",
      "dates": "2012 — 2016",
      "details": [],
      "anchors": {
        "institution": { "blockId": "p:12", "find": "TU Delft" },
        "degree": { "blockId": "p:12", "find": "BSc Computer Science" },
        "dates": { "blockId": "p:12", "find": "2012 — 2016" }
      }
    }
  ],
  "projects": [],
  "skills": ["TypeScript", "React"],
  "skillsAnchor": { "blockId": "p:14", "find": null },
  "languages": [],
  "languagesAnchor": null,
  "certifications": [],
  "certificationsAnchor": null
}`

function blockLine(block: CvBlock) {
  const flags = [
    block.style ? block.style : '',
    block.list ? 'list' : '',
    block.inTable ? 'table' : '',
  ]
    .filter(Boolean)
    .join(', ')

  return `[${block.id}]${flags ? ` (${flags})` : ''} ${block.text}`
}

export function cvMessages(blocks: CvBlock[]): ChatMessage[] {
  const body = blocks
    .filter((block) => block.text)
    .map(blockLine)
    .join('\n')

  return [
    { role: 'system', content: CV_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Extract this CV. Respond with the JSON object only.\n\n${body}`,
    },
  ]
}

export function repairCvMessages(blocks: CvBlock[], reply: string): ChatMessage[] {
  return [
    ...cvMessages(blocks),
    { role: 'assistant', content: reply.slice(0, 8000) },
    {
      role: 'user',
      content:
        'That reply was not a single valid JSON object. Return only the JSON object with every brace closed and no prose.',
    },
  ]
}
