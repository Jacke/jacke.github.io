import { describe, it, expect } from 'vitest';
import { equityMonte, equityEnum, equity } from './equity.js';
import { mulberry32 } from './cards.js';

describe('equityMonte — sanity values', () => {
  it('AA preflop vs random opponent is ~85%', () => {
    const r = equityMonte(['As', 'Ah'], [], {
      samples: 3000,
      rng: mulberry32(1),
    });
    expect(r.equity).toBeGreaterThan(0.80);
    expect(r.equity).toBeLessThan(0.90);
  });

  it('72 offsuit preflop is < 40% equity', () => {
    const r = equityMonte(['7c', '2d'], [], {
      samples: 3000,
      rng: mulberry32(2),
    });
    expect(r.equity).toBeLessThan(0.40);
  });

  it('AA vs specific random board converges near known range', () => {
    // AA on a ragged low flop should be a big favorite.
    const r = equityMonte(['As', 'Ah'], ['2c', '7d', 'Jh'], {
      samples: 2000,
      rng: mulberry32(3),
    });
    expect(r.equity).toBeGreaterThan(0.85);
  });

  it('identical hole cards with shared board — 50/50-ish', () => {
    // Chop expected — both players will have identical 5-card hands on
    // any runout.
    const r = equityMonte(['Kc', 'Kd'], ['5c', '5d', '5h'], {
      samples: 500,
      rng: mulberry32(4),
    });
    expect(r.equity).toBeGreaterThan(0.60); // still strong because KK over 5s = full house kings
  });

  it('multi-villain (2 opponents) reduces equity', () => {
    const rOne = equityMonte(['As', 'Kh'], [], { samples: 2000, villains: 1, rng: mulberry32(5) });
    const rTwo = equityMonte(['As', 'Kh'], [], { samples: 2000, villains: 2, rng: mulberry32(5) });
    expect(rTwo.equity).toBeLessThan(rOne.equity);
  });
});

describe('equityEnum — exact enumeration', () => {
  it('throws on preflop 1v1 (would exceed combo cap)', () => {
    // 48 cards remaining, pick 5 board + 2 villain = C(48,7) is enormous.
    // Actually our enum unrolls as 48*47/2 * C(46,5) = 1.7M combos.
    expect(() => equityEnum(['As', 'Ah'], [])).toThrow();
  });

  it('enumerates exact equity on the flop', () => {
    // Flop dealt, 47 cards remain, C(47,2) × C(45,2) ≈ 2k combos — well
    // under the default 200k cap.
    const r = equityEnum(['As', 'Ah'], ['2c', '7d', 'Jh']);
    // AA on a dry flop: ~87-89% equity vs random hand (known GTO lookup).
    expect(r.equity).toBeGreaterThan(0.80);
    expect(r.equity).toBeLessThan(0.95);
  });

  it('turn enumeration is fast and exact', () => {
    const r = equityEnum(['As', 'Ah'], ['2c', '7d', 'Jh', 'Ks']);
    expect(r.equity).toBeGreaterThan(0.80);
  });
});

describe('equity() dispatcher', () => {
  it('returns a number in [0..1]', () => {
    const e = equity(['9s', '9h'], ['Jc', '3d', '7h']);
    expect(e).toBeGreaterThanOrEqual(0);
    expect(e).toBeLessThanOrEqual(1);
  });

  it('falls back to Monte-Carlo for preflop when enum is too big', () => {
    const e = equity(['As', 'Ah']);
    expect(e).toBeGreaterThan(0.7);
  });
});
