/**
 * Fast poker hand evaluator — direct 7-card scoring without combinatorial
 * enumeration. Uses compact integer card encoding and bitmask straight
 * detection.
 *
 * Unlike the legacy classify5() path (which sorts + categorises a fixed 5
 * cards and is invoked C(n,5) times for 6- or 7-card hands), this module
 * scores all 7 cards in a single pass by counting ranks/suits and running
 * a small set of branches. Faster by a solid margin and — more importantly —
 * gives us a clean foundation for Phase 1 of the engine v2 PRD (equity API,
 * variant-aware evaluation, bot upgrades).
 *
 * Public API:
 *  • encodeCard(str)         → int (0..51)
 *  • evaluate5(cards)        → packed int score (higher = stronger)
 *  • evaluate7(cards)        → same, for 5–7 cards input
 *  • bestHandFast(cards)     → { score, category, cards } where `cards` is
 *                              the 5-card subset that formed the best hand
 *  • scoreCategory(score)    → 0..8 (high card → straight flush)
 *
 * Scoring convention matches src/core/hands.ts: packed integer where
 *     score = category*15^5 + tb[0]*15^4 + tb[1]*15^3 + tb[2]*15^2 + tb[3]*15 + tb[4]
 * So results are directly comparable to eval5() output and callers don't
 * need to translate.
 */

import type { Card } from '../types.js';

// ─── Card encoding ──────────────────────────────────────────────────────

/** Rank index 0..12 for '2'..'A'. */
const RANK_IDX: Readonly<Record<string, number>> = {
  '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7,
  'T': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12,
};

/** Suit index 0..3 for 's', 'h', 'd', 'c'. */
const SUIT_IDX: Readonly<Record<string, number>> = {
  s: 0, h: 1, d: 2, c: 3,
};

/** Turn a string card ("Ah", "Td") into an integer 0..51 (rank*4 + suit). */
export function encodeCard(card: Card): number {
  const r = RANK_IDX[card[0] ?? '2'] ?? 0;
  const s = SUIT_IDX[card[1] ?? 's'] ?? 0;
  return (r << 2) | s;
}

export function encodeCards(cards: readonly Card[]): number[] {
  const out = new Array<number>(cards.length);
  for (let i = 0; i < cards.length; i++) out[i] = encodeCard(cards[i]!);
  return out;
}

/** Extract rank (0..12, 12 = Ace) from encoded card. */
export function rankOfEnc(c: number): number { return c >> 2; }
/** Extract suit (0..3) from encoded card. */
export function suitOfEnc(c: number): number { return c & 3; }

// ─── Straight detection ────────────────────────────────────────────────
//
// A 13-bit rank bitmask with consecutive ranks set = straight. We pre-list
// the 10 valid straight masks (9 natural + wheel) and their high-card value.

const STRAIGHTS: ReadonlyArray<{ mask: number; high: number }> = [
  { mask: 0b1111100000000, high: 14 }, // A-K-Q-J-T
  { mask: 0b0111110000000, high: 13 }, // K-Q-J-T-9
  { mask: 0b0011111000000, high: 12 },
  { mask: 0b0001111100000, high: 11 },
  { mask: 0b0000111110000, high: 10 },
  { mask: 0b0000011111000, high: 9 },
  { mask: 0b0000001111100, high: 8 },
  { mask: 0b0000000111110, high: 7 },
  { mask: 0b0000000011111, high: 6 },
  { mask: 0b1000000001111, high: 5 }, // wheel A-2-3-4-5
];

function straightHigh(bitmask: number): number {
  for (const s of STRAIGHTS) {
    if ((bitmask & s.mask) === s.mask) return s.high;
  }
  return 0;
}

// ─── Score packing (matches existing eval5 convention) ────────────────
//
// High card = category 0 … Straight flush = category 8. Tiebreakers are
// packed in base-15 so larger numbers always beat smaller ones.

const BASE = 15;

function packScore(category: number, tb: readonly number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * BASE + (tb[i] ?? 0);
  return score;
}

export function scoreCategory(score: number): number {
  // Reverse: category = floor(score / 15^5)
  return Math.floor(score / (BASE * BASE * BASE * BASE * BASE));
}

// ─── Core evaluator ────────────────────────────────────────────────────
//
// `evaluateCore` takes an encoded card list (5..7 cards) and returns the
// packed score of the BEST 5-card combination plus the selected cards.
// It works in a single pass without combinatorial enumeration.

export interface EvalResult {
  score: number;
  category: number;
  /** Encoded-int cards that form the best 5-card hand. */
  cardsEnc: number[];
}

export function evaluateCore(cards: readonly number[]): EvalResult {
  const n = cards.length;
  if (n < 5 || n > 7) {
    throw new Error(`evaluateCore expects 5-7 cards, got ${n}`);
  }

  // Rank counts and suit-specific rank masks.
  const rankCount = new Uint8Array(13);
  const rankMask = 0;
  const suitMask = [0, 0, 0, 0];
  const suitCount = new Uint8Array(4);
  // Track ALL cards per rank for reconstructing the winning 5-card subset.
  // Store the encoded-card index list inline to avoid allocations.
  const byRank: number[][] = [[], [], [], [], [], [], [], [], [], [], [], [], []];

  let mask = rankMask;
  for (let i = 0; i < n; i++) {
    const c = cards[i]!;
    const r = c >> 2;
    const s = c & 3;
    rankCount[r]!++;
    suitMask[s]! |= 1 << r;
    suitCount[s]!++;
    mask |= 1 << r;
    byRank[r]!.push(c);
  }

  // ── Flush detection
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (suitCount[s]! >= 5) { flushSuit = s; break; }
  }

  // ── Straight flush?
  if (flushSuit !== -1) {
    const sfHigh = straightHigh(suitMask[flushSuit]!);
    if (sfHigh > 0) {
      // Build the 5 straight-flush cards from highest down.
      const top = sfHigh === 5 ? 3 : sfHigh - 2; // rank index of the top card (wheel: 5→3)
      const sfCards: number[] = [];
      if (sfHigh === 5) {
        // Wheel: A, 2, 3, 4, 5 → rank indices 12, 0, 1, 2, 3
        for (const ri of [12, 0, 1, 2, 3]) {
          const c = byRank[ri]!.find(c => (c & 3) === flushSuit);
          if (c !== undefined) sfCards.push(c);
        }
      } else {
        for (let ri = top; ri >= top - 4; ri--) {
          const c = byRank[ri]!.find(c => (c & 3) === flushSuit);
          if (c !== undefined) sfCards.push(c);
        }
      }
      return {
        score: packScore(8, [sfHigh, 0, 0, 0, 0]),
        category: 8,
        cardsEnc: sfCards,
      };
    }
  }

  // ── Count pairs/trips/quads (rank values, 2..14, highest first)
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 12; r >= 0; r--) {
    const rankVal = r + 2;
    const cnt = rankCount[r]!;
    if (cnt === 4) quads.push(rankVal);
    else if (cnt === 3) trips.push(rankVal);
    else if (cnt === 2) pairs.push(rankVal);
    else if (cnt === 1) singles.push(rankVal);
  }

  // ── Quads
  if (quads.length > 0) {
    const q = quads[0]!;
    // Kicker = highest remaining rank (not the quad).
    const kicker = bestRankExcept([q], rankCount);
    const quadCards = byRank[q - 2]!.slice(0, 4);
    const kickerCard = byRank[kicker - 2]!.slice(0, 1);
    return {
      score: packScore(7, [q, kicker, 0, 0, 0]),
      category: 7,
      cardsEnc: quadCards.concat(kickerCard),
    };
  }

  // ── Full house (trips + pair OR trips + trips)
  if (trips.length > 0 && (pairs.length > 0 || trips.length > 1)) {
    const tripsRank = trips[0]!;
    const pairRank = trips.length > 1 ? trips[1]! : pairs[0]!;
    const tripCards = byRank[tripsRank - 2]!.slice(0, 3);
    const pairCards = byRank[pairRank - 2]!.slice(0, 2);
    return {
      score: packScore(6, [tripsRank, pairRank, 0, 0, 0]),
      category: 6,
      cardsEnc: tripCards.concat(pairCards),
    };
  }

  // ── Flush (5 cards of one suit; take 5 highest ranks in suit)
  if (flushSuit !== -1) {
    const fcards: number[] = [];
    const fRanks: number[] = [];
    for (let r = 12; r >= 0 && fcards.length < 5; r--) {
      const c = byRank[r]!.find(c => (c & 3) === flushSuit);
      if (c !== undefined) {
        fcards.push(c);
        fRanks.push(r + 2);
      }
    }
    return {
      score: packScore(5, fRanks),
      category: 5,
      cardsEnc: fcards,
    };
  }

  // ── Straight (non-flush)
  const sHigh = straightHigh(mask);
  if (sHigh > 0) {
    const sCards: number[] = [];
    if (sHigh === 5) {
      for (const ri of [12, 0, 1, 2, 3]) {
        const c = byRank[ri]![0];
        if (c !== undefined) sCards.push(c);
      }
    } else {
      const top = sHigh - 2;
      for (let ri = top; ri >= top - 4; ri--) {
        const c = byRank[ri]![0];
        if (c !== undefined) sCards.push(c);
      }
    }
    return {
      score: packScore(4, [sHigh, 0, 0, 0, 0]),
      category: 4,
      cardsEnc: sCards,
    };
  }

  // ── Three of a kind
  if (trips.length > 0) {
    const t = trips[0]!;
    const k1 = singles[0] ?? bestRankExcept([t], rankCount);
    const k2 = singles[1] ?? bestRankExcept([t, k1], rankCount);
    const cardsOut = byRank[t - 2]!.slice(0, 3)
      .concat(byRank[k1 - 2]!.slice(0, 1))
      .concat(byRank[k2 - 2]!.slice(0, 1));
    return {
      score: packScore(3, [t, k1, k2, 0, 0]),
      category: 3,
      cardsEnc: cardsOut,
    };
  }

  // ── Two pair
  if (pairs.length >= 2) {
    const p1 = pairs[0]!;
    const p2 = pairs[1]!;
    const k = singles[0] ?? bestRankExcept([p1, p2], rankCount);
    const cardsOut = byRank[p1 - 2]!.slice(0, 2)
      .concat(byRank[p2 - 2]!.slice(0, 2))
      .concat(byRank[k - 2]!.slice(0, 1));
    return {
      score: packScore(2, [p1, p2, k, 0, 0]),
      category: 2,
      cardsEnc: cardsOut,
    };
  }

  // ── Pair
  if (pairs.length === 1) {
    const p = pairs[0]!;
    const k1 = singles[0]!;
    const k2 = singles[1]!;
    const k3 = singles[2]!;
    const cardsOut = byRank[p - 2]!.slice(0, 2)
      .concat(byRank[k1 - 2]!.slice(0, 1))
      .concat(byRank[k2 - 2]!.slice(0, 1))
      .concat(byRank[k3 - 2]!.slice(0, 1));
    return {
      score: packScore(1, [p, k1, k2, k3, 0]),
      category: 1,
      cardsEnc: cardsOut,
    };
  }

  // ── High card
  const top5 = singles.slice(0, 5);
  const cardsOut = top5.map(r => byRank[r - 2]![0]!);
  return {
    score: packScore(0, top5),
    category: 0,
    cardsEnc: cardsOut,
  };
}

function bestRankExcept(exclude: number[], counts: Uint8Array): number {
  for (let r = 12; r >= 0; r--) {
    const rankVal = r + 2;
    if (exclude.includes(rankVal)) continue;
    if (counts[r]! > 0) return rankVal;
  }
  return 2;
}

// ─── Public string-input wrappers ──────────────────────────────────────

/** Evaluate a 5-7 card hand from string cards. Returns packed integer score. */
export function evaluate(cards: readonly Card[]): number {
  return evaluateCore(encodeCards(cards)).score;
}

/** Full best-hand result from string cards. */
export function bestHandFast(cards: readonly Card[]): EvalResult {
  return evaluateCore(encodeCards(cards));
}

/** Evaluate from an already-encoded card list (faster, used by hot loops). */
export function evaluateEnc(cards: readonly number[]): number {
  return evaluateCore(cards).score;
}
