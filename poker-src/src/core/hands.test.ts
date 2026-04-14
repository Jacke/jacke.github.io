import { describe, it, expect } from 'vitest';
import { eval5, handName, bestHand, classify5 } from './hands.js';

// ═══════════════════════════════════════════════════════════════════════
// Category detection
// ═══════════════════════════════════════════════════════════════════════

describe('classify5', () => {
  it('detects royal flush', () => {
    expect(classify5(['As', 'Ks', 'Qs', 'Js', 'Ts']).category).toBe(8);
    expect(handName(['As', 'Ks', 'Qs', 'Js', 'Ts'])).toBe('Royal Flush');
  });

  it('detects straight flush (non-royal)', () => {
    expect(classify5(['9s', '8s', '7s', '6s', '5s']).category).toBe(8);
    expect(handName(['9s', '8s', '7s', '6s', '5s'])).toBe('Straight Flush, Nine-high');
  });

  it('detects wheel straight flush (5-high)', () => {
    const c = classify5(['As', '2s', '3s', '4s', '5s']);
    expect(c.category).toBe(8);
    expect(c.straightHigh).toBe(5);
    expect(handName(['As', '2s', '3s', '4s', '5s'])).toBe('Straight Flush, Five-high');
  });

  it('detects four of a kind', () => {
    expect(classify5(['As', 'Ah', 'Ad', 'Ac', 'Kh']).category).toBe(7);
  });

  it('detects full house', () => {
    expect(classify5(['Ks', 'Kh', 'Kd', '3c', '3h']).category).toBe(6);
  });

  it('detects flush', () => {
    expect(classify5(['As', 'Js', '9s', '7s', '3s']).category).toBe(5);
  });

  it('detects straight', () => {
    expect(classify5(['9s', '8h', '7d', '6c', '5s']).category).toBe(4);
  });

  it('detects wheel straight (5-high)', () => {
    const c = classify5(['As', '2h', '3d', '4c', '5s']);
    expect(c.category).toBe(4);
    expect(c.straightHigh).toBe(5);
  });

  it('detects three of a kind', () => {
    expect(classify5(['Qs', 'Qh', 'Qd', '5c', '2s']).category).toBe(3);
  });

  it('detects two pair', () => {
    expect(classify5(['Ks', 'Kh', '7d', '7c', '2s']).category).toBe(2);
  });

  it('detects pair', () => {
    expect(classify5(['9s', '9h', 'Kd', '7c', '3s']).category).toBe(1);
  });

  it('detects high card', () => {
    expect(classify5(['As', 'Jh', '9d', '7c', '3s']).category).toBe(0);
  });

  it('does not detect Q-K-A-2-3 as a straight', () => {
    expect(classify5(['As', '2h', '3d', 'Qc', 'Ks']).category).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Comparison (eval5 score ordering)
// ═══════════════════════════════════════════════════════════════════════

describe('eval5 ordering', () => {
  it('ranks categories correctly', () => {
    const royal = eval5(['As', 'Ks', 'Qs', 'Js', 'Ts']);
    const quads = eval5(['As', 'Ah', 'Ad', 'Ac', 'Kh']);
    const boat  = eval5(['Ks', 'Kh', 'Kd', 'Qc', 'Qh']);
    const flush = eval5(['As', 'Js', '9s', '7s', '3s']);
    const str   = eval5(['9s', '8h', '7d', '6c', '5s']);
    const trips = eval5(['Qs', 'Qh', 'Qd', '5c', '2s']);
    const tp    = eval5(['Ks', 'Kh', '7d', '7c', '2s']);
    const pair  = eval5(['9s', '9h', 'Kd', '7c', '3s']);
    const hc    = eval5(['As', 'Jh', '9d', '7c', '3s']);
    expect(royal).toBeGreaterThan(quads);
    expect(quads).toBeGreaterThan(boat);
    expect(boat).toBeGreaterThan(flush);
    expect(flush).toBeGreaterThan(str);
    expect(str).toBeGreaterThan(trips);
    expect(trips).toBeGreaterThan(tp);
    expect(tp).toBeGreaterThan(pair);
    expect(pair).toBeGreaterThan(hc);
  });

  it('higher kicker wins within same category (pair)', () => {
    // Both pair of 9s, A kicker vs K kicker
    const a = eval5(['9s', '9h', 'As', '7c', '3s']);
    const b = eval5(['9s', '9h', 'Kd', '7c', '3s']);
    expect(a).toBeGreaterThan(b);
  });

  it('higher pair wins over lower pair', () => {
    const kings = eval5(['Ks', 'Kh', '2d', '3c', '4s']);
    const queens = eval5(['Qs', 'Qh', 'Ad', 'Kc', 'Js']);
    expect(kings).toBeGreaterThan(queens);
  });

  it('higher two pair wins', () => {
    const aKings = eval5(['As', 'Ah', 'Ks', 'Kh', '2c']);
    const aQueens = eval5(['As', 'Ah', 'Qs', 'Qh', 'Kc']);
    expect(aKings).toBeGreaterThan(aQueens);
  });

  it('wheel straight loses to 6-high straight', () => {
    const wheel = eval5(['As', '2h', '3d', '4c', '5s']);
    const six = eval5(['2s', '3h', '4d', '5c', '6s']);
    expect(six).toBeGreaterThan(wheel);
  });

  it('wheel straight beats high-card Ace', () => {
    const wheel = eval5(['As', '2h', '3d', '4c', '5s']);
    const hc = eval5(['As', 'Kh', '9d', '7c', '3s']);
    expect(wheel).toBeGreaterThan(hc);
  });

  it('identical hands tie', () => {
    const a = eval5(['As', 'Ah', 'Ks', 'Kh', 'Qd']);
    const b = eval5(['Ad', 'Ac', 'Kd', 'Kc', 'Qs']);
    expect(a).toBe(b);
  });

  it('higher flush wins on top card', () => {
    const aHigh = eval5(['As', 'Ts', '7s', '5s', '3s']);
    const kHigh = eval5(['Ks', 'Qs', 'Js', '9s', '2s']);
    expect(aHigh).toBeGreaterThan(kHigh);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// bestHand over 7 cards
// ═══════════════════════════════════════════════════════════════════════

describe('bestHand', () => {
  it('picks the flush from 7 cards when 5 match', () => {
    // 5 hearts + 2 random
    const r = bestHand(['Ah', 'Qh', '9h', '7h', '3h', '2s', '5c']);
    expect(r.category).toBe(5);
    expect(r.cards.every(c => c[1] === 'h')).toBe(true);
  });

  it('picks quads over trips+pair', () => {
    const r = bestHand(['As', 'Ah', 'Ad', 'Ac', 'Ks', 'Kh', '2d']);
    expect(r.category).toBe(7);
    expect(r.name).toContain('Four of a Kind');
  });

  it('picks straight from scattered cards', () => {
    const r = bestHand(['2s', '3h', '4d', '5c', '6s', 'Kh', 'Qd']);
    expect(r.category).toBe(4);
    expect(r.name).toBe('Straight, Six-high');
  });

  it('picks wheel straight when present', () => {
    const r = bestHand(['As', '2h', '3d', '4c', '5s', 'Kh', 'Qd']);
    expect(r.category).toBe(4);
    expect(r.name).toBe('Straight, Five-high');
  });

  it('royal flush beats everything', () => {
    const r = bestHand(['As', 'Ks', 'Qs', 'Js', 'Ts', 'Ah', 'Ad']);
    expect(r.category).toBe(8);
    expect(r.name).toBe('Royal Flush');
  });

  it('picks best two pair from three pairs in 7 cards', () => {
    // With AA, KK, QQ in 7 cards, best 5 = AA KK Q (two pair, aces and kings).
    const r = bestHand(['As', 'Ah', 'Ks', 'Kh', 'Qs', 'Qh', '2d']);
    expect(r.category).toBe(2);
    expect(r.name).toContain('Aces and Kings');
  });
});
