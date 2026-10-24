# Caddie

A job-description → CV matcher. Paste a posting, see how much of it the CV
already covers, with the gaps marked in red on the posting itself.

Read this before changing UI. It is the contract for how Caddie should look and
behave, so the product stays coherent no matter which agent works on it next.

## Stack

- Vite 8, React 19, TypeScript
- Tailwind CSS v4, CSS-first config in `src/index.css` (no `tailwind.config.js`)
- shadcn/ui, `base-nova` style on `@base-ui/react` — add components with
  `npx shadcn@latest add <name>`; they land in `src/components/ui/`
- `lucide-react` icons, Geist + Newsreader variable fonts via Fontsource
- `pdfjs-dist` (legacy build) for uploaded CVs — canvas artwork plus a text layer
- LibreOffice headless for DOCX → PDF rendering; `jszip` + `@xmldom/xmldom` for
  anchored DOCX text edits
- Bun + Hono for the classifier API (`server/`), calling Cloudflare Workers AI
  (Gemma for extraction, Clef-flash as the paste guard)
- Browserbase Search + Fetch for company research, extracted against a JSON schema
- `shared/jd-classification.ts` is the classification contract shared by the
  server, the client and the eval. Do not fork the shape in a component.
- Path aliases `@/*` → `src/*` and `@shared/*` → `shared/*`. Note the shadcn
  convention here: components import `cn` from the `cn` package, not from
  `@/lib/utils`.

```bash
npm run dev      # Vite + classifier server; http://localhost:5173
npm run build    # tsc -b && vite build
npm run lint     # oxlint
npm run api      # classifier only, http://localhost:8787
npm run eval     # classifier scoreboard against eval/corpus.ts
```

The classifier needs Cloudflare credentials. Copy `.env.example` to `.env.local`
and fill in `CF_ACCOUNT_ID` and `CF_API_KEY`; never prefix them with `VITE_`.
Company research additionally needs `BROWSERBASE_API_KEY`. Matching works
without either key; classification does not, and research is skipped without it.

DOCX uploads need LibreOffice (`soffice`) on the server path. Override it with
`SOFFICE_BIN` if it lives elsewhere. The fit assistant also needs poppler
(`pdfinfo` and `pdftotext`) to measure rendered lines.

## Brand

**Caddie** — the person who reads the course and carries the bag. The tone is
calm, specific and useful: no hype, no exclamation marks, no emoji in product UI.
Copy is sentence case. Say "your CV", never "your resume".

The mark is a pin flag in a blue squircle (`src/components/caddie-mark.tsx`,
`public/favicon.svg`). The flag is the role, the caddie gets you to it.

### Colour

All tokens live in `src/index.css`. **Never hard-code a hex in a component.**
The one exception is the CV document, which is print artwork and owns its own
neutral greys.

| Token | Value | Use |
| --- | --- | --- |
| `brand-600` | `#2347e6` | primary actions, progress fill, the mark |
| `brand-700` | `#1b35c4` | CV section labels, small blue text |
| `brand-500` / `brand-400` | `#3a66f5` / `#628dff` | hover, accents |
| `brand-50` / `brand-100` | `#eef3ff` / `#dce7ff` | tinted surfaces, tracks |
| `ink` | `#0d1526` | headings and strong text |
| `canvas` | `#f4f6fb` | app background behind the paper |
| `mark` | `#ffe2e2` | **only** for "not found in your CV" |
| `mark-foreground` | `#a31818` | text inside those marks |
| `related` | `#fff3d6` | **only** for "worth showing" (nice-to-have or implied) |
| `related-foreground` | `#7a4a00` | text inside amber marks |
| `success` | `#0f7b52` | positive results, use sparingly |

Blue is the product colour: use it for the primary path through the UI. The
`mark` family means one thing — a must-have your CV does not cover. The
`related` family means relevant experience worth showing; it never lowers the
score and must never be used for a required gap. Do not reuse red or amber for
decoration, and do not use blue to mean "missing". Neutral surfaces are white
cards on the canvas with a `border-border` hairline; shadows are for the paper
and the JD card only.

### Type

- UI: Geist, 11–15px, `tracking-[-0.015em]` on headings. Numbers use
  `tabular-nums`.
- CV: Geist for body; Newsreader (serif) for the name only. Section labels are
  9px, uppercase, `tracking-[0.22em]`, blue.
- Max line length in the JD reader is ~65 characters. Never let prose go full
  width of a wide pane.

### Shape

`--radius: 0.75rem`: cards `rounded-xl`, controls `rounded-lg`, pills
`rounded-md`/`rounded-full`. Slop is a finding: don't mix 8, 10 and 12px radii
in one cluster.

### Motion

150–250ms, `ease-out`, and only where it explains a change (progress fill, the
coverage ring). Honour `prefers-reduced-motion` for anything longer. No
entrance animations on load, no bouncing.

## Layout

- Desktop is a fixed shell: `h-dvh overflow-hidden`, header + two panes that
  scroll independently. Left = the CV, right = the job description. The right
  rail is 404–460px; the CV pane keeps the paper centred in the remaining space.
- Below `lg` the panes stack and the page scrolls normally.
- **The CV document is authored at exactly 794×1123px** (`src/lib/page.ts`, A4
  at 96dpi) and scaled with a CSS transform by `src/components/cv/cv-preview.tsx`.
  Never convert it to fluid units or responsive font sizes — line breaks and the
  one-page guarantee depend on the fixed canvas. After changing CV content,
  re-measure: the last element must finish inside 1123px, ideally with 40–60px
  of bottom margin.
- **An uploaded PDF replaces that paper.** Pages are rendered at the measured
  pane width, stacked with `paper-shadow`, and scaled by width only — never
  crop or letterbox a page. pdf.js's text layer sits over each canvas so text
  can be selected and copied; keep it, and keep the toolbar arrows working at
  every width (sticky at the bottom of the pane, hidden for a single page).
- **An uploaded DOCX is rendered to PDF server-side** by LibreOffice, then shown
  through the same viewer. Margins, styles, tables and installed fonts come from
  the renderer; a font missing on the server is substituted. The source DOCX is
  kept in IndexedDB so it can be edited and re-rendered.
- The last upload is restored from IndexedDB on load (`src/lib/cv-store.ts`).
  PDF sources stay in the browser. DOCX sources are sent to the local server for
  rendering, editing and classification, never stored there. There is no account.
- The paper is read-only in the UI. Text changes happen only through the DOCX
  edit API; do not add editable affordances to the rendered paper.

## How matching works

The score is built from the classified posting, not from a separate pass over
the raw text.

`src/lib/match.ts` runs on the client and:

1. takes the **must-have** requirements from the classification; nice-to-haves
   and `signals` are "worth showing", not gaps
2. matches each requirement's `match` terms against the CV: single words use
   the canonical vocabulary, multi-word terms must appear as a phrase
   ("React Native" cannot be satisfied by "English (native)")
3. treats either-or groups and match alternatives as covered when any one
   appears; `src/lib/skills.ts` can imply CV terms ("React Native" implies
   mobile app work)
4. finds every uncovered must in the posting — its match terms first, then the
   label, then the evidence quote — and returns red pieces
5. does the same for nice-to-haves and signals, returning amber pieces
6. returns `coverage`, `matched`, `total`, `gaps` and `related`

Must-haves are the only thing that lowers the score. Prose that is not a
classified requirement is never highlighted. Matching is client-side and
recomputes instantly when the CV changes.

`detectRequirements` in `src/lib/analyze.ts` remains the candidate finder for
JEV, which cannot generate text. **Add vocabulary and implied terms to
`src/lib/skills.ts`, not conditionals to the matcher.**

## Reading a posting as data

The **Data** tab turns the posting into the object in
`shared/jd-classification.ts`: role, the areas it covers (`role.fields`), company
sectors, work arrangement, compensation, requirements (must/nice, either-or
groups, years, `match` terms), `signals`, responsibilities, benefits, keywords
and a one-sentence summary. The same classification supplies the must-have set
that `src/lib/match.ts` scores against the CV.

- The browser posts the JD to `/api/classify` (`src/lib/classify.ts`). The Bun
  server (`server/classify/`) builds the prompt and calls Cloudflare Workers AI.
- **Non-JD pastes are blocked first.** A local rules check
  (`shared/jd-guard.ts`) rejects links, CVs, cover letters and chats in the
  browser. The server repeats it and sends only the uncertain middle to
  Clef-flash (`server/validate.ts`); a rejection returns `not-a-jd` before Gemma
  runs. Never spend a Gemma call to discover that the paste is not a posting.
- **Gemma is the default model.** JEV is implemented (`server/classify/jev.ts`)
  as a decision-model alternative for the eval, but it is billed as a
  third-party model and needs credits on the account. Do not expose a model
  picker unless both models actually run.
- Every answer goes through `normaliseClassification` before it reaches the UI.
  Models are inconsistent; the normaliser is the contract. Fix data problems
  there or in the prompt, not with component conditionals.
- Classification is slow (tens of seconds) and costs credits. It starts on
  paste or sample load because the score depends on it, and stays available
  from the Data tab for hand-typed text. Always show the loading state, keep
  the request abortable, and say where the text is sent.
- **Company research** runs after a classification that names an employer. The
  server searches through Browserbase — the query uses the company, role fields
  and one-line summary, not the full posting — then Browserbase Fetch extracts a
  profile against a JSON schema: summary, sectors, founders, stage, funding,
  links and `signals`. No chat model reads the pages, so research costs no
  Gemma tokens. It never sees the CV. Show its loading and error states; never
  block the score on it.
- **Stability is deliberate.** Classification runs at temperature 0 and is
  cached by a hash of the JD; a company's sectors are cached by
  `companyKey(name)` and reused across postings; research is cached per company
  (`server/cache.ts`, `.cache/`). Research sectors, not the classifier's guess,
  are the display truth once available.
- `signals` are relevant experience the posting implies but does not require
  (camera/video/4K, resilient uploads, AI agents). They are amber, never red,
  and never part of the score.
- `npm run eval` scores model changes against `eval/corpus.ts` and rewrites
  `eval/report.md`; it bypasses the classification cache. Curate labels there,
  not in the runner.
- If a new field is worth showing, add it to the shared type, the normaliser and
  the prompt together. Never invent a field in the renderer.

## DOCX CVs and anchored edits

DOCX is the editable source; the PDF is a rendering of it.

- `server/cv/docx.ts` opens the zip, rejects macros, ActiveX and embedded OLE,
  and maps every body paragraph to a stable block id (`p:12`) with text, style
  and list/table flags. `word/document.xml` is the only part rewritten.
- `server/cv/render.ts` runs LibreOffice headless with a per-job profile. It is
  not Word: line breaks can differ, and fonts not installed on the server are
  substituted. Carlito/Caladea/Liberation are the sensible base; a DOCX that
  embeds its fonts may render closer.
- Edits are `{ blockId, find?, text }`. `find` replaces a substring (a role
  title inside a line that also holds dates); omitting it replaces the whole
  block. The first affected run keeps its `w:rPr`, so the same font, size and
  weight survive; the rest of the paragraph is left intact.
- `POST /api/cv/convert` returns a PDF, `POST /api/cv/parse` returns blocks,
  `POST /api/cv/edit` returns edited DOCX + PDF + blocks as base64, and
  `POST /api/cv/classify` returns the structured CV. Keep user-facing editing
  out of the paper until the UI is designed; the API exists for agents.
- `shared/cv-classification.ts` is the CV contract. Every field carries an
  anchor (`{ blockId, find }`) back to the DOCX, so a future JD-fit pass can say
  "change role 2's title" and apply it without guessing. The model reads
  numbered blocks; the normaliser rejects anchors that do not point at real
  text.
- CV classification is not cached. The extracted CV is personal data, so the
  server keeps it only in memory for the request; the caller receives it and the
  DOCX remains in IndexedDB. The block text is sent to Cloudflare for extraction,
  like the posting; the CV is never sent to Browserbase.
- Cloudflare transport failures are retried once (as are 429/5xx responses) and
  logged server-side. CVs over 80k characters get a clear "too much text" error
  instead of an opaque model failure.

## CV fit assistant and the managed profile

The floating **Improve CV** drawer closes a JD gap with the candidate's own
evidence. It is not an editor: the paper stays read-only and nothing changes
until the user approves a diff.

- The user picks a gap and a role, then states the fact in their own words.
  Gemma may condense it into one past-tense bullet, but it must not invent a
  tool, metric, employer or outcome. If the fact is too thin, it asks instead.
- Replacement is deterministic: only existing bullets with a whole-block anchor
  are targets; bullets that already cover the gap are excluded; the least
  JD-relevant bullet is proposed, and the bullet text must equal the target
  block. We never rewrite a line that also contains a date or other field.
- **Line count is enforced by rendering, not characters.** `server/cv/fit.ts`
  renders the original and each candidate through LibreOffice, then
  `server/cv/measure.ts` compares page count and non-empty text lines with
  poppler. A candidate that changes either is rejected. If no candidate fits,
  the assistant says so instead of silently pushing the CV to another page.
- `POST /api/cv/fit` returns a proposal (bullet, target block, rationale,
  facts used, line/page counts) or a question. Applying is a normal
  `/api/cv/edit` call after the user approves. There is no auto-apply.
- Stories are stored locally in IndexedDB (`caddie-profile`): the candidate's
  own wording, the approved bullet, role, gap and confirmed skills. They are
  reused for later JDs. This is the local managed profile; there is no server
  database yet. Do not treat an unapproved draft as a fact.
- The assistant request carries the CV, JD, gap, role, conversation and relevant
  stories to the local server and Gemma. Nothing is cached; no CV or story is
  written to the server's disk.
- Current scope: one bullet replacement, one fact at a time. Multi-bullet
  rewrites, role-title changes and applying a whole fit plan are next.

## UI quality bar

Caddie should look designed, not generated. Two community skills are installed
in `.agents/skills/` and load with the `skill` tool:

- `better-ui` — exact values for radii, shadows, icon states and motion
- `frontend-design` — aesthetic direction, typography, avoiding templated UI

Catalogue: <https://www.ui-skills.com/>. Add more with
`npx skills add <owner/repo> --skill <name> --yes` (they install to
`.agents/skills/`) and tell the user which ones you installed.

House rules that outrank taste:

- Real content, not lorem ipsum. Numbers in the UI must come from real analysis.
- One primary action per surface. Empty states carry the action.
- Every control is a real button/link with a visible focus ring; icons alone need
  an `aria-label`.
- Touch targets on mobile are at least 44×44px.
- Do not add a control that has no behaviour. A disabled button with no
  implementation is worse than no button.
- Red is a status, not an accent.

Before calling UI work done: `npm run build`, `npm run lint`, check the one-page
CV measurement, and look at 1440px and 390px widths.

## Status

Built: brand + tokens, one-page CV preview, PDF and DOCX CV upload with
page-by-page viewing and selectable text, DOCX-to-PDF rendering through
LibreOffice, JD paste/review with classification-backed coverage (red missing
must-haves, amber "worth showing" signals), coverage ring/bar, gap chips, a
Clef-flash non-JD guard, JD classification into structured data (Data tab,
Gemma via the Bun server), company research through Browserbase, an anchored
DOCX edit API, CV classification, a CV fit assistant with a local story profile,
and an eval harness.

Not built yet: a server-backed managed profile/accounts, direct text editing on
the paper, multi-bullet or role-title rewrites, applying a whole fit plan,
saving classifications, a job library, PDF export, per-line/section analysis,
or a database. The uploaded CV and the local story profile are restored from
IndexedDB on reload. A DOCX is sent to the local server for rendering, editing,
classification and fitting and is never stored there. Don't imply anything else
persists. Don't imply these exist in copy until they do.
