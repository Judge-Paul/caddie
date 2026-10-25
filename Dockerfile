# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM oven/bun:1.3.14

ENV NODE_ENV=production \
    PORT=8787 \
    HOME=/home/bun \
    SOFFICE_BIN=soffice

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-crosextra-caladea \
    fonts-crosextra-carlito \
    fonts-liberation2 \
    libreoffice-writer \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build --chown=bun:bun /app/package.json /app/package-lock.json ./
COPY --from=build --chown=bun:bun /app/tsconfig.json /app/tsconfig.server.json ./
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/server ./server
COPY --from=build --chown=bun:bun /app/shared ./shared
COPY --from=build --chown=bun:bun /app/src/lib ./src/lib

RUN mkdir -p /app/.cache && chown -R bun:bun /app

USER bun

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || '8787') + '/api/health').then((r) => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["bun", "server/index.ts"]
