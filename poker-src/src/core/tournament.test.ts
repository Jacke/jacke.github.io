import { describe, it, expect } from 'vitest';
import {
  TURBO_STRUCTURE,
  STANDARD_STRUCTURE,
  DEEPSTACK_STRUCTURE,
  STRUCTURES,
  createTournament,
  currentBlinds,
  onHandComplete,
  eliminate,
  defaultPayouts,
  icmEquity,
  aliveSeats,
} from './tournament.js';
import { createGameState, dealHand } from './engine.js';
import { makeDeck, shuffle, mulberry32 } from './cards.js';

describe('blind structures', () => {
  it('turbo escalates faster than standard', () => {
    const tLast = TURBO_STRUCTURE.levels[TURBO_STRUCTURE.levels.length - 1]!;
    const sLast = STANDARD_STRUCTURE.levels[STANDARD_STRUCTURE.levels.length - 1]!;
    // Turbo's final BB should be at least similar to or greater than standard's
    // relative to starting stack (turbo runs out in fewer hands).
    expect(tLast.bb / TURBO_STRUCTURE.startingStack)
      .toBeGreaterThan(sLast.bb / STANDARD_STRUCTURE.startingStack);
  });

  it('deepstack starts with deeper stack', () => {
    expect(DEEPSTACK_STRUCTURE.startingStack).toBeGreaterThan(STANDARD_STRUCTURE.startingStack);
    expect(STANDARD_STRUCTURE.startingStack).toBeGreaterThan(TURBO_STRUCTURE.startingStack);
  });

  it('blinds strictly non-decreasing inside every structure', () => {
    for (const key of Object.keys(STRUCTURES)) {
      const s = STRUCTURES[key]!;
      for (let i = 1; i < s.levels.length; i++) {
        expect(s.levels[i]!.bb).toBeGreaterThanOrEqual(s.levels[i - 1]!.bb);
      }
    }
  });

  it('every structure has a positive ante in the later levels', () => {
    for (const key of Object.keys(STRUCTURES)) {
      const s = STRUCTURES[key]!;
      const lateAnte = s.levels[s.levels.length - 1]!.ante;
      expect(lateAnte).toBeGreaterThan(0);
    }
  });
});

describe('tournament state progression', () => {
  it('starts at level 1', () => {
    const t = createTournament(TURBO_STRUCTURE);
    expect(t.currentLevel).toBe(1);
    expect(currentBlinds(t).level).toBe(1);
    expect(t.totalHands).toBe(0);
  });

  it('advances to next level after handsPerLevel hands', () => {
    const t = createTournament(TURBO_STRUCTURE);
    const hands = TURBO_STRUCTURE.levels[0]!.handsPerLevel;
    for (let h = 0; h < hands - 1; h++) onHandComplete(t);
    expect(t.currentLevel).toBe(1);
    onHandComplete(t);
    expect(t.currentLevel).toBe(2);
    expect(t.handsAtLevel).toBe(0);
  });

  it('does not advance past the final level', () => {
    const t = createTournament(TURBO_STRUCTURE);
    const totalLevels = TURBO_STRUCTURE.levels.length;
    const perLevel = TURBO_STRUCTURE.levels[0]!.handsPerLevel;
    // Blast through way more hands than the schedule supports.
    for (let h = 0; h < totalLevels * perLevel * 3; h++) onHandComplete(t);
    expect(t.currentLevel).toBe(totalLevels);
  });

  it('eliminate() records bust-out order without duplicates', () => {
    const t = createTournament(TURBO_STRUCTURE);
    eliminate(t, 3);
    eliminate(t, 1);
    eliminate(t, 3); // duplicate — ignored
    expect(t.eliminated).toEqual([3, 1]);
  });
});

describe('defaultPayouts', () => {
  it('sums to the prize pool', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const pool = 30000;
      const pays = defaultPayouts(pool, n);
      expect(pays.reduce((a, b) => a + b, 0)).toBe(pool);
    }
  });

  it('winner-takes-all for n=1', () => {
    const pays = defaultPayouts(1000, 1);
    expect(pays).toEqual([1000]);
  });

  it('65/35 for heads-up payout', () => {
    const pays = defaultPayouts(1000, 2);
    expect(pays[0]).toBe(650);
    expect(pays[1]).toBe(350);
  });

  it('is monotonically non-increasing', () => {
    const pays = defaultPayouts(50000, 6);
    for (let i = 1; i < pays.length; i++) {
      expect(pays[i - 1]!).toBeGreaterThanOrEqual(pays[i]!);
    }
  });
});

describe('ICM equity', () => {
  it('heads-up: equity proportional to chip stack when payouts are flat', () => {
    // With a flat [100] payout, equity is just chip share.
    const eq = icmEquity([600, 400], [100]);
    expect(eq[0]).toBeCloseTo(60, 5);
    expect(eq[1]).toBeCloseTo(40, 5);
  });

  it('heads-up: second place gets second-place payout baseline', () => {
    // [100, 50] heads-up with equal stacks = each gets (100+50)/2 = 75.
    const eq = icmEquity([500, 500], [100, 50]);
    expect(eq[0]).toBeCloseTo(75, 5);
    expect(eq[1]).toBeCloseTo(75, 5);
  });

  it('three-way: total equity equals prize pool', () => {
    const eq = icmEquity([500, 300, 200], [50, 30, 20]);
    const sum = eq.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 5);
  });

  it('three-way: chip leader has highest equity', () => {
    const eq = icmEquity([5000, 3000, 2000], [50, 30, 20]);
    expect(eq[0]!).toBeGreaterThan(eq[1]!);
    expect(eq[1]!).toBeGreaterThan(eq[2]!);
  });

  it('ICM bounds the chip leader below their chip share', () => {
    // A big chip leader with 90% of chips only ever wins one first-place
    // payout — the rest of the pool is redistributed to short stacks via
    // the payout ladder. Seat 0 should be above the minimum cash and
    // above any single other seat, but below their raw 90% chip share.
    const eq = icmEquity([9000, 500, 500], [50, 30, 20]);
    expect(eq[0]!).toBeLessThan(90);      // below chip share — payout compression
    expect(eq[0]!).toBeGreaterThan(20);   // above min-cash
    expect(eq[0]!).toBeGreaterThan(eq[1]!);
    expect(eq[0]!).toBeGreaterThan(eq[2]!);
  });

  it('eliminated seats (stack 0) get 0 equity', () => {
    const eq = icmEquity([500, 0, 500], [60, 40]);
    expect(eq[1]).toBe(0);
    expect(eq[0]! + eq[2]!).toBeCloseTo(100, 5);
  });

  it('single survivor gets the whole prize pool', () => {
    const eq = icmEquity([1000, 0, 0], [50, 30, 20]);
    expect(eq[0]).toBe(100);
  });

  it('four-way equity sums to prize pool', () => {
    const eq = icmEquity([4000, 3000, 2000, 1000], [45, 27, 17, 11]);
    const sum = eq.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 5);
  });
});

describe('aliveSeats', () => {
  it('returns indices of non-busted seats', () => {
    expect(aliveSeats([100, 0, 200, 0, 50])).toEqual([0, 2, 4]);
  });
  it('empty when all busted', () => {
    expect(aliveSeats([0, 0, 0])).toEqual([]);
  });
});

describe('scripted tournament smoke test', () => {
  it('plays 50 hands and advances through several blind levels', () => {
    const t = createTournament(TURBO_STRUCTURE);
    const startingLevel = currentBlinds(t);
    for (let h = 0; h < 50; h++) onHandComplete(t);
    const lateLevel = currentBlinds(t);
    expect(t.totalHands).toBe(50);
    expect(lateLevel.bb).toBeGreaterThan(startingLevel.bb);
  });
});

describe('tournament blinds flow into dealHand', () => {
  it('engine uses state.blinds override instead of constants', () => {
    const t = createTournament(TURBO_STRUCTURE);
    const lvl = currentBlinds(t);
    const s = createGameState(2, 0, ['Alice', 'Bob']);
    s.blinds = { sb: lvl.sb, bb: lvl.bb, ante: lvl.ante };
    const deck = shuffle(makeDeck(), mulberry32(42));
    dealHand(s, deck);
    // In HU, button is SB.
    expect(s.bets[0]).toBe(lvl.sb);
    expect(s.bets[1]).toBe(lvl.bb);
  });

  it('ante is deducted from every seat before blinds', () => {
    const s = createGameState(3, 0, ['A', 'B', 'C']);
    const startingStack = s.chips[0]!;
    s.blinds = { sb: 50, bb: 100, ante: 10 };
    const deck = shuffle(makeDeck(), mulberry32(7));
    dealHand(s, deck);
    // Pot should include 3 antes + SB + BB = 30 + 50 + 100 = 180
    expect(s.pot).toBe(30 + 50 + 100);
    // Button seat (0) only paid the ante.
    expect(s.stacks[0]).toBe(startingStack - 10);
  });

  it('escalating blinds: later hand posts larger blinds', () => {
    const t = createTournament(TURBO_STRUCTURE);
    const early = currentBlinds(t);
    // Advance to a later level.
    for (let h = 0; h < TURBO_STRUCTURE.levels[0]!.handsPerLevel; h++) onHandComplete(t);
    const next = currentBlinds(t);
    expect(next.bb).toBeGreaterThan(early.bb);

    const s = createGameState(2, 0, ['A', 'B']);
    s.blinds = { sb: next.sb, bb: next.bb, ante: next.ante };
    const deck = shuffle(makeDeck(), mulberry32(1));
    dealHand(s, deck);
    expect(s.bets[1]).toBe(next.bb);
  });
});
