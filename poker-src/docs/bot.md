# Bot strategy notes

All bots implement the same interface:

```ts
decideAction(state, difficulty) → Action
```

Difficulty is `'easy' | 'medium' | 'hard' | 'grandmaster'`. Each tier layers
on top of the previous one — no tier is a complete rewrite.

---

## easy

**File:** `src/bot/bot.ts::decideEasy`

- Preflop: plays ~60% of hands (any pair, any ace, suited broadway, connectors)
  by consulting `preflopScore()`
- Postflop: decides from hand category — if current best hand is a pair or
  better with decent kicker, call / small raise; otherwise check-fold
- Never bluffs
- Doesn't respect pot odds

Intentionally loose-passive. The kind of opponent who calls down with
middle pair "because I put you on a bluff."

---

## medium

**File:** `src/bot/bot.ts::decideMedium`

Adds on top of easy:

- Pot-odds-respecting calls — computes `requiredEquity = toCall / (pot + toCall)`
  and folds hands whose category-strength heuristic doesn't clear it plus a
  small buffer
- Position awareness: raises wider in late position
- Value-bets on strong hands (trips+, top pair top kicker)
- Small bluff frequency (~10%) as a positional float

Plays recognizably solid but doesn't hand-read — trusts its own equity
without trying to model the opponent.

---

## hard

**File:** `src/bot/bot.ts::decideHard`

This is where the equity engine kicks in. The hard bot:

1. **Preflop** — still uses `preflopScore()` because live Monte Carlo with only
   2 hole cards vs ~1.7M runouts is too noisy to be useful
2. **Postflop** — calls `equityMonte(hero, board, { samples, villains })` from
   `src/core/equity.ts`. Sample count scales with pot size: 800 samples for
   small pots, 1500 for big ones
3. **Multi-villain aware** — passes `villains: activeOpponents` to shrink
   equity when the hand is multi-way
4. **Position bonus** — adds 0.03 to `valueEquity` when in position
5. **Thresholds** (post-position-bonus):
   - `> 0.82` facing a bet → pot-sized raise (check-raise or 3-bet)
   - `> 0.68` facing a bet → half-pot raise with 55% frequency
   - `> 0.78` when toCall=0 → pot-sized bet for value
   - `> 0.60` when toCall=0 → half-pot bet
   - `equity > requiredEquity + 0.05` → call
   - otherwise → fold
6. **Positional bluff** — occasional c-bet on dry flops when in position with
   mid-range equity (0.30–0.50)

Hard is the first tier that plays genuinely profitable poker against a
human mid-stakes player.

---

## grandmaster

**File:** `src/bot/bot.ts::decideGrandmaster`

Adds on top of hard. Goals: **exploit opponent tendencies** and **open the
right ranges from the right positions** rather than just equity-cruising.

### Preflop: range-chart driven

```ts
const handCode = canonicalHand(c.hole[0], c.hole[1]);  // 'AA', 'AKs', 'AKo'
const position = getPosition(state, me);               // 'UTG' | ... | 'BB'
```

1. **HU button remap.** In heads-up, the button IS the small blind. A 6-max
   SB opens ~30% but a HU button should open ~85%. We remap `SB → BTN` for
   range lookups whenever `numPlayers === 2`. We further extend the HU button
   range with any hand whose `preflopScore ≥ 0.30` — catches the long tail
   of connectors and offsuit broadways the chart misses
2. **Open-raise detection.** "No voluntary raise yet" is detected by
   `maxBet > bbSize`, not by `lastAggressor` (which can be misleading because
   the engine records the BB poster as lastAggressor). This is the subtle
   fix that unlocked the self-play win rate gain
3. **In range, raise.** LP (`BTN`/`CO`) opens are half-pot sized, EP
   (`UTG`/`MP`) opens are "value"-sized (a touch bigger). Rationale: EP opens
   need to discourage the table more
4. **Facing a raise.** Use `preflopScore` as a cheap proxy for defend equity,
   widen/narrow the threshold by opponent VPIP:
   - 6-max: base 0.55, floor 0.35
   - HU: base 0.25, floor 0.15  (HU needs to defend 50%+ of BB to avoid
     being exploited by any opener)
5. **3-bet / 4-bet logic:**
   - Premium (`score ≥ 0.92`): 3-bet pot
   - Strong (`score ≥ 0.82`): 3-bet with 50% frequency, else call
   - Bluff 3-bet (`aggressorVPIP > 0.30` and `0.40 ≤ score ≤ 0.55`): 12% of
     the time

### Postflop: delegate to hard

The initial grandmaster tried to reinvent the postflop wheel — reading
archetype to tune the call buffer, different cbet frequencies, different
positional bluff thresholds. In self-play that version *lost* to hard
(~36% win rate) because the minor tweaks added noise without adding edge.

The current version delegates: `return decideHard(c, rng)` for everything
not preflop. The entire value-add is preflop range discipline.

### Opponent model (`src/bot/opponent-model.ts`)

All tiers feed into the opponent model — VPIP, PFR, AF, 3-bet%, CBet% —
but only `decideGrandmaster` currently *reads* it, through the VPIP-based
defend-threshold adjustment. Future tiers could exploit the archetype
classifier (`rock` / `tag` / `lag` / `fish` / `maniac`) more aggressively.

Model is fed from `src/app.ts::logEvents` via:

```ts
opponentModel.record(player, action.kind, state.phase);
```

and lifecycle-bookended with `newHand([seats])` / `endHand()`.

Reset on `startBotGame` / `startTournamentGame` so stats don't leak
between matches.

---

## Self-play benchmark

```
[selfplay] GRANDMASTER vs HARD · 5000 hands · GRANDMASTER won 2792 · 55.84% · net chips -38812
```

55.84% hand-win rate vs hard over 5000 hands (seed 777). Above the PRD bar
of 55%. The negative chip delta reflects variance in pot sizes rather than
a true hard edge — win rate is the PRD metric.

To reproduce:

```bash
npx tsx bench/selfplay.ts --hands 5000 --challenger grandmaster --defender hard --seed 777
```

## Tuning knobs

Most of the constants live inline at the top of each `decide*` function.
If you want to make a tier more aggressive, start with:

- Preflop — the threshold floor for `facingRaise` branches
- Postflop — the `valueEquity > X` thresholds that trigger raises
- Position bonus — the `+0.03` added when `isInPosition()` is true
- Sample counts — `800 / 1500` for Monte Carlo; bigger is more stable at
  the cost of thinking time

## Not currently implemented

These are explicitly out of scope for a heuristic bot, even grandmaster:

- **CFR / regret-matching** — would be a proper training loop + lookup
  tables. Better reached for via a separate "solver" bot tier
- **Range-vs-range postflop** — we play hero's exact hand vs. a random
  villain, not hero-range vs. villain-range
- **Board texture reads** — straight/flush draws, paired boards,
  monotone boards don't influence bet sizing
- **ICM-adjusted decisions in tournament mode** — bubble / pay-jump
  exploitation would need `icmEquity()` folded into the decision function
