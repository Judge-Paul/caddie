# Caddie

Paste a job description, see how much of it your CV already covers. Missing
must-haves are highlighted in red on the posting; relevant experience worth
adding is highlighted in amber.

![Caddie: a one-page CV preview beside a job description with uncovered requirements marked in red](docs/caddie.png)

## Run it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. Click **Upload CV** to load your own PDF or
DOCX, or click **Try a sample role** in the job description panel to see the
matcher working on the sample profile.

`npm run dev` starts Vite and the classifier server together. The matcher needs
no setup; the **Data** tab does. Copy `.env.example` to `.env.local` and fill in
`CF_ACCOUNT_ID` and `CF_API_KEY` for Cloudflare Workers AI (Bun is required for
the server). Add `BROWSERBASE_API_KEY` to research the company; without it,
classification and matching still work. DOCX rendering additionally needs
LibreOffice (`soffice`) on the server path; `SOFFICE_BIN` overrides it. The fit
assistant also needs poppler (`pdfinfo` and `pdftotext`) to measure rendered
lines.

```bash
npm run build    # typecheck + production build
npm run preview  # serve the build
npm run lint
npm run eval     # score Gemma/JEV against eval/corpus.ts
```

## What's here

- **Your CV** — upload a PDF or DOCX and it is drawn page by page at the width of
  the pane, with arrows to move between pages. Its text stays selectable and
  copyable, and the last upload is restored from your browser on reload. PDFs
  stay in the browser. DOCX files are rendered to PDF by LibreOffice on the
  local server (margins, styles and installed fonts; a missing font is
  substituted) and the source DOCX stays in IndexedDB. Until you upload, a
  sample CV is shown, authored at 794×1123px and scaled so its layout is
  identical at every viewport.
- **DOCX under the hood** — the source is the editable document, not the PDF.
  `/api/cv/edit` replaces anchored text while preserving the original run
  formatting (font, size, weight), then re-renders. `/api/cv/classify` extracts
  contact, summary, roles, bullets, education and skills with an anchor back to
  every editable field. The default read is structural: rules parse the DOCX
  blocks and Clef-flash labels only the ambiguous ones, so it takes about a
  second and generates no text. `?mode=deep` is a manual Gemma read for unusual
  layouts. Classification sends block text to Cloudflare; it is not cached.
  Direct typing on the paper is still not available.
- **CV assistant** — open it from **Improve CV** or a gap chip. The CV read is
  fast (rules + Clef) with a manual **Deep read** fallback for unusual layouts.
  Pick a gap and a role, and describe what you actually did. Gemma condenses that fact into one
  bullet; it never invents a tool, metric or employer. Caddie replaces the least
  JD-relevant bullet in that role, but only if the re-rendered CV keeps the same
  page and line count. The change applies only after you approve the diff.
  Confirmed facts are stored in a local profile (IndexedDB) for future postings.
  `/api/cv/fit` makes the proposal; applying uses the normal DOCX edit API. The
  fit request carries the CV, JD and relevant stories to the local server and
  Gemma, and is not cached.
- **Job description panel** — paste, review, and data modes. A local check plus
  Clef-flash rejects links, CVs and cover letters before Gemma runs. Gemma then
  reads the posting in the background; once it is done, the score and red gaps
  appear in Review, with amber signals for relevant experience to show.
- **Matching** — `src/lib/match.ts` scores the classified must-haves against
  the text of the CV on screen: an uploaded PDF's extracted text (or the PDF
  rendered from a DOCX), or the sample. Single-word terms use the CV vocabulary,
  multi-word terms must appear as a phrase, and either-or groups are covered by
  any alternative. Missing must-haves turn red; nice-to-haves and implied
  signals turn amber and never change the score. Matching is instant and runs in
  the browser, so replacing the CV updates the score immediately.
- **Data tab** — Gemma reads the posting into the structured object in
  `shared/jd-classification.ts`: role, the fields it covers, company sectors,
  work arrangement, pay, requirements with CV-searchable match terms, signals,
  responsibilities, benefits and keywords. For a named employer, Browserbase
  searches and reads public pages, then extracts a company profile — summary,
  founders, stage, funding, links and more signals — with its JSON extraction,
  so research uses no Gemma tokens. Classification sends the posting to
  Cloudflare; research sends the company name, role fields and a one-line
  summary to Browserbase, never the full posting or your CV.

Built with Vite, React, Tailwind CSS v4 and shadcn/ui. Design and engineering
conventions are in [AGENTS.md](AGENTS.md).
