/**
 * Equity API — "given this hero hand and optional board, what's my
 * probability of winning?"
 *
 * Backed by the fast evaluator in eval/fast.ts. Two modes:
 *
 *  • equityEnum(hero, board?, villainHoles?) — exact enumeration when the
 *    remaining deck is small enough to brute-force (preflop 2-vs-1 = 1.7M
 *    combinations which is borderline; we cap the enum runner at 200k
 *    samples and fall back to MC above that). Great for flop/turn/river
 *    exact equity queries.
 *
 *  • equityMonte(hero, board?, samples, rng?) — Monte-Carlo sampling when
 *    enumeration is infeasible. Uses a Fisher-Yates partial shuffle for
 *    each iteration — no allocations in the hot loop.
 *
 * Both assume hero is Hold'em hole cards (2 cards). Omaha and other
 * variants will get their own wrappers in later PRD phases.
 */

import type { Card } from './types.js';
import { SUITS, RANKS } from './cards.js';
import { encodeCard, evaluateCore } from './eval/fast.js';

type Rng = () => number;

const FULL_DECK: number[] = (() => {
  const d: number[] = [];
  for (const r of RANKS) for (const s of SUITS) d.push(encodeCard(r + s));
  return d;
})();

/** Return the remaining deck after removing known cards. */
function remainingDeck(known: number[]): number[] {
  const knownSet = new Set(known);
  const out: number[] = [];
  for (const c of FULL_DECK) if (!knownSet.has(c)) out.push(c);
  return out;
}

function compareHands(heroCards: number[], villainCards: number[], board: number[]): 1 | 0 | -1 {
  // 7-card evaluate for each side
  const h = evaluateCore([...heroCards, ...board]).score;
  const v = evaluateCore([...villainCards, ...board]).score;
  if (h > v) return 1;
  if (h < v) return -1;
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════
// Monte-Carlo equity
// ═══════════════════════════════════════════════════════════════════════

export interface EquityResult {
  win: number;
  tie: number;
  loss: number;
  /** Convenience: win + 0.5 * tie (standard "equity" number). */
  equity: number;
  iterations: number;
}

/**
 * Monte-Carlo equity against N random opponents with random runouts.
 *
 * @param hero          Hero's 2 hole cards (encoded strings or 2-char codes)
 * @param board         Known community cards so far (0, 3, 4, or 5)
 * @param opts.samples  Monte-Carlo iterations (default 2000)
 * @param opts.villains Number of opponents (default 1)
 * @param opts.rng      Optional deterministic RNG for tests
 */
export function equityMonte(
  hero: readonly [Card, Card],
  board: readonly Card[] = [],
  opts: { samples?: number; villains?: number; rng?: Rng } = {},
): EquityResult {
  const samples = opts.samples ?? 2000;
  const villains = opts.villains ?? 1;
  const rng = opts.rng ?? Math.random;

  const heroEnc = [encodeCard(hero[0]), encodeCard(hero[1])];
  const boardEnc = board.map(encodeCard);
  const dead = [...heroEnc, ...boardEnc];
  const baseDeck = remainingDeck(dead);

  const needBoard = 5 - boardEnc.length;
  const draws = needBoard + 2 * villains;
  if (draws > baseDeck.length) {
    throw new Error(`equityMonte: not enough cards (need ${draws}, have ${baseDeck.length})`);
  }

  // Pre-allocated scratch board so the hot loop doesn't realloc per iter.
  const scratch = baseDeck.slice();
  const n = scratch.length;

  let win = 0;
  let tie = 0;
  let loss = 0;
  const heroBoard: number[] = new Array(5);

  for (let iter = 0; iter < samples; iter++) {
    // Partial Fisher-Yates: shuffle only the first `draws` slots.
    for (let i = 0; i < draws; i++) {
      const j = i + Math.floor(rng() * (n - i));
      const tmp = scratch[i]!;
      scratch[i] = scratch[j]!;
      scratch[j] = tmp;
    }
    // Compose board: known + first needBoard drawn cards.
    for (let i = 0; i < boardEnc.length; i++) heroBoard[i] = boardEnc[i]!;
    for (let i = 0; i < needBoard; i++) heroBoard[boardEnc.length + i] = scratch[i]!;

    // Hero score
    const heroScore = evaluateCore([...heroEnc, ...heroBoard]).score;

    // For each villain, pick 2 cards and compare.
    let beatsAll = true;
    let tiesAny = false;
    for (let v = 0; v < villains; v++) {
      const vh = [
        scratch[needBoard + v * 2]!,
        scratch[needBoard + v * 2 + 1]!,
      ];
      const vScore = evaluateCore([...vh, ...heroBoard]).score;
      if (vScore > heroScore) { beatsAll = false; break; }
      if (vScore === heroScore) tiesAny = true;
    }
    if (!beatsAll) loss++;
    else if (tiesAny) tie++;
    else win++;
  }

  const equity = (win + tie * 0.5) / samples;
  return { win, tie, loss, equity, iterations: samples };
}

// ═══════════════════════════════════════════════════════════════════════
// Enumeration equity (exact, for flop/turn/river)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Exact equity via full enumeration of remaining runouts and villain
 * hole-card combinations. Only feasible when the remaining deck is small
 * (flop/turn with 1 villain → ~30k combos; preflop → 1.7M → too slow).
 *
 * For preflop or multi-villain scenarios, use equityMonte() instead.
 * This function will throw if the enumeration would exceed `maxCombos`
 * (default 200,000) so the caller can gracefully fall back to MC.
 */
export function equityEnum(
  hero: readonly [Card, Card],
  board: readonly Card[] = [],
  opts: { villains?: number; maxCombos?: number } = {},
): EquityResult {
  const villains = opts.villains ?? 1;
  if (villains !== 1) {
    throw new Error('equityEnum currently supports 1 villain (multi-way would blow up the combo count)');
  }
  const maxCombos = opts.maxCombos ?? 200_000;

  const heroEnc = [encodeCard(hero[0]), encodeCard(hero[1])];
  const boardEnc = board.map(encodeCard);
  const dead = [...heroEnc, ...boardEnc];
  const deck = remainingDeck(dead);
  const needBoard = 5 - boardEnc.length;

  // Estimate combo count before committing: C(deckSize, needBoard+2)
  const totalRemaining = deck.length;
  const combos = binomial(totalRemaining, needBoard + 2);
  if (combos > maxCombos) {
    throw new Error(`equityEnum: ${combos} combos exceeds cap of ${maxCombos}`);
  }

  let win = 0, tie = 0, loss = 0, total = 0;

  // Enumerate all (board completion + villain hole pair) combinations.
  // Simpler strategy: enumerate villain hole pairs, then enumerate board completions.
  for (let v1 = 0; v1 < totalRemaining; v1++) {
    for (let v2 = v1 + 1; v2 < totalRemaining; v2++) {
      const villainHole = [deck[v1]!, deck[v2]!];
      // Build the "inner deck" = deck minus villain holes
      enumBoard(heroEnc, villainHole, boardEnc, deck, v1, v2, needBoard, (outcome) => {
        if (outcome === 1) win++;
        else if (outcome === 0) tie++;
        else loss++;
        total++;
      });
    }
  }

  const equity = total === 0 ? 0 : (win + tie * 0.5) / total;
  return { win, tie, loss, equity, iterations: total };
}

function enumBoard(
  hero: number[],
  villainHole: number[],
  knownBoard: number[],
  deck: readonly number[],
  skip1: number,
  skip2: number,
  need: number,
  emit: (outcome: 1 | 0 | -1) => void,
): void {
  if (need === 0) {
    emit(compareHands(hero, villainHole, knownBoard));
    return;
  }
  // Iterate combinations of `need` cards from deck, skipping skip1/skip2.
  const n = deck.length;
  const indices: number[] = [];
  // Initialize with first `need` valid indices.
  let k = 0;
  for (let i = 0; i < n && k < need; i++) {
    if (i === skip1 || i === skip2) continue;
    indices.push(i);
    k++;
  }
  if (indices.length < need) return;

  const tempBoard: number[] = [...knownBoard];
  while (true) {
    // Build board with current indices
    for (let j = 0; j < need; j++) tempBoard[knownBoard.length + j] = deck[indices[j]!]!;
    emit(compareHands(hero, villainHole, tempBoard));

    // Advance to next combination (skipping skip1/skip2)
    let j = need - 1;
    while (j >= 0) {
      let next = indices[j]! + 1;
      while (next === skip1 || next === skip2) next++;
      const maxForPos = n - (need - 1 - j);
      if (next <= maxForPos) {
        indices[j] = next;
        // Cascade: fill subsequent positions
        for (let kk = j + 1; kk < need; kk++) {
          let v = indices[kk - 1]! + 1;
          while (v === skip1 || v === skip2) v++;
          indices[kk] = v;
        }
        break;
      }
      j--;
    }
    if (j < 0) break;
  }
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let c = 1;
  for (let i = 0; i < k; i++) {
    c = (c * (n - i)) / (i + 1);
  }
  return Math.round(c);
}

// ═══════════════════════════════════════════════════════════════════════
// Smart dispatcher
// ═══════════════════════════════════════════════════════════════════════

/**
 * Prefer exact enumeration when it's cheap, fall back to Monte-Carlo.
 * Returns equity in [0..1] — convenience for callers that don't need
 * the full breakdown.
 */
export function equity(
  hero: readonly [Card, Card],
  board: readonly Card[] = [],
  opts: { samples?: number; villains?: number; rng?: Rng } = {},
): number {
  const villains = opts.villains ?? 1;
  // Enum is only viable for 1 villain AND when deck combos < cap.
  if (villains === 1) {
    try {
      return equityEnum(hero, board, { villains, maxCombos: 50_000 }).equity;
    } catch { /* fall through */ }
  }
  return equityMonte(hero, board, opts).equity;
}
