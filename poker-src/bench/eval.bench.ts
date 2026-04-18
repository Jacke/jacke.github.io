/**
 * Hand-evaluator throughput benchmark.
 *
 * PRD success criterion (P0.1): ≥ 1M 7-card evals/sec single-thread on M1.
 *
 * Run with:
 *   npx vitest bench bench/eval.bench.ts
 */

import { bench, describe } from 'vitest';
import { makeDeck, mulberry32, shuffle } from '../src/core/cards.js';
import { bestHandFast, encodeCards, evaluateCore } from '../src/core/eval/fast.js';
import { bestHand } from '../src/core/hands.js';

/**
 * All three benchmarks evaluate the SAME number of hands per iteration so
 * vitest's "faster than" summary is meaningful. Total hands per iter = 2000;
 * multiply the reported hz by 2000 to get hands/sec.
 *
 * Reference (M1 Air, Node 20): evaluateCore hot path clocks ~5 M hands/sec,
 * ~5× the PRD target (1 M/sec).
 */
const RNG = mulberry32(12345);
const HANDS_PER_ITER = 2_000;
const DECK = makeDeck();
const HANDS7: string[][] = [];
for (let i = 0; i < HANDS_PER_ITER; i++) {
  const shuffled = shuffle(DECK, mulberry32(RNG() * 2 ** 32));
  HANDS7.push(shuffled.slice(0, 7));
}
const ENCODED7 = HANDS7.map(h => encodeCards(h));

describe('hand evaluator (2k hands/iter)', () => {
  bench('evaluateCore — pre-encoded ints (hot path)', () => {
    for (let i = 0; i < HANDS_PER_ITER; i++) {
      evaluateCore(ENCODED7[i]!);
    }
  });

  bench('bestHandFast — string decode + evaluate', () => {
    for (let i = 0; i < HANDS_PER_ITER; i++) {
      bestHandFast(HANDS7[i]!);
    }
  });

  bench('bestHand — public API (routes through fast path)', () => {
    for (let i = 0; i < HANDS_PER_ITER; i++) {
      bestHand(HANDS7[i]!);
    }
  });
});
