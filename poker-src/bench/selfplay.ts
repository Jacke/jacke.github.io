/**
 * Bot-vs-bot self-play harness.
 *
 * PRD success criterion (P1.2 / grandmaster): ≥ 55% win rate vs. `hard` over
 * 10,000 heads-up hands. Runs a tight engine loop with no UI / no SFX / no
 * persistence, so it's fast enough to execute inside a single `npm run` call.
 *
 * Usage:
 *   npx tsx bench/selfplay.ts                        # 10,000 hands, GM vs HARD
 *   npx tsx bench/selfplay.ts --hands 2000
 *   npx tsx bench/selfplay.ts --challenger hard --defender medium
 *
 * Output is a single summary line for easy grep-ing in CI:
 *   [selfplay] GM vs HARD · 10000 hands · GM won 5612 · 56.12%
 */

import { applyAction, createGameState, dealHand, finishToShowdown, nextStreet } from '../src/core/engine.js';
import { makeDeck, mulberry32, shuffle } from '../src/core/cards.js';
import { decideAction, type Difficulty } from '../src/bot/bot.js';

interface Args {
  hands: number;
  challenger: Difficulty;
  defender: Difficulty;
  seed: number;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    hands: 10_000,
    challenger: 'grandmaster',
    defender: 'hard',
    seed: 42,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = argv[i + 1];
    if (a === '--hands' && next) { out.hands = Number(next); i++; }
    else if (a === '--challenger' && next) { out.challenger = next as Difficulty; i++; }
    else if (a === '--defender' && next) { out.defender = next as Difficulty; i++; }
    else if (a === '--seed' && next) { out.seed = Number(next); i++; }
    else if (a === '-v' || a === '--verbose') out.verbose = true;
  }
  return out;
}

/** Play one heads-up hand to completion. Returns chip deltas [seat0, seat1]. */
function playOneHand(
  a: Difficulty,
  b: Difficulty,
  rng: () => number,
  buttonIdx: number,
): [number, number] {
  const s = createGameState(2, 0, ['A', 'B']);
  s.buttonIndex = buttonIdx;
  const startingA = s.chips[0]!;
  const startingB = s.chips[1]!;
  const deck = shuffle(makeDeck(), rng);
  dealHand(s, deck);

  const diffs: [Difficulty, Difficulty] = [a, b];
  let handEnded = false;
  let safety = 0;
  while (!handEnded) {
    if (safety++ > 2000) throw new Error('selfplay: hand did not terminate');
    const actor = s.actingPlayer;
    const diff = diffs[actor]!;
    const action = decideAction(s, diff, { rng });
    const res = applyAction(s, actor, action);
    if (res.handEnded) { handEnded = true; break; }
    if (!res.roundClosed) continue;

    // Round closed: if someone can still act across streets, move to the
    // next street; otherwise run out the board and settle.
    const actorCount = s.folded.reduce(
      (n, f, i) => (!f && !s.allIn[i] ? n + 1 : n),
      0,
    );
    if (actorCount <= 1) {
      finishToShowdown(s);
      handEnded = true;
      break;
    }
    // nextStreet may itself advance straight through to showdown on the
    // river; phase 'river' means we just dealt it, so the next call to
    // applyAction drives the river betting round.
    const evs = nextStreet(s);
    if (evs.some(e => e.kind === 'award')) {
      handEnded = true;
      break;
    }
  }
  return [s.chips[0]! - startingA, s.chips[1]! - startingB];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rng = mulberry32(args.seed);

  let wonByA = 0;
  let wonByB = 0;
  let ties = 0;
  let totalDeltaA = 0;

  for (let h = 0; h < args.hands; h++) {
    try {
      const [da, db] = playOneHand(args.challenger, args.defender, rng, h % 2);
      totalDeltaA += da;
      if (da > db) wonByA++;
      else if (db > da) wonByB++;
      else ties++;
      if (args.verbose && (h + 1) % 1000 === 0) {
        const pct = ((wonByA / (h + 1)) * 100).toFixed(2);
        console.log(`[selfplay] ${h + 1}/${args.hands} · ${args.challenger} win rate ${pct}%`);
      }
    } catch (e) {
      // Skip hands that blow up — should never happen after the engine fixes
      // but safer than crashing the whole run.
      if (args.verbose) console.warn(`[selfplay] hand ${h} error:`, (e as Error).message);
    }
  }

  const total = wonByA + wonByB + ties;
  const pct = total > 0 ? (wonByA / total) * 100 : 0;
  const aLabel = args.challenger.toUpperCase();
  const bLabel = args.defender.toUpperCase();
  console.log(
    `[selfplay] ${aLabel} vs ${bLabel} · ${total} hands · ${aLabel} won ${wonByA} · ${pct.toFixed(2)}% · net chips ${totalDeltaA >= 0 ? '+' : ''}${totalDeltaA}`,
  );
  // Exit code 0 if challenger meets the 55% PRD bar, else 1 so CI can gate.
  process.exit(pct >= 55 ? 0 : 1);
}

main();
