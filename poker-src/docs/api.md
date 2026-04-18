# Engine API reference

All paths below are relative to `poker-src/src/`.

## Overview

The engine is a pure state machine. You construct a `GameState`, call
`dealHand()` with a shuffled deck, and then drive the hand forward with
`applyAction()` for each player decision. Between betting rounds you call
`nextStreet()`. The engine emits an array of `EngineEvent`s from each call so
UI / logging layers can react without polling the state.

Nothing in `core/` touches the DOM, `window`, `fetch`, or `localStorage`.
Everything is synchronous. Everything is deterministic given the same deck
and action sequence.

---

## core/engine.ts

### `createGameState(numPlayers, myIndex, names?, startingStack?, config?) → GameState`

Seat `numPlayers` players with `startingStack` chips each (default 1000),
assign `myIndex` as the local player (for UIs), pick a game variant via
`config`.

```ts
import { createGameState } from './core/engine.js';

const state = createGameState(6, 0, ['You', 'Bot1', 'Bot2', 'Bot3', 'Bot4', 'Bot5']);
```

### `dealHand(state, deck) → EngineEvent[]`

Start a new hand. `deck` must be a shuffled array matching the variant's deck
size (52 for NLHE / Omaha / Pineapple / etc., 36 for Short Deck).

Posts antes (if `state.blinds.ante > 0`), posts blinds, deals hole cards, and
sets `state.actingPlayer` to whoever acts first preflop.

Events emitted: `hand-start`, `hole-cards`, `blinds-posted`, `phase`.

### `applyAction(state, player, action) → { events, roundClosed, handEnded }`

Apply one player action. `action` is one of:

```ts
type Action =
  | { kind: 'fold' }
  | { kind: 'check' }
  | { kind: 'call' }
  | { kind: 'raise'; amount: number }          // total bet, not delta
  | { kind: 'discard'; discardIndices: number[] }  // Pineapple / Irish
```

Throws on illegal actions (wrong player, not enough chips, etc.). Use
`legalActions(state)` to query the current allowed set.

Returns `handEnded: true` when either a fold-wins happens or a showdown
runout is complete. `roundClosed: true` means the street's betting is done
and the caller should call `nextStreet()` (unless the hand ended).

### `nextStreet(state) → EngineEvent[]`

Advance from one street to the next: flop → turn → river → showdown. Emits
`community`, `phase`, and potentially `discard` for variants that have
intermediate discards.

### `finishToShowdown(state) → EngineEvent[]`

Used when remaining players are all-in and no more betting can occur — deals
out all remaining community cards and awards pots.

---

## core/hands.ts

### `bestHand(cards, variant?) → HandRank`

The public hand-ranking API. Handles 5, 6, or 7 cards. Returns:

```ts
interface HandRank {
  score: number;           // packed: category * 15^5 + tiebreakers (higher = better)
  cards: Card[];           // the chosen 5-card subset
  name: string;            // "Ace-high flush" / "Full House, Kings full of 3s"
  category: HandCategory;
}

type HandCategory =
  | 'high-card' | 'pair' | 'two-pair' | 'three-of-a-kind' | 'straight'
  | 'flush' | 'full-house' | 'four-of-a-kind' | 'straight-flush';
```

Routes 6–7 card holdem inputs through the fast `evaluateCore()` path.

### `bestHandFast(cards) → { score, category, cardsEnc }`

Direct access to the fast evaluator. `cardsEnc` is the subset as encoded
ints; decode with `decodeCardInt()` from `core/eval/fast.ts` if you need
strings.

Benchmark: ~3M hands/sec single-thread on M1.

---

## core/equity.ts

### `equityMonte(hero, board?, opts) → EquityResult`

Monte-Carlo equity via partial Fisher-Yates shuffles. `hero` is a 2-card tuple,
`board` is 0–5 community cards.

```ts
const result = equityMonte(['As', 'Kh'], ['Qd', 'Jc', 'Th'], {
  samples: 10_000,
  villains: 1,
  rng: Math.random,
});
// → { equity: 0.9950, win: 0.9900, tie: 0.0100, loss: 0, iterations: 10000 }
```

### `equityEnum(hero, board?, opts) → EquityResult`

Exact enumeration over remaining-deck combinations. Only feasible when the
remaining runout fits in the combo budget — throws preflop (1.7M combos) but
runs instantly on flop (990 combos) and turn (44 combos).

### `equity(hero, board?, opts) → EquityResult`

Smart dispatcher: uses enumeration when feasible, falls back to Monte Carlo.

---

## core/tournament.ts

### `createTournament(structure) → TournamentState`

```ts
import { createTournament, TURBO_STRUCTURE } from './core/tournament.js';
const t = createTournament(TURBO_STRUCTURE);
```

### `currentBlinds(t) → BlindLevel`

Returns `{ level, sb, bb, ante, handsPerLevel }`. Push these into
`state.blinds` before calling `dealHand()` in tournament mode.

### `onHandComplete(t) → BlindLevel`

Advances the hand counter and bumps the level if the threshold is hit.
Returns the blind level now in effect (post-advance).

### `icmEquity(stacks, payouts) → number[]`

Malmuth–Harville equity calculation. `payouts` is the prize-pool ladder
(high to low). Seats with `stacks[i] === 0` are treated as eliminated.

```ts
icmEquity([5000, 3000, 2000], [50, 30, 20])
// → [~42, ~30, ~28]  (sums to 100)
```

### `defaultPayouts(prizePool, numPaid) → number[]`

Standard flat payout tables for 1–6 paid positions. Drift-corrected so
the total exactly equals `prizePool`.

---

## core/cards.ts

- `makeDeck(variant?) → Card[]` — 52 or 36 cards depending on variant
- `shuffle(deck, rng) → Card[]` — Fisher-Yates, seeded RNG
- `mulberry32(seed) → Rng` — standard deterministic RNG

---

## bot/bot.ts

### `decideAction(state, difficulty, options?) → Action`

```ts
import { decideAction } from './bot/bot.js';
const action = decideAction(state, 'hard');
```

`difficulty` is `'easy' | 'medium' | 'hard' | 'grandmaster'`. See
[`docs/bot.md`](bot.md) for strategy notes.

### `monteCarloEquity(state, samples?) → number`

Legacy API — equity for the acting player against remaining opponents on
the current board. Returns a 0–100 scale percentage. New code should prefer
`equity*` from `core/equity.ts`.

### `thinkDelayMs(difficulty, rng?) → number`

Per-difficulty "thinking time" for UX pacing.

---

## history/hhf.ts

### `handToHHF(match, hand, handId) → string`

Emit one hand in PokerStars HHF format.

### `matchToHHF(match) → string`

Concatenate every hand in a match into a single HHF text.

### `downloadHHF(text, hint) → void`

Trigger a browser download of an HHF text blob.

---

## protocol/crypto.ts

### `new SigningSession() → SigningSession`

Generates an ephemeral Ed25519 keypair. Configure once per transport instance.

### `session.wrap(msg) → SignedEnvelope`

Increment send seq, sign the canonicalized envelope, return it. Send the
envelope over the wire instead of the raw message.

### `session.verifyAndUnwrap(envelope) → Message`

Verify signature against the envelope's embedded public key, check the
pubkey hasn't changed mid-session (TOFU), check seq strictly greater than
the last received, and return the payload. Throws on any failure.

Transports in `transports/broadcast.ts` and `transports/peerjs.ts` already
wire this up — signing is transparent to the caller.

---

## Events emitted by the engine

```ts
type EngineEvent =
  | { kind: 'hand-start'; handNum: number; button: number }
  | { kind: 'hole-cards'; cards: (readonly Card[] | null)[] }
  | { kind: 'blinds-posted'; sb: { player, amount }; bb: { player, amount } }
  | { kind: 'phase'; phase: Phase }
  | { kind: 'community'; phase: 'flop' | 'turn' | 'river'; cards: Card[] }
  | { kind: 'action'; player: number; action: Action; effective: number; allIn: boolean }
  | { kind: 'discard'; player: number; discardedIndices: number[] }
  | { kind: 'award'; pots: Array<{ amount, winners, reason }> };
```
