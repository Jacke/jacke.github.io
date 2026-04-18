# iamjacke-poker-server

Node.js WebSocket backend for the iamjacke poker/blackjack client.

Matchmaking, signed-envelope relay, chat + hand persistence in SQLite, REST
history endpoints, optional email magic-link profile linking. Runs as a
Docker container; uses the same Ed25519 signing keys as the client's P2P
protocol so every wire message is end-to-end verifiable.

## Quick start (local dev)

```bash
cd poker-server
cp .env.example .env
npm install
npm run dev           # tsx watch src/index.ts, port 3001 by default
```

Run the client against local dev server:

```js
// In the browser console on http://localhost:8765/poker/
localStorage.setItem('iamjacke-server-url', 'ws://localhost:3001/ws');
location.reload();
```

## Docker

```bash
cd poker-server
cp .env.example .env
docker compose up --build
# Server is at http://localhost:3001 (health check) and ws://localhost:3001/ws
```

The build context is the parent directory (`..`) so the Dockerfile can
reach both `poker-server/` and `poker-src/src/protocol` — the client's
crypto and wire-message modules are shared with the server via a
`tsconfig` path alias, not duplicated.

## Architecture

```
Browser (poker.js)
   ├─ WebSocketTransport    → wss://iamjacke.com/ws
   ├─ PeerJSTransport       (fallback / private rooms)
   └─ BroadcastChannel      (same-browser dev)

Node.js + ws server
   ├─ /ws              signed envelope protocol + matchmaking control plane
   ├─ /api/...         REST history, stats, email magic-link
   ├─ Matchmaker       FIFO queue per (game_kind, seat_count)
   ├─ Rooms registry   in-memory Map<roomId, Room> with member sockets
   └─ SQLite (WAL)     users, rooms, hands, chat_messages, ...
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | `tsx watch src/index.ts` — hot-reload |
| `npm run build` | `tsc` — produces `dist/` |
| `npm run start` | `node dist/index.js` — production entry |
| `npm test` | Vitest — unit + integration |
| `npm run typecheck` | `tsc --noEmit` |

## Environment

See `.env.example`. Notable knobs:

- `PORT` — HTTP + WS bind port. Docker maps this to the host.
- `DB_PATH` — SQLite file. Default inside container: `/app/data/poker.db`.
- `ORIGIN_ALLOWED` — comma-separated list of allowed WebSocket origins.
- `ROOM_GRACE_MS` — how long a dropped player keeps their seat (5 min default).
- `AUTH_NONCE_TTL_MS` — how long an auth challenge is valid (30 s default).
- `SMTP_*` — optional magic-link email SMTP. Leave empty for dev (codes log to stdout).

## Data model

| Table | Purpose |
|---|---|
| `users` | One row per Ed25519 pubkey. Display name, lifetime P/L. |
| `rooms` | Game sessions. Game kind, seat count, created/closed. |
| `room_members` | Which pubkeys sit in which room, with join/leave times. |
| `chat_messages` | Append-only chat log per room. |
| `hands` | Append-only game-action log per room (for replay). |
| `matchmaking_queue` | Ephemeral queue mirror — reflects live in-memory state. |
| `email_links` | Optional: pubkey ↔ email binding after magic-link verification. |
| `email_challenges` | Outstanding 6-digit codes sent by SMTP. |

## Deployment

See `deploy/` for production compose overrides.
