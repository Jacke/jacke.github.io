# PRD: iamjacke Poker Engine v2 — "World-Class"

Status: Draft · Owner: Stan · Target: single-developer incremental rollout

## 1. Context

Over the last several sessions we took `static/poker/index.html` from a single-file toy into a properly tested TypeScript codebase at `poker-src/`. It now supports:

- Multi-player Texas Hold'em (2–6 seats), correct side pots, fold-to-one, button rotation
- 3 heuristic bot tiers (easy/medium/hard) — hard uses 350-iter Monte-Carlo equity on flop+
- P2P transport (BroadcastChannel + PeerJS WebRTC) for human-vs-human
- Persistent bank, session resume, match history, lifetime stats, sparkline
- Polished UI: chip SVGs, flying-chip animations, side-panel rules, filters, log controls
- 104 green unit tests, strict TS, 168 KB gzipped bundle

**What prompted this PRD:** Stan wants to move from "nice toy" to "top-tier open-source poker engine." That means competing — or at least being benchmarkable against — the best that exists in the open. This document is the product spec for that leap.

**Outcome target:** a poker engine Stan can point to and say "this is the best open-source TypeScript poker engine, bar none." Correctness, speed, AI quality, and usability are all lever-able.

---

## 2. Competitive landscape (top OSS poker engines, audited)

Five projects dominate the space. Each has something worth stealing.

| Rank | Project | Language | Strength | Weakness |
|---|---|---|---|---|
| 1 | **[PokerKit](https://github.com/uoftcprg/pokerkit)** (U of Toronto CPRG, peer-reviewed) | Python | Most comprehensive: supports ~16 poker variants (NLHE, PLO, Stud, Short Deck, Badugi), full game state machine, [academic paper](https://arxiv.org/abs/2308.07327), clean high-level API | Python speed; naive evaluator for the default API |
| 2 | **[PHEvaluator](https://github.com/HenryRLee/PokerHandEvaluator)** (HenryRLee) | C++/Python | Perfect-hash 7-card evaluator, ~100 KB lookup table, hundreds of nanoseconds per eval, Omaha support | Evaluator only — no engine, no bot |
| 3 | **[Deuces / Treys](https://github.com/ihendley/treys)** (worldveil → ihendley) | Python | Prime-number perfect-hash, standard reference implementation for fast hand eval, used by many downstream libs | Python-only, 5-card primary (7-card via enumeration) |
| 4 | **[OpenSpiel](https://github.com/google-deepmind/open_spiel)** (DeepMind) | C++/Python | Research-grade RL framework, includes CFR/DQN baselines and Leduc/Kuhn poker, clean env API for training | Simplified poker variants only; not a production engine |
| 5 | **[RLCard](https://github.com/datamllab/rlcard)** (DATA Lab) | Python/TF | NLHE + 10 other card games, ready-made RL training loop, multi-agent | No GTO; Python |

Honorable mentions:
- **[Pluribus](https://github.com/keithlee96/pluribus-poker-AI)** (open recreations) — 6-max CFR super-human bot
- **[Slumbot](https://www.slumbot.com/)** — HUNL approximate Nash via CFR, champion of ACPC 2018
- **[PokerTH](https://en.wikipedia.org/wiki/PokerTH)** — C++/Qt full desktop client, 10 seats, Robert's Rules
- **[poker-holdem-engine](https://github.com/brunoscopelliti/poker-holdem-engine)** (brunoscopelliti) — JS HTTP-based engine
- **[eval7](https://pypi.org/project/eval7/)** — Python/C fast eval + equity enumeration

**What we steal:**
- **Eval:** Perfect-hash lookup table (Deuces / PHEvaluator approach). Replaces our ~500 µs naive combinatorial with ~100–500 ns. **~1000× speed-up** unlocks Monte-Carlo equity at 100k samples per call instead of 350.
- **Variant scaffold:** PokerKit's idea that a single engine should parameterize over variants (NLHE, PLO, stud streets) rather than hardcode hold'em.
- **CFR / regret-matching baseline:** OpenSpiel's pattern of training-time algorithms with a clean `State` API. Even a tiny preflop CFR model would be a game-changer for our bot.
- **Hand history format:** standard [HHF (PokerStars-compatible)](https://poker.gg/hhf/) text format so our hands are replayable in external tools.
- **Engine-as-library API:** PokerKit's "you construct a `State`, call `state.deal()`, `state.bet(amount)`, etc." — cleaner than our current event-sourcing for external consumers.

---

## 3. Current gaps (what we're missing vs. "world-class")

Audit summary (full inventory in working notes, condensed here):

| Area | Status | Gap |
|---|---|---|
| Hand evaluator | Correct but naive (C(7,5) combo enumeration, ~500 µs/eval) | 1000× slower than Deuces; blocks mass Monte-Carlo |
| Equity API | Bot-only, ad-hoc Monte-Carlo | No public `equity(hero, villain?, board)` call for UI/tests |
| Variants | NLHE only | No PLO, no Stud, no Short Deck, no Chinese OFC |
| Bot | Rules + 350-sample MC | No opponent modeling, no ranges, no GTO, no bluff frequency, no texture reading |
| Tournaments | Cash only | No blind escalation, no rebuy, no ICM, no sit-n-go structure |
| Hand history | Proprietary internal format only | No PokerStars HHF export → no external tool interop |
| Security | None | Any peer can forge actions; deck is sent in clear |
| Anti-cheat | None | Trusted peers assumed |
| Persistence | localStorage single-device | No cloud sync, no cross-device resume |
| Testing | Unit only | No perf benchmarks, no property tests, no differential testing against Deuces |
| Multi-table | Single table | No sit-n-go, no multi-table tournaments |
| Analytics | Sparkline + lifetime stats | No EV, variance, std deviation, win rate per position, VPIP/PFR |

---

## 4. Vision

**"The best open-source TypeScript poker engine"** = a library developers can `npm install` and get:

1. **Correctness** — bit-exact with Deuces on all 133,784,560 possible 7-card hands (differential test).
2. **Speed** — <1 µs per 7-card eval, >1M evals/sec single-threaded.
3. **Flexibility** — one engine API, multiple variants (NLHE, PLO, Short Deck at minimum).
4. **Strong AI** — a bot that measurably beats GTO Wizard's "Easy" and "Medium" levels heads-up.
5. **Interoperability** — emits PokerStars HHF hand histories; parses them back.
6. **Safety** — signed protocol messages for P2P play; can't forge an opponent's fold.
7. **Observability** — built-in hand replay, EV graphs, per-hand annotations.
8. **Zero-deps runtime** — still ships as one file, still works in browser without a build step on the consumer's side.

---

## 5. Requirements

### P0 — Must ship to be credible (6–8 weeks of focused work)

**P0.1 · Perfect-hash hand evaluator**
- Port Deuces' prime-number hashing to TypeScript, or implement PHEvaluator's approach (smaller, faster).
- Lookup tables generated at build time, bundled as `Uint32Array` / `Int32Array`, tree-shakeable.
- Target: <1 µs/7-card eval on M1 (Chrome), >1M evals/sec sustained.
- Public API: `evaluate7(c1, c2, c3, c4, c5, c6, c7): number` returning packed rank (lower = better, matches Deuces convention).
- **Differential test:** generate all 133 M 7-card hands, compare rank category output to a reference Python run (stored as test fixture).
- Replace `src/core/hands.ts:bestHand()` internals; public signature unchanged.

**P0.2 · Equity API**
- New module `src/core/equity.ts`:
  - `equityEnum(hero: [Card,Card], villain?, board?): number` — full enumeration when feasible (pre-board: ~1.7 M, flop: 990, turn: 44).
  - `equityMonte(hero, villain?, board?, samples=10000, rng?): number` — for multi-way / speed.
  - `rangeEquity(heroRange, villainRange, board?): number` — range vs range.
- Backed by the new perfect-hash evaluator — 10k samples should run in <5 ms.
- UI: bank-widget equity button shows live `X%` during human's turn.
- Unit tests: sanity values (AA vs KK preflop ~81/19, 7-high flush vs top pair known).

**P0.3 · Variant-ready engine**
- Refactor `src/core/engine.ts` to parameterize over a `Variant` interface:
  - `streetCount`, `holeCardCount`, `communityPerStreet[]`, `highLow`, `evalFn`, `maxPlayers`
- Ship `variants/nlhe.ts` (current behavior) + `variants/plo.ts` (4 hole cards, must use exactly 2) as proof.
- Existing engine tests must pass against `nlhe` variant unchanged.
- `createGameState({ variant: 'nlhe' | 'plo', ... })`.

**P0.4 · Hand history export + replay**
- Emit each completed hand as [PokerStars HHF](https://poker.gg/hhf/) text.
- New module `src/history/hhf.ts`:
  - `toHHF(hand: RecordedHand): string`
  - `fromHHF(text: string): RecordedHand`
- Round-trip test: export → parse → re-export → byte-identical.
- UI: "Export hand history" button in the match-done overlay and in Settings (downloads `.txt`).
- This unlocks interop with external tools (HM3, PT4, etc.) and legitimizes us as a real engine.

**P0.5 · Protocol signatures**
- Every message includes `{ seq, sig }`. Host generates an ephemeral keypair on match start; sends `pubkey` in first hello. All subsequent messages are signed with Ed25519 (via `@noble/ed25519` — 3 KB gzipped).
- Guest verifies. Reject unsigned or bad-sig. Out-of-order `seq` rejected.
- Mitigates drive-by forgery on the public PeerJS broker; does not solve collusion (inherently unsolvable without a trusted dealer).
- New file: `src/protocol/crypto.ts`. Integration point: `transports/{broadcast,peerjs}.ts` call `sign`/`verify` on send/receive.

---

### P1 — Strong differentiators (4–6 weeks after P0)

**P1.1 · Opponent-modeled bot ("Medium+")**
- Track per-opponent VPIP, PFR, AF (aggression factor), 3-bet %, fold-to-3-bet %, continuation bet %.
- Stored per-session in-memory; reset on new match.
- Medium bot adjusts calling ranges by position + opponent VPIP. Hard bot uses adjusted equity threshold against each opponent.
- New file: `src/bot/opponent-model.ts`. Consumed from `src/bot/bot.ts`.
- Testable: scripted opponent that always 3-bets → our bot should tighten → assertion on fold frequency.

**P1.2 · Preflop range bot ("Hard+")**
- Precomputed preflop open/3-bet/4-bet charts by position and stack depth (from publicly available [GTO Wizard free charts](https://blog.gtowizard.com/gto-wizard-ai-benchmarks/) or similar academic sources).
- Lookup chart → play GTO-mixed ranges preflop.
- Postflop continues with current equity-based logic, but weighted by the range we'd plausibly have.
- Data file: `src/bot/ranges/nlhe-6max.json`.
- Should measurably outperform current hard bot in a 10,000-hand self-play benchmark.

**P1.3 · Tournament mode**
- New module `src/core/tournament.ts`:
  - Blind structure (level, SB, BB, ante, duration)
  - Blind-level auto-advance on hand count or timer
  - Rebuy / add-on support (simple rule toggles)
  - ICM calculator for payout estimation (~50 lines, standard Malmuth–Harville)
- UI: new "Tournament" mode button on landing → pick structure (turbo, standard, deepstack) → play to heads-up → winner.
- Test: scripted tournament, verify blinds escalate and ICM payouts add up to prize pool.

**P1.4 · Multi-table support**
- Allow the app to hold N active sessions; sit on one at a time, switch via tab strip at the top.
- Each session is an independent `GameState` and session record.
- Extends current single-session-at-a-time localStorage schema to `iamjacke-poker-sessions: Record<id, GameSession>`.

---

### P2 — Nice to have (post-P1)

- **P2.1** Short-deck (6+) NLHE variant
- **P2.2** Hand replayer inside the app with scrubbable timeline (use recorded action sequences + render at each step)
- **P2.3** VPIP/PFR HUD overlay on seats during play
- **P2.4** Stats export: session CSV, graphs for win rate by position, card distribution heatmap
- **P2.5** Soundboard (chip drop, card flip, call/raise chimes)

_(Cloud sync and Stud/Badugi variants explicitly dropped — not in scope for v2.)_

---

## 6. Success criteria

**Engine:**
- [ ] All 133 M 7-card rank categories bit-match Deuces reference output
- [ ] ≥ 1M 7-card evals/sec single-thread on M1 (Chrome)
- [ ] Equity API: AA vs KK preflop = 81.0 ± 0.2% (Monte-Carlo, 10 k samples)
- [ ] Round-trip PokerStars HHF export → parse → re-export is byte-identical on 100 random hands
- [ ] Variant framework: NLHE tests pass unchanged; PLO tests pass independently

**AI:**
- [ ] Self-play benchmark: new hard bot wins ≥ 55% of 10,000 hands vs. current hard bot
- [ ] Opponent model tightens measurably when opponent 3-bets 40%+ (scripted test)
- [ ] Preflop ranges match published 6-max chart within 1% frequency

**Security:**
- [ ] Protocol rejects unsigned messages
- [ ] Bad-sig message → transport error, game state unchanged
- [ ] Out-of-order seq → rejected

**Observability:**
- [ ] Every completed match is exportable as HHF
- [ ] Replay viewer plays back any exported hand correctly

**Performance:**
- [ ] Bundle size ≤ 250 KB gzipped (we have budget: currently 50 KB → room for ~200 KB of lookup tables + crypto)
- [ ] First hand deal ≤ 100 ms from click
- [ ] No observable jank during bot decisions (<16 ms per frame during think)

**Tests:**
- [ ] ≥ 150 unit tests green (currently 104)
- [ ] Perf benchmark suite in `poker-src/bench/` with CI threshold
- [ ] Differential test against Deuces reference

---

## 7. Implementation plan (phases)

### Phase 1 · Foundation (week 1–2)
Goal: evaluator + equity — unblock everything else.

1. Write `src/core/eval/perfect-hash.ts` — TypeScript port of Deuces / PHEvaluator tables. Generate tables in a `scripts/gen-tables.ts` Node script at build time.
2. Replace `bestHand` internals; keep existing signature; existing hand tests must still pass.
3. Add `src/core/equity.ts` with enumeration + Monte-Carlo.
4. Add perf benchmark `poker-src/bench/eval.bench.ts` (vitest bench).
5. Differential test against reference output (checked-in JSON of 10k random hands → expected Deuces rank).

**Exit gate:** 1M evals/sec benchmark green. All existing tests pass.

### Phase 2 · Variant scaffold + HHF (week 3–4)
1. Introduce `Variant` interface + `variants/nlhe.ts`, `variants/plo.ts`.
2. Refactor engine to call `variant.deal()`, `variant.validAction()`, etc. Keep HU and 6-max working.
3. Implement `src/history/hhf.ts` — export and parse.
4. UI: "Export HHF" in showdown overlay + Settings.
5. Build replay viewer reusing existing match-recorder (no new format needed; HHF is the interchange).

**Exit gate:** PLO plays end-to-end with correct must-play-2 rule. Round-trip HHF test green.

### Phase 3 · Bot upgrade (week 5–6)
1. Opponent model (`src/bot/opponent-model.ts`) — in-memory counters.
2. Preflop range charts (import a published 6-max chart as JSON).
3. New bot tier `'grandmaster'` — combines ranges + opponent exploit + Monte-Carlo equity.
4. Self-play benchmark harness (`bench/selfplay.ts`): old bot vs new bot for 10k hands; report win rate.

**Exit gate:** Grandmaster wins ≥ 55% vs current hard in self-play.

### Phase 4 · Security + tournament (week 7–8)
1. Ed25519 signing via `@noble/ed25519`.
2. Sign/verify on every protocol message; seq numbers.
3. Tournament mode (`src/core/tournament.ts`) + UI flow.
4. Multi-table shell (P1.4) if time permits.

**Exit gate:** Can't forge a fold over BroadcastChannel in a manual pen-test. Turbo tournament plays to completion.

### Phase 5 · Polish, docs, npm publish (week 9–10)
1. README that positions the project: architecture, features, benchmarks, comparison table vs PokerKit/Deuces.
2. `docs/api.md` — engine API reference.
3. `docs/bot.md` — bot strategy notes.
4. Publish benchmark results page in repo.
5. Publish as `@iamjacke/poker-engine` on npm (entry points: `import { createGame, evaluate7, equity } from '@iamjacke/poker-engine'`). Semver discipline from v0.1.0 onward.

---

## 8. Critical files (referenced by path, for implementation)

- `poker-src/src/core/hands.ts` — will have internals replaced by perfect-hash evaluator
- `poker-src/src/core/engine.ts` — refactor to consume `Variant`
- `poker-src/src/core/rules.ts` — currently NLHE-specific; move variant-specific bits out
- `poker-src/src/core/types.ts` — add `Variant`, extend `GameState` to hold variant handle
- `poker-src/src/bot/bot.ts` — hard bot currently calls `monteCarloEquity`; swap for new `equity` module and add `opponent-model`
- `poker-src/src/transports/broadcast.ts`, `poker-src/src/transports/peerjs.ts` — add sign/verify hooks
- `poker-src/src/ui/match-recorder.ts` — keep as internal format; `hhf.ts` is the export layer
- `poker-src/src/ui/render.ts`, `poker-src/src/app.ts` — equity button + HHF export button wiring
- New: `poker-src/src/core/eval/perfect-hash.ts`, `poker-src/src/core/equity.ts`, `poker-src/src/core/tournament.ts`, `poker-src/src/core/variants/*.ts`, `poker-src/src/history/hhf.ts`, `poker-src/src/protocol/crypto.ts`, `poker-src/src/bot/opponent-model.ts`, `poker-src/src/bot/ranges/nlhe-6max.json`
- New dev-time: `poker-src/scripts/gen-tables.ts`, `poker-src/bench/eval.bench.ts`, `poker-src/bench/selfplay.ts`

---

## 9. Risks and tradeoffs

**R1 · Bundle bloat.** Perfect-hash tables can add 100–400 KB. Mitigations: compress (Uint16 instead of Uint32 where possible), lazy-load evaluator (dynamic import), keep tournament/crypto behind code-splits. Budget: +200 KB gzipped.

**R2 · Lookup table generation is error-prone.** A single off-by-one in table gen breaks every hand eval. Differential test against Deuces on 10k + 133M random hands is the safety net. Start with porting Deuces verbatim (known-correct), then optimize.

**R3 · "Top-tier AI" is a moving target.** We won't beat Pluribus on a laptop. Re-frame success as "plays a measurably strong NLHE game against humans and beats our current hard bot by ≥ 10% in self-play." This is achievable; beating solvers is not.

**R4 · PLO support doubles test surface.** Commit to NLHE-first correctness, then add PLO incrementally under the Variant interface. Don't block NLHE ship on PLO polish.

**R5 · Crypto UX.** Ed25519 adds 3–8 KB gzipped and introduces latency on first send. Acceptable tradeoff for integrity; mandatory for any public demo where strangers might play.

**R6 · Scope creep.** Everything in P2 is a feature someone will want. The PRD is explicit about what's in P0/P1; P2 happens only after P0/P1 ship.

---

## 10. Decisions locked in

1. **Bundle budget:** ✅ Grow to ≤250 KB gzipped. Tables + crypto inline, one file to ship.
2. **PLO in P0:** ✅ Ship with NLHE on day one. Multi-variant is a headline differentiator; +~2 weeks is worth it.
3. **Bot ambition:** ✅ "Beats our current hard bot by ≥10% in self-play" is the bar. No CFR training, no LLMs — use published GTO preflop charts + opponent modelling + better postflop logic.
4. **npm publish:** ✅ Ship as `@iamjacke/poker-engine` on npm. Forces clean API, makes project legitimately reusable, drives discoverability.
5. **Cloud sync:** ❌ Out of scope. Everything stays localStorage; if cross-device becomes critical later, that's a separate PRD.

---

## 11. Verification (how we know it's done)

```bash
cd poker-src
npm run typecheck                        # strict TS, 0 errors
npm run test                             # ≥150 unit tests green
npm run test:diff                        # differential test vs Deuces reference
npm run bench -- eval.bench              # ≥1M evals/sec
npm run bench -- selfplay.bench          # grandmaster ≥55% vs hard
npm run build                            # ≤250 KB gzipped

# Manual:
cd /tmp && python3 -m http.server 8765
# Open http://localhost:8765/poker/
# - Start bot match, play a hand
# - Click "Export HHF" → verify text file opens in HM3/PT4 / looks right
# - Check bank/stats/equity button all work
# - Start tournament mode → run to completion
# - Open two tabs, play PvP; inspect network tab → signed messages
```

---

## 12. Appendix · Sources

- [PokerKit — U of Toronto CPRG](https://github.com/uoftcprg/pokerkit)
- [PokerKit paper (arXiv)](https://arxiv.org/abs/2308.07327)
- [PHEvaluator (HenryRLee)](https://github.com/HenryRLee/PokerHandEvaluator)
- [Deuces / Treys](https://github.com/ihendley/treys)
- [OpenSpiel (DeepMind)](https://github.com/google-deepmind/open_spiel)
- [RLCard](https://github.com/datamllab/rlcard)
- [Pluribus open recreation](https://github.com/keithlee96/pluribus-poker-AI)
- [poker_ai (CFR-based)](https://github.com/fedden/poker_ai)
- [PokerTH](https://en.wikipedia.org/wiki/PokerTH)
- [poker-holdem-engine (JS)](https://github.com/brunoscopelliti/poker-holdem-engine)
- [eval7 (Python/C)](https://pypi.org/project/eval7/)
- [GTO Wizard AI benchmarks](https://blog.gtowizard.com/gto-wizard-ai-benchmarks/)
- [@noble/ed25519 (crypto)](https://github.com/paulmillr/noble-ed25519)
</content>
</invoke>