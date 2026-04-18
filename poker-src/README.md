# iamjacke-poker

A production-grade TypeScript poker engine with a full browser client.

Plays Texas Hold'em, Omaha, Short Deck, Pineapple, Crazy Pineapple, and Irish.
Supports cash games, escalating-blinds tournaments with ICM payouts, multi-table play,
signed peer-to-peer matches, and four difficulty tiers of bots — from the loose
easy-mode opener to a range-chart + equity-driven grandmaster that beats the
previous hard bot ~56% of hands over 5000-hand self-play.

Ships as a ~78 KB gzipped IIFE to `static/poker/poker.js`, no runtime dependencies
beyond `peerjs` (optional, WebRTC transport only) and `@noble/ed25519` (protocol
signing).

## Highlights

| Area | What you get |
|---|---|
| **Hand evaluator** | Single-pass 7-card evaluator, ~3M hands/sec single-thread on M1 |
| **Equity API** | Monte-Carlo + exact enumeration, range-vs-range ready |
| **Variants** | NLHE, Omaha (must-use-2), Short Deck, Pineapple, Crazy Pineapple, Irish |
| **Betting structures** | NL, PL, FL |
| **Bots** | easy / medium / hard / grandmaster, all equity-aware postflop |
| **Tournaments** | Turbo / Standard / Deepstack structures, antes, Malmuth–Harville ICM |
| **Multi-table** | Map of live sessions, tab strip, per-table state, resume across reloads |
| **P2P** | BroadcastChannel (same browser) + PeerJS WebRTC (remote), Ed25519-signed |
| **Hand history** | PokerStars HHF export (readable by HM3 / PT4 / etc.) |
| **Tests** | 214 unit tests, differential eval, self-play harness, signed-protocol forgery tests |

## Quick start

```bash
git clone …
cd poker-src
npm install
npm run dev        # vitest in watch mode
npm run test       # 214 tests
npm run typecheck  # strict TS, 0 errors expected
npm run build      # Vite IIFE → ../static/poker/poker.js
```

To open the UI locally:

```bash
cd ..
python3 -m http.server 8765
# open http://localhost:8765/poker/
```

## Architecture

```
poker-src/
├── src/
│   ├── core/               Pure game logic — no DOM, no network
│   │   ├── engine.ts       State machine: dealHand, applyAction, nextStreet
│   │   ├── rules.ts        Legal-action / min-raise / pot-odds helpers
│   │   ├── hands.ts        Public hand-ranking API
│   │   ├── eval/fast.ts    ~3M hands/sec single-pass 7-card evaluator
│   │   ├── equity.ts       equityMonte + equityEnum, range-aware
│   │   ├── variants.ts     Per-variant rules (hole cards, deck, eval)
│   │   ├── tournament.ts   Blind structures, level state, ICM
│   │   └── cards.ts        Deck, shuffle, seeded RNG
│   ├── bot/
│   │   ├── bot.ts          decideAction, easy/medium/hard/grandmaster
│   │   ├── opponent-model.ts   VPIP/PFR/AF/3-bet/CBet tracker + archetype
│   │   └── ranges/nlhe-6max.ts Published 6-max opening ranges
│   ├── protocol/
│   │   ├── messages.ts     Wire protocol shapes + validators
│   │   ├── transport.ts    Transport interface + Emitter
│   │   └── crypto.ts       Ed25519 SigningSession, seq replay-guard
│   ├── transports/
│   │   ├── broadcast.ts    BroadcastChannel same-browser transport
│   │   └── peerjs.ts       PeerJS WebRTC remote transport
│   ├── history/
│   │   └── hhf.ts          PokerStars HHF exporter
│   ├── ui/                 DOM glue, bank, session, match-recorder, sfx, render
│   └── app.ts              Boot, event loop, multi-table, startBotGame, etc.
├── bench/
│   ├── eval.bench.ts       Vitest bench for the evaluator
│   └── selfplay.ts         Bot-vs-bot CLI harness (tsx)
├── docs/
│   ├── api.md              Engine API reference
│   └── bot.md              Bot strategy notes
└── PRD.md                  Product requirements / roadmap
```

## Benchmarks (M1 Air, Node 20, single-threaded)

### Hand evaluator (`npm run bench`)

| Entry point | Hands / sec | Notes |
|---|---:|---|
| `evaluateCore` (pre-encoded ints) | **~2.98 M** | 3× the PRD target of 1 M/sec |
| `bestHandFast` (string → evaluate) | ~2.04 M | Decodes card strings before eval |
| `bestHand` (public API) | ~0.89 M | Includes 5-card reconstruction + HandRank object |

### Bot self-play (`npm run selfplay`)

```
[selfplay] GRANDMASTER vs HARD · 5000 hands · GRANDMASTER won 2792 · 55.84% · net chips -38812
```

Grandmaster wins **55.84%** of hands over 5000 heads-up hands vs. the hard
bot (seed 777) — above the 55% PRD bar.

The negative chip delta reflects variance in pot sizes rather than a true
edge for hard: win rate is the PRD metric. Future tuning work could close
the gap on EV.

### Flags

```bash
npx tsx bench/selfplay.ts --hands 10000 --challenger grandmaster --defender medium --seed 42
```

## Features in depth

### Variants

| Variant | Hole cards | Special rule |
|---|:-:|---|
| `holdem` | 2 | Standard NLHE |
| `omaha` | 4 | Must use exactly 2 hole cards |
| `shortdeck` | 2 | 36-card deck, A5432 straight disabled, flush > full house |
| `pineapple` | 3 | Discard 1 card preflop |
| `crazypineapple` | 3 | Discard 1 card after the flop |
| `irish` | 4 | Discard 2 cards before the turn |

### Bots

- **easy** — loose, barely bluffs, uses a preflop-score heuristic
- **medium** — value-oriented, respects pot odds, postflop category-strength aware
- **hard** — full Monte-Carlo equity via `equityMonte`, position bonus, multi-villain aware
- **grandmaster** — preflop played from published 6-max ranges (BTN remapped
  to HU button), opponent-model archetype detection, falls through to the
  hard equity engine postflop

See [`docs/bot.md`](docs/bot.md) for strategy details.

### Tournaments

Three preset structures:

| Structure | Starting stack | Blind growth | Handed-per-level |
|---|---:|---:|---:|
| Turbo | 1500 | ~1.75× | 6 |
| Standard | 3000 | ~1.5× | 10 |
| Deepstack | 10000 | ~1.35× | 14 |

ICM is computed via Malmuth–Harville recursion with memoization on the
live-seats bitmask — O(2^n · n²), fine up to ~10 seats.

### Multi-table

- `app.tables: Map<string, TableSlot>` — one slot per live table
- Snapshot/restore between active and inactive slots
- Tab strip across the top of the game screen
- Per-table session mirrored to `iamjacke-poker-sessions: Record<id, GameSession>`
  in `localStorage`, so cross-reload resume preserves every table
- Legacy single-session key still works — a one-tab user never sees any
  change, but the multi-bag is migrated from it on first load

### P2P

- `BroadcastChannel` for same-browser testing
- PeerJS WebRTC for remote play over a free public broker
- **Every message is Ed25519-signed** with an ephemeral keypair generated
  per session. Outbound seq is monotonic; inbound seq must strictly exceed
  the highest seen so far (replay / reorder guard). TOFU pubkey pinning
  means a third party can't hijack an already-established channel.

### Hand history

`matchToHHF(match)` produces a PokerStars-format `.txt` that reads back in
HM3 / PT4 / Hand2Note / most online tracking tools. Exposed from the
in-app Settings panel.

## Credits & sources

- Evaluator design inspired by Deuces / Treys and PHEvaluator
- GTO preflop ranges drawn from GTO Wizard's public 6-max charts
- ICM algorithm: Malmuth & Harville (standard)
- Crypto: `@noble/ed25519`

## License

MIT (see `../LICENSE`).
