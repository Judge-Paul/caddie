# Caddie

Paste a job description, see how much of it your CV already covers. Missing
requirements are highlighted in red on the posting itself.

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
the server).

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
- **Job description panel** — paste, review, and edit modes. Coverage and gaps
  update as soon as text arrives.
- **Matching** — a deterministic, client-side matcher over a curated skills
  lexicon (`src/lib/skills.ts`). It reads the text of the CV on screen: an
  uploaded PDF's extracted text, or the sample. No network calls, nothing
  leaves the page.
- **Data tab** — on demand, Gemma reads the posting into the structured object
  in `shared/jd-classification.ts`: role, company, work arrangement, pay,
  requirements, responsibilities, benefits and keywords. That step sends the
  posting to Cloudflare Workers AI; coverage never does.

Built with Vite, React, Tailwind CSS v4 and shadcn/ui. Design and engineering
conventions are in [AGENTS.md](AGENTS.md).
