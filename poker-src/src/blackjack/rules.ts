/**
 * Blackjack rules — pure functions.
 *
 *  - Face cards (J/Q/K) count as 10.
 *  - Aces count as 11 unless that would bust, then 1 (we track "soft" vs "hard").
 *  - Blackjack = A + 10-value card on the initial 2 cards (NOT after a split ace).
 *  - Dealer plays fixed: stands on all 17 (S17) or hits soft 17 (H17). Configurable.
 */

import type { Card } from '../core/types.js';
import type { Hand } from './types.js';

/** Numeric rank value for a card. Returns 10 for T/J/Q/K, 11 for A. */
export function cardValue(card: Card): number {
  const r = card[0];
  if (r === 'A') return 11;
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
  return Number(r);
}

/**
 * Score a hand. Returns `{ total, soft }` where `soft` means at least one
 * ace is still being counted as 11 (so the hand can't bust on the next
 * card if it's ≤10).
 */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const v = cardValue(c);
    total += v;
    if (v === 11) aces++;
  }
  // Downgrade aces from 11 → 1 while we're over 21.
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

/** True if the 2 cards are a natural blackjack (ace + ten-value). */
export function isBlackjack(cards: readonly Card[]): boolean {
  if (cards.length !== 2) return false;
  const { total } = handValue(cards);
  return total === 21;
}

/** True if the hand busted (> 21). */
export function isBust(cards: readonly Card[]): boolean {
  return handValue(cards).total > 21;
}

/** Can we double down? Only on initial 2 cards, not after a split ace. */
export function canDouble(hand: Hand, chips: number): boolean {
  return hand.cards.length === 2
    && !hand.fromSplitAce
    && !hand.done
    && !hand.doubled
    && chips >= hand.bet;
}

/** Can we split? Two cards of the same rank (or any two 10-value cards). */
export function canSplit(hand: Hand, chips: number, currentHandCount: number): boolean {
  if (hand.cards.length !== 2) return false;
  if (hand.done) return false;
  if (currentHandCount >= 4) return false; // max 4 hands
  if (chips < hand.bet) return false;
  const v1 = cardValue(hand.cards[0]!);
  const v2 = cardValue(hand.cards[1]!);
  return v1 === v2;
}

/** Can we surrender? Only before any other action on the initial 2 cards. */
export function canSurrender(hand: Hand, handsTotal: number): boolean {
  return hand.cards.length === 2
    && !hand.done
    && !hand.doubled
    && handsTotal === 1; // no surrender after a split
}

/**
 * Dealer decision: returns true if the dealer should hit again.
 * With S17, dealer stands on all 17 including soft 17.
 * With H17, dealer hits soft 17.
 */
export function dealerShouldHit(cards: readonly Card[], standOnSoft17: boolean): boolean {
  const { total, soft } = handValue(cards);
  if (total < 17) return true;
  if (total === 17 && soft && !standOnSoft17) return true; // H17 rule
  return false;
}
