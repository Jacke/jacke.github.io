import type { Card, Rank, Suit, GameVariant } from './types.js';

export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];
export const RANKS: readonly Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A',
];

// Ranks for Short Deck (6+) - removes 2-5
export const SHORT_DECK_RANKS: readonly Rank[] = [
  '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A',
];

// Ranks for Royal Hold'em - only T-A
export const ROYAL_RANKS: readonly Rank[] = [
  'T', 'J', 'Q', 'K', 'A',
];

export const RANK_VAL: Readonly<Record<Rank, number>> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

// Short deck rank values - A is still 14, but 6 is now lowest
export const SHORT_DECK_RANK_VAL: Readonly<Record<Rank, number>> = {
  '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

export const SUIT_SYMBOL: Readonly<Record<Suit, string>> = {
  s: '\u2660', h: '\u2665', d: '\u2666', c: '\u2663',
};

export const SUIT_CLASS: Readonly<Record<Suit, 'red-suit' | 'black-suit'>> = {
  s: 'black-suit', h: 'red-suit', d: 'red-suit', c: 'black-suit',
};

/** Rank character (first char of card string). */
export function rankChar(card: Card): Rank {
  return card[0] as Rank;
}

/** Suit character (second char of card string). */
export function suitChar(card: Card): Suit {
  return card[1] as Suit;
}

/** 
 * Get numeric rank value - respects game variant 
 * @param card The card string
 * @param variant The game variant (use short deck ranks for shortdeck)
 */
export function getRankValue(card: Card, variant: GameVariant = 'holdem'): number {
  if (variant === 'shortdeck') {
    return shortDeckRankOf(card);
  }
  return rankOf(card);
}

/** Check if a card is valid for a given variant */
export function isValidCard(card: Card, variant: GameVariant = 'holdem'): boolean {
  const r = rankChar(card);
  const s = suitChar(card);
  
  if (!SUITS.includes(s)) return false;
  
  if (variant === 'shortdeck') {
    return SHORT_DECK_RANKS.includes(r);
  }
  return RANKS.includes(r);
}

/** Numeric rank value (A = 14). Uses standard values by default. */
export function rankOf(card: Card): number {
  return RANK_VAL[rankChar(card)];
}

/** Numeric rank value for Short Deck - 6 is lowest (value 6), A is highest (14) */
export function shortDeckRankOf(card: Card): number {
  return SHORT_DECK_RANK_VAL[rankChar(card)];
}

/** Suit char of a card. Alias kept for parity with inline JS. */
export function suitOf(card: Card): Suit {
  return suitChar(card);
}

/** Create a fresh 52-card deck in canonical order. */
export function makeDeck(): Card[] {
  return makeVariantDeck('holdem');
}

/** Create a deck based on game variant */
export function makeVariantDeck(variant: GameVariant): Card[] {
  const deck: Card[] = [];
  let ranks: readonly Rank[];

  switch (variant) {
    case 'shortdeck':
      ranks = SHORT_DECK_RANKS;
      break;
    case 'holdem':
    case 'omaha':
    case 'pineapple':
    case 'crazypineapple':
    case 'irish':
    default:
      ranks = RANKS;
      break;
  }

  for (const s of SUITS) {
    for (const r of ranks) {
      deck.push(r + s);
    }
  }
  return deck;
}

/** Get deck size for a variant */
export function getDeckSize(variant: GameVariant): number {
  switch (variant) {
    case 'shortdeck':
      return 36; // 9 ranks * 4 suits
    default:
      return 52;
  }
}

/**
 * Simple seedable RNG — mulberry32. Used to make shuffles deterministic in tests.
 * Do NOT use Math.random from engine code; pass an RNG through so engine tests are reproducible.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function rand(): number {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Default RNG: Math.random. */
export const defaultRng: Rng = () => Math.random();

/**
 * Fisher-Yates shuffle. Returns a NEW array; does not mutate input.
 * Takes an optional RNG so tests can seed it.
 */
export function shuffle<T>(input: readonly T[], rng: Rng = defaultRng): T[] {
  const a = input.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/** Generate a 6-char alphanumeric room ID. */
export function genRoomId(rng: Rng = defaultRng): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(rng() * chars.length)];
  }
  return out;
}
