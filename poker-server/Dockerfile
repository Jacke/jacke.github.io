# ─── Multi-stage build for the iamjacke poker server ─────────────────────
#
# IMPORTANT: the build context MUST be the REPO ROOT
# (`/Users/stan/Dev/_PROJ/iamjacke.com`), not `poker-server/`. This is so
# the build can COPY from BOTH `poker-server/` AND `poker-src/src/protocol`
# — the client's crypto/messages modules are shared via a tsconfig path
# alias, so the server needs those files present at compile time.
#
# `docker-compose.yml` sets `build.context: ..` + `build.dockerfile:
# poker-server/Dockerfile` so `docker compose up` Just Works from inside
# poker-server/.
#
# ──────────────────────────────────────────────────────────────────────────

# ─── Stage 1: build ───
FROM node:20-alpine AS builder

# Mirror the repo layout so tsc computes the same common ancestor as
# local dev (repo root), yielding the same `dist/poker-server/src/...`
# layout the runtime stage's CMD expects.
WORKDIR /build/poker-server

# Native build prerequisites for better-sqlite3.
RUN apk add --no-cache python3 make g++

# Server deps — cached layer unless package.json changes.
COPY poker-server/package.json poker-server/package-lock.json* ./
RUN npm install --no-audit --no-fund

# Server sources.
COPY poker-server/tsconfig.json ./
COPY poker-server/src ./src
COPY poker-server/test ./test
COPY poker-server/migrations ./migrations

# Shared protocol module from the client repo — the tsconfig reaches it
# via the relative path `../poker-src/src/protocol`, which in the builder
# image resolves to `/build/poker-src/src/protocol`.
COPY poker-src/src/protocol /build/poker-src/src/protocol

# tsc + tsc-alias → dist/poker-server/src/index.js (+ the protocol files
# at dist/poker-src/src/protocol/*). tsc-alias rewrites the `@protocol/*`
# path alias to a relative import so the compiled JS is runnable without
# a loader.
RUN npm run build

# ─── Stage 2: runtime ───
FROM node:20-alpine AS runtime

WORKDIR /app

# Dedicated non-root user for least-privilege.
RUN addgroup -S iamjacke && adduser -S iamjacke -G iamjacke

# Native build tools for the production dep rebuild, then removed.
RUN apk add --no-cache python3 make g++

COPY poker-server/package.json poker-server/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && apk del python3 make g++

COPY --from=builder /build/poker-server/dist ./dist
COPY --from=builder /build/poker-server/migrations ./migrations

RUN mkdir -p /app/data && chown -R iamjacke:iamjacke /app

USER iamjacke

EXPOSE 3001

CMD ["node", "dist/poker-server/src/index.js"]
