# Caddie

Paste a job description, see how much of it your CV already covers. Missing
requirements are highlighted in red on the posting itself.

![Caddie: a one-page CV preview beside a job description with uncovered requirements marked in red](docs/caddie.png)

## Run it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. Click **Try a sample role** in the job
description panel to see the matcher working, or paste your own posting.

```bash
npm run build    # typecheck + production build
npm run preview  # serve the build
npm run lint
```

## What's here

- **One-page CV** — an A4 document rendered at 794×1123px and scaled to fit, so
  the layout stays identical at every viewport. Read-only for now.
- **Job description panel** — paste, review, and edit modes. Coverage and gaps
  update as soon as text arrives.
- **Matching** — a deterministic, client-side matcher over a curated skills
  lexicon (`src/lib/skills.ts`). No network calls, nothing leaves the page.

Built with Vite, React, Tailwind CSS v4 and shadcn/ui. Design and engineering
conventions are in [AGENTS.md](AGENTS.md).
