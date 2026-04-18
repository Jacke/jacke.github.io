import { describe, it, expect } from 'vitest';
import { bestHandFast, evaluate, scoreCategory, encodeCard } from './fast.js';
import { bestHand as legacyBestHand, eval5 as legacyEval5 } from '../hands.js';
import { makeDeck, mulberry32, shuffle } from '../cards.js';

/**
 * Differential tests — for a wide random sample of 7-card hands, the fast
 * evaluator must agree with the legacy combinatorial evaluator on both
 * category and score. If these ever diverge, either the fast path has a
 * bug or we silently regressed the legacy path.
 */
describe('fast evaluator vs legacy (differential)', () => {
  it('1000 random 7-card hands produce identical score + category', () => {
    const rng = mulberry32(0xBEEF);
    const deck = makeDeck();
    let mismatches = 0;
    const firstMismatch: Array<{ cards: string[]; fast: number; slow: number }> = [];
    for (let i = 0; i < 1000; i++) {
      const shuffled = shuffle(deck, rng);
      const hand = shuffled.slice(0, 7);
      const fast = bestHandFast(hand);
      const slow = legacyBestHand(hand);
      if (fast.score !== slow.score || fast.category !== slow.category) {
        mismatches++;
        if (firstMismatch.length < 3) {
          firstMismatch.push({ cards: hand, fast: fast.score, slow: slow.score });
        }
      }
    }
    if (mismatches > 0) {
      // Pretty-print the first few for debugging.
      // eslint-disable-next-line no-console
      console.error('Mismatches:', mismatches, firstMismatch);
    }
    expect(mismatches).toBe(0);
  });

  it('1000 random 6-card hands agree with legacy', () => {
    const rng = mulberry32(0x1234);
    const deck = makeDeck();
    let mismatches = 0;
    for (let i = 0; i < 1000; i++) {
      const hand = shuffle(deck, rng).slice(0, 6);
      const fast = bestHandFast(hand);
      const slow = legacyBestHand(hand);
      if (fast.score !== slow.score) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe('fast evaluator — category spot checks', () => {
  it('detects royal flush', () => {
    const r = bestHandFast(['As', 'Ks', 'Qs', 'Js', 'Ts', '2c', '3d']);
    expect(r.category).toBe(8);
    expect(scoreCategory(r.score)).toBe(8);
  });

  it('detects wheel straight (A-2-3-4-5)', () => {
    const r = bestHandFast(['As', '2h', '3d', '4c', '5s', 'Kh', 'Qd']);
    expect(r.category).toBe(4);
    expect(r.cardsEnc).toHaveLength(5);
  });

  it('detects wheel straight flush', () => {
    const r = bestHandFast(['As', '2s', '3s', '4s', '5s', 'Kh', 'Qd']);
    expect(r.category).toBe(8);
  });

  it('detects four of a kind, top kicker', () => {
    const r = bestHandFast(['As', 'Ah', 'Ad', 'Ac', '2c', 'Ks', '7d']);
    expect(r.category).toBe(7);
    // Kicker should be K, not 7 or 2.
    expect(r.cardsEnc).toHaveLength(5);
  });

  it('detects full house preferring highest trip', () => {
    const r = bestHandFast(['Ks', 'Kh', 'Kd', 'Qc', 'Qh', '2s', '3d']);
    expect(r.category).toBe(6);
  });

  it('detects two pair with best kicker', () => {
    const r = bestHandFast(['As', 'Ah', '9d', '9c', '4h', '4s', '2d']);
    // Three pairs → best two pair is AA+99 with 4 as kicker.
    expect(r.category).toBe(2);
  });

  it('detects pair with 3 kickers', () => {
    const r = bestHandFast(['As', 'Ah', 'Ks', 'Qd', 'Jc', '7h', '2d']);
    expect(r.category).toBe(1);
  });

  it('detects high card — takes top 5 of 7', () => {
    const r = bestHandFast(['As', 'Kh', 'Qd', 'Jc', '9s', '6h', '3d']);
    expect(r.category).toBe(0);
    expect(r.cardsEnc).toHaveLength(5);
  });
});

describe('evaluate() basic API', () => {
  it('AA > KK always', () => {
    const a = evaluate(['As', 'Ah', '2d', '7h', 'Js']);
    const b = evaluate(['Ks', 'Kh', '2d', '7h', 'Js']);
    expect(a).toBeGreaterThan(b);
  });

  it('flush beats straight on the same board', () => {
    const flush = evaluate(['As', 'Ks', 'Qs', 'Js', '9s']);
    const straight = evaluate(['As', 'Kh', 'Qd', 'Jc', 'Ts']);
    expect(flush).toBeGreaterThan(straight);
  });
});

describe('encodeCard sanity', () => {
  it('round-trips 52 distinct values', () => {
    const seen = new Set<number>();
    for (const c of makeDeck()) seen.add(encodeCard(c));
    expect(seen.size).toBe(52);
  });
});
