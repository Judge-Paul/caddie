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
- Path alias `@/*` → `src/*`. Note the shadcn convention here: components import
  `cn` from the `cn` package, not from `@/lib/utils`.

```bash
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
npm run lint     # oxlint
```

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
| `success` | `#0f7b52` | positive results, use sparingly |

Blue is the product colour: use it for the primary path through the UI. The
`mark` family means one thing — a requirement your CV does not cover. Do not
reuse red for decoration, and do not use blue to mean "missing". Neutral
surfaces are white cards on the canvas with a `border-border` hairline; shadows
are for the paper and the JD card only.

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
- The CV is read-only for now. Do not add editing affordances to the paper.

## How matching works

`src/lib/analyze.ts` is deterministic and runs on the client — no API calls, no
LLM. It:

1. tokenises the JD and builds canonical keys (lowercase, light stemming,
   a synonym map for tech spelling variants)
2. detects requirement spans using `src/lib/skills.ts`: lexicon words, lexicon
   phrases, and tech-shaped tokens (internal capitals like `GraphQL`, or digits
   like `D3`)
3. marks a span covered when its content words appear anywhere in the CV
4. returns rendering pieces, `coverage`, and the sorted `gaps`

Prose that is not in the lexicon is never highlighted — that is what keeps the
red readable. **Add vocabulary to `src/lib/skills.ts`, not conditionals to the
matcher.** Keep results explainable and instant; no network round trip for
analysis.

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

Built: brand + tokens, one-page CV preview, JD paste/review with red coverage
marks, coverage ring/bar, gap chips.

Not built yet: uploading or editing a real CV, persistence, job library, PDF
export, per-line/section analysis, any backend. Don't imply these exist in copy
until they do.
