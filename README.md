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

Then open <http://localhost:5173>. Click **Upload CV** to load your own PDF, or
click **Try a sample role** in the job description panel to see the matcher
working on the sample profile.

`npm run dev` starts Vite and the classifier server together. The matcher needs
no setup; the **Data** tab does. Copy `.env.example` to `.env.local` and fill in
`CF_ACCOUNT_ID` and `CF_API_KEY` for Cloudflare Workers AI (Bun is required for
the server). Add `BROWSERBASE_API_KEY` to research the company; without it,
classification and matching still work.

```bash
npm run build    # typecheck + production build
npm run preview  # serve the build
npm run lint
npm run eval     # score Gemma/JEV against eval/corpus.ts
```

## What's here

- **Your CV** — upload a PDF and it is drawn page by page at the width of the
  pane, with arrows to move between pages. Its text stays selectable and
  copyable, and the last upload is restored from your browser on reload. Until
  you upload, a sample CV is shown, authored at 794×1123px and scaled so its
  layout is identical at every viewport.
- **Job description panel** — paste, review, and data modes. Gemma reads a
  pasted posting in the background; once it is done, the score and red gaps
  appear in Review, with amber signals for relevant experience to show.
- **Matching** — `src/lib/match.ts` scores the classified must-haves against
  the text of the CV on screen: an uploaded PDF's extracted text, or the
  sample. Single-word terms use the CV vocabulary, multi-word terms must appear
  as a phrase, and either-or groups are covered by any alternative. Missing
  must-haves turn red; nice-to-haves and implied signals turn amber and never
  change the score. Matching is instant and runs in the browser, so replacing
  the CV updates the score immediately.
- **Data tab** — Gemma reads the posting into the structured object in
  `shared/jd-classification.ts`: role, the fields it covers, company sectors,
  work arrangement, pay, requirements with CV-searchable match terms, signals,
  responsibilities, benefits and keywords. For a named employer, Browserbase
  searches and reads public pages so Gemma can add a company profile — summary,
  founders, stage, funding, links and more relevant signals. Classification
  sends the posting to Cloudflare; research sends the company name to
  Browserbase. Your CV never leaves the browser.

Built with Vite, React, Tailwind CSS v4 and shadcn/ui. Design and engineering
conventions are in [AGENTS.md](AGENTS.md).
