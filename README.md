# Caddie

Paste a job description, see how much of it your CV already covers, and tailor
the CV for that role with evidence you confirm. Each application keeps its own
posting and CV snapshot.

![Caddie: a one-page CV preview beside a job description with uncovered requirements marked in red](docs/caddie.png)

## Run it

Requirements: Bun, Node for the frontend tooling, LibreOffice (`soffice`) for
DOCX rendering, poppler (`pdfinfo`/`pdftotext`) for the fit assistant, and
MongoDB (Atlas or the local Docker container below).

```bash
npm install
cp .env.example .env.local
# Fill in CF_ACCOUNT_ID, CF_API_KEY, BROWSERBASE_API_KEY,
# MONGODB_URI, BETTER_AUTH_SECRET and BETTER_AUTH_URL.
npm run dev
```

For local development, MongoDB can run in Docker:

```bash
docker run -d --name caddie-mongo -p 127.0.0.1:27017:27017 \
  -v caddie-mongo-data:/data/db mongo:latest
```

Set `MONGODB_URI=mongodb://127.0.0.1:27017/caddie` (or use an Atlas connection
string). Generate the auth secret with `openssl rand -base64 32`.

Google sign-in is the only auth path. In Google Cloud Console → APIs & Services
→ Credentials, add this Authorized redirect URI:

```
${BETTER_AUTH_URL}/api/auth/callback/google
```

For local development with the Vite port that is
`http://localhost:5173/api/auth/callback/google`. Copy the Google client ID and
secret into `.env.local` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
`BETTER_AUTH_API_KEY` is only for `@better-auth/infra` and is not needed here.

Open <http://localhost:5173>, continue with Google, upload your CV, then paste a
job description to create an application.

```bash
npm run build    # typecheck + production build
npm run preview  # serve the build
npm run lint
npm run eval     # score Gemma/JEV against eval/corpus.ts
```

## What's here

- **Accounts and dashboard** — Google-only sign-in through Better Auth, backed by
  MongoDB. The dashboard holds your base CV and every application, with its role,
  company, dates and status.
- **Your CV** — upload a DOCX or PDF. The file and its rendered PDF live in your
  account (MongoDB GridFS). A DOCX keeps its fonts and can be tailored; a PDF is
  read-only. Replacing the base CV does not rewrite existing application
  snapshots.
- **Applications** — paste a posting to create an application. Caddie reads the
  posting, scores it against the application's CV, and keeps the classification
  so the workspace opens without re-reading an unchanged posting.
- **Matching** — `src/lib/match.ts` scores the classified must-haves against the
  CV text. Single-word terms use the CV vocabulary, multi-word terms must appear
  as a phrase, and either-or groups are covered by any alternative. Missing
  must-haves turn red; nice-to-haves and implied signals turn amber and never
  change the score. Matching is instant and runs in the browser.
- **CV assistant** — open it from **Improve CV** or a gap chip. Pick a gap and a
  role, then describe what you actually did. Gemma condenses that into one
  bullet, replaces the least JD-relevant bullet, and only approves a change that
  keeps the rendered page and line count. Confirmed facts are saved to your
  account's managed profile for later postings. There is no auto-apply.
- **DOCX under the hood** — `/api/cv/edit` replaces anchored text while
  preserving the original run formatting (font, size, weight), then re-renders.
  `/api/cv/classify` extracts contact, summary, roles, bullets, education and
  skills with an anchor back to every editable field. The default read is
  structural: rules parse the DOCX blocks and Clef-flash labels only the
  ambiguous ones, so it takes about a second and generates no text. `?mode=deep`
  is a manual Gemma read for unusual layouts.
- **Company research** — Browserbase searches and reads public pages, then
  extracts a profile (summary, sectors, founders, stage, funding, links,
  signals) with its JSON extraction. It never sees the CV and uses no Gemma
  tokens.

## Privacy

Your CV and applications are stored in your account (MongoDB). Caddie sends the
posting text to Cloudflare Workers AI for classification and the CV/JD/stories
to Gemma when you use the assistant. Company research sends only the company
name, role fields and a one-line summary to Browserbase, never the CV. Matching
stays in the browser.

Built with Vite, React, Tailwind CSS v4, shadcn/ui, Better Auth, Bun/Hono,
MongoDB and Cloudflare Workers AI. Design and engineering conventions are in
[AGENTS.md](AGENTS.md).
