# Deploying Caddie

Caddie is one Bun/Hono process serving the built React app and the API, plus a
separate Telegram bot process. MongoDB, Cloudflare R2, Workers AI, Browserbase
and each user's Resend account are external services.

## Before the first deploy

1. **Public HTTPS origin.** Point a domain at the host and set
   `BETTER_AUTH_URL=https://your-domain`. Auth cookies, Telegram connect links
   and signed CV preview links all use this origin.
2. **Google OAuth.** Add
   `https://your-domain/api/auth/callback/google` as an authorized redirect URI.
   Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the environment.
3. **MongoDB.** Use Atlas or another reachable deployment. Allow the host's
   egress IP. The app creates its indexes on first connection.
4. **Cloudflare R2.** Create a private bucket and an R2 API token with Object
   Read & Write. Set the four `R2_*` values. Run `npm run migrate:r2` once if any
   existing CVs are still in GridFS.
5. **Cloudflare Workers AI.** Set `CF_ACCOUNT_ID` and `CF_API_KEY`.
6. **Browserbase.** Set `BROWSERBASE_API_KEY` for company research and website
   reading. `GITHUB_TOKEN` is optional but raises the public GitHub rate limit.
7. **Stable secrets.** Generate `BETTER_AUTH_SECRET` and
   `APP_ENCRYPTION_KEY` with `openssl rand -base64 32`. Keep both stable:
   changing the first invalidates sessions and signed links, and changing the
   second makes saved Resend keys unreadable.
8. **Telegram.** Create a bot with `@BotFather`, set `TELEGRAM_BOT_TOKEN`, and
   set `TELEGRAM_BOT_USERNAME` (without `@`). Keep `BETTER_AUTH_URL` public so
   the Profile button and `/start` sign-in links work from a phone.
9. **Resend.** Each user adds their own key and verified domain in Profile.
   There is no server-wide Resend key.

## Environment

Use the variables in `.env.example`. In production, set at least:

```bash
NODE_ENV=production
PORT=8787
BETTER_AUTH_URL=https://your-domain
BETTER_AUTH_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MONGODB_URI=...
MONGODB_DB=caddie
APP_ENCRYPTION_KEY=...
CF_ACCOUNT_ID=...
CF_API_KEY=...
BROWSERBASE_API_KEY=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
TELEGRAM_BOT_TOKEN=...
```

`GITHUB_TOKEN` and `R2_ENDPOINT` are optional. Never expose these through a
`VITE_` prefix.

## Without Docker

The host needs Bun, LibreOffice Writer, poppler, and the Carlito/Caladea/
Liberation fonts.

```bash
npm ci
npm run build
NODE_ENV=production npm run start   # web + API on :8787
npm run start:bot                  # separate process, long polling
```

Keep both processes alive with the host's process manager. The web process can
be scaled; run **exactly one** bot process because Telegram long polling does not
support multiple consumers safely.

## With Docker Compose

Create `.env` from `.env.example`, then:

```bash
docker compose up -d --build
docker compose logs -f web bot
```

The image includes LibreOffice and poppler. `web` listens on port 8787; put TLS
and the public domain in front of it. `bot` has no inbound port and only needs
outbound access to Telegram, MongoDB, R2, Cloudflare and Browserbase.

The image also serves `dist/` directly. There is no separate static host and no
CORS configuration.

## Render

Import the repository as a Blueprint. `render.yaml` creates two services from
the same Docker image:

- `caddie` — public web service with `/api/health` as its health check.
- `caddie-telegram` — background worker running `bun server/telegram/index.ts`.

Set the shared environment group from the dashboard. `BETTER_AUTH_URL` must be
the final public URL, including `https://`; set it after Render assigns the
service URL (or after attaching a custom domain) and redeploy. Google's
authorized redirect URI must use the same host.

The web service needs the standard instance plan because LibreOffice is memory
hungry. Background workers are a paid Render resource. Run exactly one
`caddie-telegram` instance; do not enable scaling on the worker.

Render injects `PORT`; the server binds to it on `0.0.0.0`. Telegram uses long
polling, so the worker needs no public port or webhook.

## Reverse proxy

Use a proxy that forwards the public origin to `127.0.0.1:8787` and allows large
enough uploads and long model calls. For nginx:

```nginx
client_max_body_size 25m;
proxy_read_timeout 180s;
proxy_send_timeout 180s;
proxy_pass http://127.0.0.1:8787;
```

Twenty megabytes is the CV hard limit; leave headroom for multipart overhead.
Classification and cover-letter generation can take tens of seconds.

## Persistence and operations

- Mongo stores accounts, applications, experiences, sending settings, Telegram
  links and conversation state.
- R2 stores base CVs and application CV snapshots. Back up the bucket.
- `.cache/` holds classification, company identity and research caches. In
  Compose it is mounted as a named volume. It is optional and can be discarded.
- There is no job queue. A bot restart during a run loses the in-flight progress;
  the application remains in the account and can be opened again.
- One bot process only. Multiple web processes are fine.
- LibreOffice renders need CPU and memory; do not run the web container on a
  128 MB instance.

## Post-deploy checks

1. `GET /api/health` returns `ok`, `accounts.configured: true` and
   `storage.configured: true`.
2. Google sign-in returns to the public origin.
3. A DOCX upload renders and can be downloaded from the application.
4. Telegram `/start` links the chat; Profile shows **Connected**.
5. Send a CV document to the bot, then a test posting with your own email as the
   recipient. Use review mode first; confirm only the test message is sent.
6. Only after that, test `/auto on` with a safe test recipient.

## Not included

- Job-board or ATS form submission. Applications are email-only.
- MCP.
- A queue or worker for long-running jobs.
- Managed MongoDB, R2, domain, TLS or uptime monitoring.
