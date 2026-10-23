import type { ChatMessage } from '../cloudflare'

/**
 * The contract the model is asked to fill. `shared/jd-classification.ts` then
 * coerces the answer, so this prompt can stay about judgement rather than types.
 */
export const CLASSIFY_SYSTEM_PROMPT = `You turn job descriptions into structured data for a CV matcher. Return one JSON object and nothing else.

Field rules
- role.title: the job title as written. Drop the company, location, team and req IDs. If several titles appear, use the one being hired for.
- role.family: frontend | backend | fullstack | mobile | data | ml | devops | security | design | product | qa | other
- role.seniority: intern | junior | mid | senior | staff | principal | lead | director | unspecified. Use the title first, then the years of experience asked for.
- role.fields: 1-6 short lowercase areas the role actually covers, e.g. ["mobile", "video editing", "ai agents"]. Describe the work, not the title.
- company.name: the employer's name, or null when the posting never names them.
- company.sectors: 1-4 of ai | media | consumer | design | productivity | saas | developer-tools | fintech | health | ecommerce | marketplace | education | gaming | agency | logistics | other. Describe what the company builds, not the role. A consumer video editor is ["media", "consumer"]; an AI-native one also gets "ai". Pick the product's sectors and use the same set for the same company.
- work.mode: remote | hybrid | onsite | unspecified. "Remote (EU)" is remote; "three days in the office" is hybrid.
- work.location: as written, e.g. "Berlin, Germany" or "EU". null when absent.
- work.employment: "Full-time", "Part-time", "Contract", "Internship" as stated, else null.
- work.timezone: only when a specific zone or overlap is stated, else null.
- compensation.salary: the range as written, e.g. "€70,000–€90,000", else null.
- compensation.equity: true only when equity, shares, options or RSUs are offered; null when pay is not discussed.

Requirements
- Collect what the employer actually asks for: skills, tools, platforms, practices, qualifications, experience, languages, degrees. Between 6 and 30 entries; never pad the list.
- A tool or practice the role must use is a requirement even when it appears under responsibilities: "Work with GraphQL and Apollo Client" means GraphQL and Apollo are expected, "Maintain our design system" means design systems are expected.
- importance "nice" only when the posting marks it optional: it sits under a heading such as "Nice to have", "Bonus" or "Preferred", or the sentence itself calls it a bonus, plus, ideally, or something they would love. Everything under "What we are looking for", "Requirements" or "You have" is "must".
- Words like "familiarity", "comfortable with" or "exposure to" do not make something optional on their own. Judge the section the line sits in.
- combination "any" only when the posting accepts alternatives and the words "or" or "/" appear between them. Every "X or Y" counts, including inside a nice-to-have line: "React Native or Kotlin", "Go or Rust", "ISO 20022 or SEPA formats" -> any ["ISO 20022", "SEPA"], "Motion design or prototyping with code" -> any ["Motion design", "prototyping"]. items then holds each alternative.
- combination "all" for everything the candidate needs to have.
- items must hold exactly one term, or the alternatives of an "any" entry. Never bundle separate requirements into one entry.
- Contrast these two lines:
  "React Native or Kotlin" -> one entry, combination "any", items ["React Native", "Kotlin"].
  "AWS with Docker and Kubernetes" -> three entries, each combination "all" with one item.
- items: short terms, spelled as the posting spells them ("React Native", "Kotlin", "A/B testing"). No invented expansions, no sentences, no term repeated across entries.
- match: 1-4 short terms a CV would contain that evidence this requirement. Skills use their usual spelling. Experience sentences use the nouns and technologies that demonstrate them, never the sentence itself. Any ONE match term satisfies the requirement.
  An experience requirement should include the concrete tools named in the same section that would demonstrate it.
  "Shipped mobile apps people use every day" (alongside "Swift, Kotlin, or React Native") -> ["iOS", "Android", "Swift", "Kotlin", "React Native", "mobile app"].
  "You're a strong mobile engineer, whether that's Swift, Kotlin, or React Native" -> ["Swift", "Kotlin", "React Native"].
  "Built a camera, photo, or video app" -> ["camera", "photo", "video"].
  "5+ years of professional frontend experience" -> ["frontend"].
  A common synonym the posting does not use is allowed ("React" for "React.js"); never invent a technology or tool.
- category: language | framework | tool | platform | practice | domain | soft-skill | education | experience | other
- years: the minimum years stated for that requirement (a number), else null. "5+ years of frontend experience" becomes years 5 on that entry.
- evidence: a verbatim snippet from the posting, at most 120 characters, that justifies the entry. If you cannot quote it, use "".

Signals
- Collect 0-6 relevant experience areas the posting implies but does not demand. These are shown in amber as worth showing, never scored and never treated as gaps.
- Use responsibilities and product context, not the requirement list. Do not duplicate a requirement, and do not move an explicit nice-to-have here.
- Each signal: label (short), terms (1-6 CV-searchable terms), reason (one sentence), evidence (a verbatim snippet, max 120 chars).
  "Handling real phone footage: 4K, HDR, and huge files" -> label "Phone video capture and processing", terms ["4K", "HDR", "footage", "camera", "video"], reason "The role works with real phone footage in a video editor".
  "Uploads that survive bad networks and the app going to the background" -> label "Resilient uploads", terms ["uploads", "background", "offline", "networks"], reason "Uploads must survive weak networks and backgrounding".
- If nothing is implied beyond the requirements, return [].

Also
- responsibilities: up to 8 short verb phrases ("Own the dashboard experience").
- benefits: up to 8 short phrases ("28 days holiday").
- keywords: up to 15 terms that identify this posting: product, domain, customers, distinctive tools. Lowercase unless it is a proper noun.
- summary: one factual sentence under 160 characters. No marketing language.

Never invent a requirement, technology, benefit or company fact. A match term may use a common synonym for something in the posting; signals must be grounded in a quoted line. If a section is absent, return [] or null rather than guessing.

Return exactly this shape:
{
  "role": { "title": "...", "family": "...", "seniority": "...", "fields": ["..."] },
  "company": { "name": null, "sectors": ["..."] },
  "work": { "mode": "...", "location": null, "employment": null, "timezone": null },
  "compensation": { "salary": null, "equity": null },
  "requirements": [
    {
      "label": "React Native or Kotlin",
      "category": "framework",
      "importance": "must",
      "combination": "any",
      "items": ["React Native", "Kotlin"],
      "match": ["React Native", "Kotlin"],
      "years": null,
      "evidence": "React Native or Kotlin on a shipping app"
    }
  ],
  "signals": [
    {
      "label": "Phone video capture and processing",
      "terms": ["4K", "HDR", "footage", "video"],
      "reason": "The role works with real phone footage in a video editor",
      "evidence": "Handling real phone footage: 4K, HDR, and huge files"
    }
  ],
  "responsibilities": ["..."],
  "benefits": ["..."],
  "keywords": ["..."],
  "summary": "..."
}`

export function classificationMessages(jd: string): ChatMessage[] {
  return [
    { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Classify this job description. Respond with the JSON object only.\n\n"""\n${jd.trim()}\n"""`,
    },
  ]
}

export function repairMessages(jd: string, reply: string): ChatMessage[] {
  return [
    ...classificationMessages(jd),
    { role: 'assistant', content: reply.slice(0, 4000) },
    {
      role: 'user',
      content:
        'That reply was not a single valid JSON object. Return only the JSON object, with every brace closed and no prose or code fences.',
    },
  ]
}
