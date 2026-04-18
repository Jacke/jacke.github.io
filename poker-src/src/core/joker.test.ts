/**
 * Joker Hold'em tests — deck, evaluation, five-of-a-kind.
 */

import { describe, it, expect } from 'vitest';
import { makeVariantDeck, getDeckSize, isJoker, JOKER } from './cards.js';
import { bestHand, HAND_NAMES } from './hands.js';

describe('Joker deck', () => {
  it('contains 53 cards including one joker', () => {
    const deck = makeVariantDeck('joker');
    expect(deck).toHaveLength(53);
    expect(getDeckSize('joker')).toBe(53);
    expect(deck.filter(isJoker)).toHaveLength(1);
    expect(deck[52]).toBe(JOKER);
  });
});

describe('Joker hand evaluation', () => {
  it('joker upgrades a pair to three-of-a-kind', () => {
    // Ah Ac JK 7d 3s — joker acts as third ace
    const hand = bestHand(['Ah', 'Ac', JOKER, '7d', '3s'], 'joker');
    expect(hand.category).toBe(3); // three of a kind
    expect(hand.name).toContain('Three of a Kind');
  });

  it('joker completes a straight', () => {
    // 8h 7c 6d JK 4s — joker fills 5 → 4-5-6-7-8 straight
    const hand = bestHand(['8h', '7c', '6d', JOKER, '4s'], 'joker');
    expect(hand.category).toBe(4); // straight
    expect(hand.name).toContain('Straight');
  });

  it('joker completes a flush', () => {
    // Ah Kh 9h 3h JK — joker acts as any heart
    const hand = bestHand(['Ah', 'Kh', '9h', '3h', JOKER], 'joker');
    expect(hand.category).toBeGreaterThanOrEqual(5); // flush or better
  });

  it('joker upgrades trips to four-of-a-kind', () => {
    // Kh Kd Kc JK 5s — joker as fourth king
    const hand = bestHand(['Kh', 'Kd', 'Kc', JOKER, '5s'], 'joker');
    expect(hand.category).toBe(7); // four of a kind
    expect(hand.name).toContain('Four of a Kind');
  });

  it('five-of-a-kind beats straight flush (7-card pool)', () => {
    // Four aces + joker in a 7-card pool → five of a kind
    const cards = ['Ah', 'As', 'Ad', 'Ac', JOKER, '2h', '3c'];
    const hand = bestHand(cards, 'joker');
    expect(hand.category).toBe(9); // five of a kind
    expect(hand.name).toContain('Five of a Kind');
    expect(hand.name).toContain('Ace');

    // Compare vs a royal flush (no joker)
    const royal = bestHand(['Ah', 'Kh', 'Qh', 'Jh', 'Th', '2c', '3d']);
    expect(hand.score).toBeGreaterThan(royal.score);
  });

  it('five-of-a-kind of kings < five-of-a-kind of aces', () => {
    const fiveKings = bestHand(['Kh', 'Ks', 'Kd', 'Kc', JOKER, '2h', '3c'], 'joker');
    const fiveAces = bestHand(['Ah', 'As', 'Ad', 'Ac', JOKER, '2h', '3c'], 'joker');
    expect(fiveKings.category).toBe(9);
    expect(fiveAces.category).toBe(9);
    expect(fiveAces.score).toBeGreaterThan(fiveKings.score);
  });

  it('no joker in pool evaluates normally', () => {
    const hand = bestHand(['Ah', 'Kh', 'Qh', 'Jh', 'Th', '2c', '3d'], 'joker');
    expect(hand.category).toBe(8); // straight flush
    expect(hand.name).toBe('Royal Flush');
  });

  it('HAND_NAMES includes Five of a Kind at index 9', () => {
    expect(HAND_NAMES[9]).toBe('Five of a Kind');
  });
});
