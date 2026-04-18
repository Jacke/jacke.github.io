import type { Card, GameVariant, HandCategory, HandRank } from './types.js';
import { rankOf, suitOf, shortDeckRankOf, isJoker, JOKER, RANKS, SUITS } from './cards.js';
import { bestHandFast } from './eval/fast.js';

// Decoded-card → string, inverse of fast.ts encodeCard.
const RANK_CHARS = '23456789TJQKA';
const SUIT_CHARS = 'shdc';
function decodeCardInt(enc: number): Card {
  return (RANK_CHARS[enc >> 2] ?? '2') + (SUIT_CHARS[enc & 3] ?? 's');
}

export const HAND_NAMES: readonly string[] = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Five of a Kind',
];

/** Get rank value based on game variant */
function getRank(c: Card, variant?: GameVariant): number {
  if (variant === 'shortdeck') {
    return shortDeckRankOf(c);
  }
  return rankOf(c);
}

const RANK_NAME: Readonly<Record<number, string>> = {
  14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: 'Ten',
  9: 'Nine', 8: 'Eight', 7: 'Seven', 6: 'Six', 5: 'Five',
  4: 'Four', 3: 'Three', 2: 'Two',
};

function rankName(v: number): string {
  return RANK_NAME[v] ?? String(v);
}

function plural(v: number): string {
  const n = rankName(v);
  return n === 'Six' || n === 'Nine' ? n + 'es' : n + 's';
}

interface Classified {
  category: HandCategory;
  /** Sorted tiebreaker ranks, high→low. Length ≤ 5. */
  tiebreakers: number[];
  /** Rank value of the straight's high card (5 for a wheel), if applicable. */
  straightHigh: number;
  /** Descending sorted ranks of all 5 cards. */
  vals: number[];
  isFlush: boolean;
  isStraight: boolean;
  pairs: number[];
  trips: number[];
  quads: number[];
}

/**
 * Classify a 5-card hand into its category and tiebreakers.
 * Single source of truth for straight/wheel/flush detection.
 * @param variant Game variant to use for rank evaluation (shortdeck has different straight rules)
 */
export function classify5(cards: Card[], variant?: GameVariant): Classified {
  if (cards.length !== 5) {
    throw new Error(`classify5 expects 5 cards, got ${cards.length}`);
  }

  const vals = cards.map(c => getRank(c, variant)).sort((a, b) => b - a);
  const suits = cards.map(suitOf);
  const isFlush = suits.every(s => s === suits[0]);

  // Unique descending ranks — a proper straight needs 5 distinct values.
  const uniq = Array.from(new Set(vals)).sort((a, b) => b - a);
  let isStraight = false;
  let straightHigh = 0;
  
  if (uniq.length === 5) {
    // Standard straight check (both regular and Short Deck)
    if (uniq[0]! - uniq[4]! === 4) {
      isStraight = true;
      straightHigh = uniq[0]!;
    }
    // Wheel: A-2-3-4-5 — treat as 5-high
    // BUT in Short Deck, wheel is NOT a straight (A-6-7-8-9 is the wheel)
    // Only regular Hold'em/Omaha has wheel as straight
    else if (variant !== 'shortdeck' && uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
      isStraight = true;
      straightHigh = 5; // A-2-3-4-5 = 5-high straight
    }
    // Short Deck: A-6-7-8-9 is the "wheel" (6-high straight)
    else if (variant === 'shortdeck' && uniq[0] === 14 && uniq[1] === 9 && uniq[2] === 8 && uniq[3] === 7 && uniq[4] === 6) {
      isStraight = true;
      straightHigh = 6; // A-6-7-8-9 = 6-high straight in Short Deck
    }
  }

  const cnt = new Map<number, number>();
  for (const v of vals) cnt.set(v, (cnt.get(v) ?? 0) + 1);
  const pairs: number[] = [];
  const trips: number[] = [];
  const quads: number[] = [];
  for (const [v, c] of cnt) {
    if (c === 4) quads.push(v);
    else if (c === 3) trips.push(v);
    else if (c === 2) pairs.push(v);
  }
  pairs.sort((a, b) => b - a);
  trips.sort((a, b) => b - a);

  let category: HandCategory;
  let tiebreakers: number[];

  if (isFlush && isStraight) {
    category = 8;
    tiebreakers = [straightHigh];
  } else if (quads.length > 0) {
    category = 7;
    const kicker = vals.find(v => v !== quads[0])!;
    tiebreakers = [quads[0]!, kicker];
  } else if (trips.length > 0 && pairs.length > 0) {
    category = 6;
    tiebreakers = [trips[0]!, pairs[0]!];
  } else if (isFlush) {
    category = 5;
    tiebreakers = vals.slice();
  } else if (isStraight) {
    category = 4;
    tiebreakers = [straightHigh];
  } else if (trips.length > 0) {
    category = 3;
    const kickers = vals.filter(v => v !== trips[0]).slice(0, 2);
    tiebreakers = [trips[0]!, ...kickers];
  } else if (pairs.length >= 2) {
    category = 2;
    const kicker = vals.find(v => v !== pairs[0] && v !== pairs[1])!;
    tiebreakers = [pairs[0]!, pairs[1]!, kicker];
  } else if (pairs.length === 1) {
    category = 1;
    const kickers = vals.filter(v => v !== pairs[0]).slice(0, 3);
    tiebreakers = [pairs[0]!, ...kickers];
  } else {
    category = 0;
    tiebreakers = vals.slice(0, 5);
  }

  return { category, tiebreakers, straightHigh, vals, isFlush, isStraight, pairs, trips, quads };
}

/**
 * Evaluate exactly 5 cards and return a comparable integer score.
 * Higher score = better hand. Encoding: cat * 15^5 + tb[0]*15^4 + tb[1]*15^3 + ...
 * @param variant Game variant for rank evaluation
 */
export function eval5(cards: Card[], variant?: GameVariant): number {
  const { category, tiebreakers } = classify5(cards, variant);
  let score = category;
  for (let i = 0; i < 5; i++) {
    score = score * 15 + (tiebreakers[i] ?? 0);
  }
  return score;
}

/** Human-readable name for a specific 5-card hand. */
export function handName(cards: Card[], variant?: GameVariant): string {
  const c = classify5(cards, variant);

  if (c.category === 8) {
    if (c.straightHigh === 14) return 'Royal Flush';
    return `Straight Flush, ${rankName(c.straightHigh)}-high`;
  }
  if (c.category === 7) return `Four of a Kind, ${plural(c.quads[0]!)}`;
  if (c.category === 6) return `Full House, ${plural(c.trips[0]!)} full of ${plural(c.pairs[0]!)}`;
  if (c.category === 5) return `Flush, ${rankName(c.vals[0]!)}-high`;
  if (c.category === 4) return `Straight, ${rankName(c.straightHigh)}-high`;
  if (c.category === 3) return `Three of a Kind, ${plural(c.trips[0]!)}`;
  if (c.category === 2) return `Two Pair, ${plural(c.pairs[0]!)} and ${plural(c.pairs[1]!)}`;
  if (c.category === 1) return `Pair of ${plural(c.pairs[0]!)}`;
  return `High Card, ${rankName(c.vals[0]!)}`;
}

/** All C(n,k) combinations — iterative to avoid stack depth on small inputs. */
function combinations<T>(arr: readonly T[], k: number): T[][] {
  const result: T[][] = [];
  const n = arr.length;
  if (k > n || k < 0) return result;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    result.push(idx.map(i => arr[i]!));
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) break;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
  return result;
}

/**
 * Find the best 5-card hand in a pool of 5-7 cards (hole + any community
 * already dealt). Works for flop (5 cards), turn (6), and river/showdown (7).
 * @param variant Game variant for rank evaluation
 */
export function bestHand(cards: Card[], variant?: GameVariant): HandRank {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`bestHand expects 5-7 cards, got ${cards.length}`);
  }
  if (variant === 'joker' && cards.some(isJoker)) {
    return bestHandJoker(cards);
  }
  if (cards.length === 5) {
    const c = classify5(cards, variant);
    return {
      score: eval5(cards, variant),
      cards: cards.slice(),
      name: handName(cards, variant),
      category: c.category,
    };
  }
  // Fast path: standard Hold'em style evaluator (6 or 7 cards). It picks the
  // best 5-card subset in a single pass without combinatorial enumeration.
  // Short-deck and any future custom-rank variants fall through to the
  // slower classify-each-combo path since the fast evaluator assumes the
  // normal 2..A rank ordering.
  if (variant !== 'shortdeck') {
    const result = bestHandFast(cards);
    const chosen = result.cardsEnc.map(decodeCardInt);
    // Sanity: if the fast path ever gives us a non-5 subset, fall back to
    // the slow enumeration so classify5/handName don't explode.
    if (chosen.length === 5) {
      return {
        score: result.score,
        cards: chosen,
        name: handName(chosen, variant),
        category: result.category as HandCategory,
      };
    }
  }
  // Short-deck slow path: preserve the existing combinatorial fallback.
  let best: HandRank | null = null;
  for (const combo of combinations(cards, 5)) {
    const score = eval5(combo, variant);
    if (best === null || score > best.score) {
      const c = classify5(combo, variant);
      best = {
        score,
        cards: combo,
        name: handName(combo, variant),
        category: c.category,
      };
    }
  }
  return best!;
}

/**
 * Omaha best hand: must use exactly 2 hole cards + exactly 3 community cards.
 * @param hole 4 hole cards
 * @param community 3-5 community cards  
 * @param variant Game variant for rank evaluation
 */
export function bestHandOmaha(hole: Card[], community: Card[], variant?: GameVariant): HandRank {
  if (hole.length !== 4) {
    throw new Error(`bestHandOmaha expects 4 hole cards, got ${hole.length}`);
  }
  if (community.length < 3 || community.length > 5) {
    throw new Error(`bestHandOmaha expects 3-5 community cards, got ${community.length}`);
  }

  let best: HandRank | null = null;

  // C(4,2) = 6 ways to choose 2 from hole cards
  for (const holeCombo of combinations(hole, 2)) {
    // C(n,3) ways to choose 3 from community (n=3,4,5)
    for (const commCombo of combinations(community, 3)) {
      const hand5 = [...holeCombo, ...commCombo];
      const score = eval5(hand5, variant);
      if (best === null || score > best.score) {
        const c = classify5(hand5, variant);
        best = {
          score,
          cards: hand5,
          name: handName(hand5, variant),
          category: c.category,
        };
      }
    }
  }

  if (!best) {
    throw new Error('bestHandOmaha: no valid combination found');
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Joker Hold'em — wild card evaluation
// ═══════════════════════════════════════════════════════════════════════════════

const ALL_CARDS: Card[] = (() => {
  const out: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) out.push(r + s);
  return out;
})();

/**
 * Evaluate a hand that may contain a joker (wild card).
 *
 * Two passes:
 *   1. Five-of-a-kind check: scan the non-joker cards for any rank that
 *      appears 4 times. If found, the joker makes it five-of-a-kind
 *      (category 9 — highest possible hand). We pick the highest such
 *      rank if multiple quads exist (impossible with 1 joker, but safe).
 *   2. Best-substitution brute force: for each of the 52 real cards not
 *      already present, replace the joker with it, evaluate the resulting
 *      hand, and keep the best. ~48 iterations × fast evaluator ≈ <1ms.
 *
 * Whichever of (1) or (2) scores higher wins.
 */
export function bestHandJoker(cards: Card[]): HandRank {
  const jokerCount = cards.filter(isJoker).length;
  if (jokerCount === 0) return bestHand(cards);

  const nonJokers = cards.filter(c => !isJoker(c));
  const present = new Set(nonJokers);

  let best: HandRank | null = null;

  // Pass 1 — five-of-a-kind: if non-joker cards contain quads, the
  // joker promotes them. We scan all 5–6 non-joker cards (not just a
  // best-5 subset) so four aces spread across hole + community are found.
  const rankCounts = new Map<string, number>();
  for (const c of nonJokers) {
    const r = c[0]!;
    rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
  }
  for (const [r, cnt] of rankCounts) {
    if (cnt < 4) continue;
    const rv = rankOf(r + 's'); // any suit — we only need the numeric value
    const score = 9 * (15 ** 5) + rv * (15 ** 4);
    const fiveCards = nonJokers.filter(c => c[0] === r).slice(0, 4);
    fiveCards.push(JOKER);
    const promoted: HandRank = {
      score,
      cards: fiveCards,
      name: `Five of a Kind, ${plural(rv)}`,
      category: 9 as HandCategory,
    };
    if (!best || promoted.score > best.score) best = promoted;
  }

  // Pass 2 — substitution brute force for normal hands (8 and below).
  for (const sub of ALL_CARDS) {
    if (present.has(sub)) continue;
    const trial = [...nonJokers, sub];
    const result = bestHand(trial);
    if (!best || result.score > best.score) best = result;
  }

  return best!;
}
