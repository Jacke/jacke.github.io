/**
 * Tournament engine — blind structures, level progression, ICM payouts.
 *
 * This module is pure logic. It does not mutate the poker `GameState`
 * directly; instead it yields blind amounts (`sb`, `bb`, `ante`) that the
 * caller uses when dealing the next hand. The UI layer wires it up so that
 * `dealHand()` is called after `tournament.onHandComplete()` returns.
 *
 * ICM (Independent Chip Model): given final stacks and the prize-pool payout
 * ladder, what fraction of the prize pool does each seat own "on average"
 * if play were to stop right now? We use Malmuth–Harville, the standard
 * recursive formula.
 */

// ═══════════════════════════════════════════════════════════════════════
// Blind structures
// ═══════════════════════════════════════════════════════════════════════

export interface BlindLevel {
  /** Level number, 1-indexed. */
  level: number;
  sb: number;
  bb: number;
  /** Per-seat ante contributed into the pot before the deal. 0 = none. */
  ante: number;
  /** How many hands to play at this level before escalating. */
  handsPerLevel: number;
}

export interface BlindStructure {
  name: string;
  startingStack: number;
  levels: BlindLevel[];
}

/**
 * Build a geometric blind escalation schedule.
 * At each level, SB/BB roughly double (Turbo) or grow ~1.5x (Standard).
 */
function buildLevels(
  base: [sb: number, bb: number],
  growth: number,
  count: number,
  handsPerLevel: number,
  anteStartLevel: number,
): BlindLevel[] {
  const levels: BlindLevel[] = [];
  let sb = base[0];
  let bb = base[1];
  for (let i = 1; i <= count; i++) {
    const ante = i >= anteStartLevel ? Math.max(1, Math.round(bb * 0.125)) : 0;
    levels.push({ level: i, sb, bb, ante, handsPerLevel });
    sb = Math.max(sb + 1, Math.round(sb * growth / 5) * 5);
    bb = sb * 2;
  }
  return levels;
}

export const TURBO_STRUCTURE: BlindStructure = {
  name: 'Turbo',
  startingStack: 1500,
  levels: buildLevels([10, 20], 1.75, 12, 6, 4),
};

export const STANDARD_STRUCTURE: BlindStructure = {
  name: 'Standard',
  startingStack: 3000,
  levels: buildLevels([10, 20], 1.5, 16, 10, 5),
};

export const DEEPSTACK_STRUCTURE: BlindStructure = {
  name: 'Deepstack',
  startingStack: 10000,
  levels: buildLevels([10, 20], 1.35, 24, 14, 6),
};

export const STRUCTURES: Readonly<Record<string, BlindStructure>> = {
  turbo: TURBO_STRUCTURE,
  standard: STANDARD_STRUCTURE,
  deepstack: DEEPSTACK_STRUCTURE,
};

// ═══════════════════════════════════════════════════════════════════════
// Tournament state
// ═══════════════════════════════════════════════════════════════════════

export interface TournamentState {
  structure: BlindStructure;
  /** Current blind level (1-indexed). */
  currentLevel: number;
  /** Number of hands played at the current level. */
  handsAtLevel: number;
  /** Total hands played in the tournament so far. */
  totalHands: number;
  /** Seats eliminated, in order of bust-out (last element = most recent bust). */
  eliminated: number[];
}

export function createTournament(structure: BlindStructure): TournamentState {
  return {
    structure,
    currentLevel: 1,
    handsAtLevel: 0,
    totalHands: 0,
    eliminated: [],
  };
}

/** Get the blind level object currently in effect. */
export function currentBlinds(t: TournamentState): BlindLevel {
  const idx = Math.min(t.currentLevel, t.structure.levels.length) - 1;
  return t.structure.levels[idx]!;
}

/**
 * Record that a hand has just completed. Advances the level counter if the
 * threshold is hit. Returns the new blind level (whether or not it changed).
 */
export function onHandComplete(t: TournamentState): BlindLevel {
  t.totalHands++;
  t.handsAtLevel++;
  const level = currentBlinds(t);
  if (t.handsAtLevel >= level.handsPerLevel && t.currentLevel < t.structure.levels.length) {
    t.currentLevel++;
    t.handsAtLevel = 0;
  }
  return currentBlinds(t);
}

/** Record an elimination. Ordering matters for payout ladder. */
export function eliminate(t: TournamentState, seatIdx: number): void {
  if (!t.eliminated.includes(seatIdx)) t.eliminated.push(seatIdx);
}

// ═══════════════════════════════════════════════════════════════════════
// Payout ladder
// ═══════════════════════════════════════════════════════════════════════

/**
 * Standard payout breakdown — cash-tournament flat model.
 * 1 player: winner gets 100%.
 * 2 players: 65/35.
 * 3 players: 50/30/20.
 * 4-6 players: 45/27/17/11 (+ 7/4/2 tail if longer).
 * Rounded so totals match the prize pool to the nearest chip.
 */
export function defaultPayouts(prizePool: number, numPaid: number): number[] {
  const PERCENT_TABLES: Record<number, number[]> = {
    1: [1.0],
    2: [0.65, 0.35],
    3: [0.5, 0.3, 0.2],
    4: [0.45, 0.27, 0.17, 0.11],
    5: [0.4, 0.25, 0.17, 0.11, 0.07],
    6: [0.38, 0.24, 0.16, 0.11, 0.07, 0.04],
  };
  const pct = PERCENT_TABLES[numPaid] ?? PERCENT_TABLES[6]!;
  const out = pct.map(p => Math.floor(prizePool * p));
  // Fix rounding drift — add the remainder to first place.
  const drift = prizePool - out.reduce((a, b) => a + b, 0);
  out[0] = (out[0] ?? 0) + drift;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// ICM — Malmuth–Harville recursion
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute each seat's expected share of the prize pool given current
 * chip stacks and the payout ladder.
 *
 * Payouts must be sorted high-to-low. `stacks[i]` is seat i's chip count;
 * seats with stack 0 are treated as already eliminated (they get nothing
 * from the remaining payouts).
 *
 * Malmuth–Harville core idea: the probability player i finishes in place k
 * is (stack_i / total) × (probability that, without i, the remaining field
 * finishes with the (k-1)'th place distribution). We memoize on the bitmask
 * of live seats — O(2^n × n^2). Fine for n ≤ 10.
 */
export function icmEquity(stacks: number[], payouts: number[]): number[] {
  const n = stacks.length;
  const live: number[] = [];
  for (let i = 0; i < n; i++) if (stacks[i]! > 0) live.push(i);
  const equities = new Array<number>(n).fill(0);
  if (live.length === 0 || payouts.length === 0) return equities;
  if (live.length === 1) {
    equities[live[0]!] = payouts.reduce((a, b) => a + b, 0);
    return equities;
  }

  // Memoized recursion keyed on (mask, placeIdx).
  // finishProb[mask][i] = probability seat i finishes first among seats in mask.
  // Then reward = payouts[placeIdx] × P(first) plus recursive call on
  // (mask - {i}, placeIdx + 1).
  const memo = new Map<number, number[]>();

  function recurse(mask: number, placeIdx: number): number[] {
    const key = (mask << 5) | placeIdx;
    const cached = memo.get(key);
    if (cached) return cached;

    const result = new Array<number>(n).fill(0);
    if (placeIdx >= payouts.length) { memo.set(key, result); return result; }

    // Sum of live stacks inside this mask.
    let total = 0;
    for (const i of live) {
      if ((mask >> i) & 1) total += stacks[i]!;
    }
    if (total === 0) { memo.set(key, result); return result; }

    const payout = payouts[placeIdx]!;
    for (const i of live) {
      if (!((mask >> i) & 1)) continue;
      const pFirst = stacks[i]! / total;
      result[i] = (result[i] ?? 0) + pFirst * payout;

      // Recurse with i removed.
      const nextMask = mask & ~(1 << i);
      const sub = recurse(nextMask, placeIdx + 1);
      for (const j of live) {
        if (j === i) continue;
        result[j] = (result[j] ?? 0) + pFirst * (sub[j] ?? 0);
      }
    }

    memo.set(key, result);
    return result;
  }

  let startMask = 0;
  for (const i of live) startMask |= (1 << i);
  return recurse(startMask, 0);
}

/**
 * Get seats that are still alive (stack > 0) — useful for the caller to
 * decide when the tournament is over.
 */
export function aliveSeats(stacks: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < stacks.length; i++) if (stacks[i]! > 0) out.push(i);
  return out;
}
