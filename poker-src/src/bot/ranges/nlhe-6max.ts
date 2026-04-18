/**
 * Published-chart 6-max NLHE preflop opening ranges, by position.
 *
 * Derived from public GTO open charts (approximated — these aren't bit-exact
 * with any one published range but follow the consensus widely enough that
 * our bot plays recognisably solid preflop).
 *
 * Encoding uses the standard poker shorthand:
 *   'AA'  — pocket aces
 *   'AKs' — AK suited
 *   'AKo' — AK offsuit
 *   'T7o' — T7 offsuit
 *
 * To look up whether a hand should open-raise from a position:
 *   OPEN_RANGES['BTN'].has(canonicalHandCode('As', 'Ks'))  // → true
 */

import type { Card, GameState } from '../../core/types.js';

export type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';
export type HandCode = string;

const RANK_VAL: Readonly<Record<string, number>> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

const RANK_CHAR: ReadonlyArray<string> = ['', '', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

/** Canonicalize a pair of hole cards into 'AA' / 'AKs' / 'AKo' form. */
export function canonicalHand(c1: Card, c2: Card): HandCode {
  const r1 = c1[0] ?? '2';
  const r2 = c2[0] ?? '2';
  const s1 = c1[1];
  const s2 = c2[1];
  const v1 = RANK_VAL[r1] ?? 2;
  const v2 = RANK_VAL[r2] ?? 2;
  const [hi, lo] = v1 >= v2 ? [r1, r2] : [r2, r1];
  if (v1 === v2) return hi + lo; // pair
  const suited = s1 === s2;
  return hi + lo + (suited ? 's' : 'o');
}

/** True if position acts in the "last 3 seats" (late position). */
export function isLatePosition(pos: Position): boolean {
  return pos === 'CO' || pos === 'BTN' || pos === 'SB';
}

// ═══════════════════════════════════════════════════════════════════════
// Published opening ranges
// ═══════════════════════════════════════════════════════════════════════

// Small helper to expand rank-range notation like "22+" → ['22', '33', ..., 'AA']
function expandPairs(minRank: string): string[] {
  const min = RANK_VAL[minRank] ?? 2;
  const out: string[] = [];
  for (let r = min; r <= 14; r++) out.push(RANK_CHAR[r]! + RANK_CHAR[r]!);
  return out;
}

/** All AXs from A[minKicker]s up to AKs. */
function expandAxs(minKicker: string, hi: string = 'A'): string[] {
  const min = RANK_VAL[minKicker] ?? 2;
  const topVal = RANK_VAL[hi] ?? 14;
  const out: string[] = [];
  for (let r = min; r < topVal; r++) out.push(hi + RANK_CHAR[r]! + 's');
  return out;
}

function expandAxo(minKicker: string, hi: string = 'A'): string[] {
  const min = RANK_VAL[minKicker] ?? 2;
  const topVal = RANK_VAL[hi] ?? 14;
  const out: string[] = [];
  for (let r = min; r < topVal; r++) out.push(hi + RANK_CHAR[r]! + 'o');
  return out;
}

// UTG (~14%, tightest). Build procedurally.
const UTG: HandCode[] = [
  ...expandPairs('22'),         // 22+
  ...expandAxs('9'),            // A9s+
  ...expandAxo('T'),            // ATo+
  'KQs', 'KJs', 'KTs',
  'QJs', 'QTs',
  'JTs',
  'T9s', '98s', '87s', '76s', '65s',
  'KQo',
];

// MP / HJ (~18%)
const MP: HandCode[] = [
  ...UTG,
  'A8s', 'A7s', 'A6s', 'A5s',
  'K9s',
  'Q9s',
  'J9s',
  'T8s',
  'AJo', 'KJo',
];

// CO (~27%)
const CO: HandCode[] = [
  ...MP,
  ...expandAxs('2'),            // A2s-A8s already there, but cast net wider
  'K8s',
  'Q8s',
  'J8s',
  'T7s',
  '97s',
  '86s', '75s', '64s', '54s',
  'ATo', 'KTo', 'QTo', 'JTo',
];

// BTN (~45%, widest)
const BTN: HandCode[] = [
  ...CO,
  'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s',
  'Q7s', 'Q6s', 'Q5s', 'Q4s',
  'J7s', 'J6s',
  'T6s',
  '96s',
  '85s',
  '74s',
  '53s', '43s',
  ...expandAxo('2'),
  'K9o', 'K8o', 'K7o',
  'Q9o', 'Q8o',
  'J9o', 'J8o',
  'T9o', 'T8o',
  '98o', '97o',
  '87o', '76o',
];

// SB (~30%, tighter than BTN because OOP). We use BTN-like but remove some
// weak offsuit trash that doesn't realise equity OOP.
const SB: HandCode[] = [
  ...MP,
  'K8s', 'K7s',
  'Q8s', 'Q7s',
  'J8s',
  'T7s',
  '97s', '86s', '75s', '64s', '53s', '43s',
  'ATo', 'KTo', 'QTo', 'JTo', 'T9o',
];

// BB never opens (it's the forced blind) — defend range is separate.
const BB: HandCode[] = [];

export const OPEN_RANGES: Readonly<Record<Position, ReadonlySet<HandCode>>> = {
  UTG: new Set(UTG),
  MP: new Set(MP),
  CO: new Set(CO),
  BTN: new Set(BTN),
  SB: new Set(SB),
  BB: new Set(BB),
};

/** Is this hand in the open-raising range for the given position? */
export function inOpenRange(hand: HandCode, pos: Position): boolean {
  return OPEN_RANGES[pos]?.has(hand) ?? false;
}

// ═══════════════════════════════════════════════════════════════════════
// Position derivation from a GameState
// ═══════════════════════════════════════════════════════════════════════

/**
 * Figure out which labelled position a seat occupies in the current hand.
 * Labels are 6-max canonical: BTN, SB, BB, UTG, MP, CO.
 *
 * Heads-up: button is always SB (and acts first preflop); the other seat is BB.
 * 3-handed: BTN, SB, BB.
 * 4: add UTG in seat 3.
 * 5: add CO in seat 4.
 * 6: add MP in seat 4, CO in seat 5.
 */
export function getPosition(state: Pick<GameState, 'buttonIndex' | 'numPlayers'>, player: number): Position {
  const n = state.numPlayers;
  const btn = state.buttonIndex;
  const seatFromButton = (player - btn + n) % n;

  if (n === 2) {
    return seatFromButton === 0 ? 'SB' : 'BB';
  }
  if (n === 3) {
    return seatFromButton === 0 ? 'BTN' : seatFromButton === 1 ? 'SB' : 'BB';
  }
  if (n === 4) {
    if (seatFromButton === 0) return 'BTN';
    if (seatFromButton === 1) return 'SB';
    if (seatFromButton === 2) return 'BB';
    return 'UTG';
  }
  if (n === 5) {
    if (seatFromButton === 0) return 'BTN';
    if (seatFromButton === 1) return 'SB';
    if (seatFromButton === 2) return 'BB';
    if (seatFromButton === 3) return 'UTG';
    return 'CO';
  }
  // 6-max
  if (seatFromButton === 0) return 'BTN';
  if (seatFromButton === 1) return 'SB';
  if (seatFromButton === 2) return 'BB';
  if (seatFromButton === 3) return 'UTG';
  if (seatFromButton === 4) return 'MP';
  return 'CO';
}
