import { describe, it, expect } from 'vitest';
import type { Card, GameState } from './types.js';
import {
  applyAction, buildSidePots, createGameState, dealHand,
  finishToShowdown, nextStreet, startNextHand,
} from './engine.js';
import { makeDeck, mulberry32, shuffle } from './cards.js';
import { BB_AMOUNT, SB_AMOUNT, STARTING_STACK } from './rules.js';

// ═══════════════════════════════════════════════════════════════════════
// Test utilities
// ═══════════════════════════════════════════════════════════════════════

/** Place specific cards at specific deck slots and backfill the rest. */
function rigDeck(options: {
  hole?: (readonly [Card, Card] | undefined)[]; // by player index (SB order after rotation)
  flop?: [Card, Card, Card];
  turn?: Card;
  river?: Card;
  /** Seat layout is p0,p1,... with SB=button (HU) or SB=button+1 (3+). */
  numPlayers?: number;
  button?: number;
}): Card[] {
  const n = options.numPlayers ?? 2;
  const button = options.button ?? 0;
  const sb = n === 2 ? button : (button + 1) % n;

  const d = makeDeck();
  const used = new Set<Card>();
  const out: Card[] = new Array(52);
  const place = (i: number, c: Card) => {
    if (used.has(c)) throw new Error(`rigDeck: duplicate ${c}`);
    out[i] = c;
    used.add(c);
  };

  // Hole-card alternating deal: deck[k*n + step] → player (sb + step) % n on round k.
  if (options.hole) {
    for (let step = 0; step < n; step++) {
      const p = (sb + step) % n;
      const hole = options.hole[p];
      if (!hole) continue;
      place(step, hole[0]);
      place(n + step, hole[1]);
    }
  }

  // After hole cards (2n slots), community starts at 2n.
  const commStart = 2 * n;
  if (options.flop) {
    place(commStart, options.flop[0]);
    place(commStart + 1, options.flop[1]);
    place(commStart + 2, options.flop[2]);
  }
  if (options.turn) place(commStart + 3, options.turn);
  if (options.river) place(commStart + 4, options.river);

  let j = 0;
  for (let i = 0; i < 52; i++) {
    if (out[i]) continue;
    while (used.has(d[j]!)) j++;
    out[i] = d[j]!;
    used.add(d[j]!);
    j++;
  }
  return out;
}

/**
 * Build a rigged deck for the classic 2-player tests. Slot 0 = player 0 first
 * card, slot 1 = player 1 first card, slot 2/3 = second cards. This mirrors
 * the old test helper semantics, but routed through the multi-player rigger.
 *
 * NOTE: with the new multi-player engine, the SB is always the first to receive
 * a hole card. For HU (n=2) SB = button; if button=0, p0 (= SB) gets deck[0]
 * and deck[2], p1 (= BB) gets deck[1] and deck[3]. Same convention as before.
 */
function rigDeckHu(options: {
  p0?: [Card, Card];
  p1?: [Card, Card];
  flop?: [Card, Card, Card];
  turn?: Card;
  river?: Card;
}): Card[] {
  return rigDeck({
    numPlayers: 2,
    button: 0,
    hole: [options.p0, options.p1],
    flop: options.flop,
    turn: options.turn,
    river: options.river,
  });
}

function freshHu(button: 0 | 1 = 0): GameState {
  const s = createGameState(2, 0, ['You', 'Opp']);
  s.buttonIndex = button;
  return s;
}

// ═══════════════════════════════════════════════════════════════════════
// Deal + blinds (heads-up)
// ═══════════════════════════════════════════════════════════════════════

describe('dealHand (HU)', () => {
  it('posts blinds and sets acting player to SB (button)', () => {
    const s = freshHu(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(1)));
    expect(s.bets[0]).toBe(SB_AMOUNT);
    expect(s.bets[1]).toBe(BB_AMOUNT);
    expect(s.stacks[0]).toBe(STARTING_STACK - SB_AMOUNT);
    expect(s.stacks[1]).toBe(STARTING_STACK - BB_AMOUNT);
    expect(s.pot).toBe(SB_AMOUNT + BB_AMOUNT);
    expect(s.actingPlayer).toBe(0);
    expect(s.phase).toBe('preflop');
  });

  it('each player gets two hole cards', () => {
    const s = freshHu();
    dealHand(s, shuffle(makeDeck(), mulberry32(2)));
    expect(s.holeCards[0]).toHaveLength(2);
    expect(s.holeCards[1]).toHaveLength(2);
  });

  it('swaps blinds when button moves to player 1', () => {
    const s = freshHu(1);
    dealHand(s, shuffle(makeDeck(), mulberry32(3)));
    expect(s.bets[1]).toBe(SB_AMOUNT);
    expect(s.bets[0]).toBe(BB_AMOUNT);
    expect(s.actingPlayer).toBe(1);
  });

  it('throws on a non-52 deck', () => {
    const s = freshHu();
    expect(() => dealHand(s, ['As', 'Ks'])).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Scenario: preflop fold (HU)
// ═══════════════════════════════════════════════════════════════════════

describe('scenario: preflop fold', () => {
  it('button folds → BB wins SB', () => {
    const s = freshHu(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(10)));
    const r = applyAction(s, 0, { kind: 'fold' });
    expect(r.handEnded).toBe(true);
    expect(s.chips[1]).toBe(STARTING_STACK + SB_AMOUNT);
    expect(s.chips[0]).toBe(STARTING_STACK - SB_AMOUNT);
    expect(s.pot).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Scenario: limp-check to flop
// ═══════════════════════════════════════════════════════════════════════

describe('scenario: limp-check-check through to flop', () => {
  it('SB limps, BB checks → flop dealt, bets reset', () => {
    const s = freshHu(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(20)));

    applyAction(s, 0, { kind: 'call' });
    const r = applyAction(s, 1, { kind: 'check' });
    expect(r.roundClosed).toBe(true);

    nextStreet(s);
    expect(s.phase).toBe('flop');
    expect(s.community).toHaveLength(3);
    expect(s.bets).toEqual([0, 0]);
    expect(s.pot).toBe(2 * BB_AMOUNT);
    // Postflop: BB (non-button) acts first.
    expect(s.actingPlayer).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Scenario: preflop raise + call
// ═══════════════════════════════════════════════════════════════════════

describe('scenario: raise + call', () => {
  it('SB raises to 60, BB calls → stacks decrement, round closes', () => {
    const s = freshHu(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(30)));

    let r = applyAction(s, 0, { kind: 'raise', amount: 60 });
    expect(s.bets[0]).toBe(60);
    expect(s.stacks[0]).toBe(STARTING_STACK - 60);
    expect(r.roundClosed).toBe(false);
    expect(s.actingPlayer).toBe(1);

    r = applyAction(s, 1, { kind: 'call' });
    expect(s.bets).toEqual([60, 60]);
    expect(s.pot).toBe(120);
    expect(s.stacks[1]).toBe(STARTING_STACK - 60);
    expect(r.roundClosed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Scenario: BB option to raise
// ═══════════════════════════════════════════════════════════════════════

describe('scenario: BB option to raise after SB limp', () => {
  it('SB calls, BB raises, SB calls', () => {
    const s = freshHu(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(40)));

    applyAction(s, 0, { kind: 'call' });
    let r = applyAction(s, 1, { kind: 'raise', amount: 80 });
    expect(r.roundClosed).toBe(false);
    expect(s.actingPlayer).toBe(0);

    r = applyAction(s, 0, { kind: 'call' });
    expect(r.roundClosed).toBe(true);
    expect(s.bets).toEqual([80, 80]);
    expect(s.pot).toBe(160);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Scenario: all-in preflop → runs to showdown
// ═══════════════════════════════════════════════════════════════════════

describe('scenario: all-in preflop runs to showdown', () => {
  it('SB shoves, BB calls → board dealt, winner awarded', () => {
    const s = freshHu(0);
    const deck = rigDeckHu({
      p0: ['As', 'Ah'],
      p1: ['2c', '2d'],
      flop: ['Kc', '7d', '5h'],
      turn: '3c',
      river: '4s',
    });
    dealHand(s, deck);

    applyAction(s, 0, { kind: 'raise', amount: STARTING_STACK });
    expect(s.allIn[0]).toBe(true);

    const r = applyAction(s, 1, { kind: 'call' });
    expect(s.allIn[1]).toBe(true);
    expect(r.roundClosed).toBe(true);
    expect(r.handEnded).toBe(false);

    finishToShowdown(s);
    expect(s.community).toHaveLength(5);
    expect(s.phase).toBe('showdown');
    expect(s.chips[0]).toBe(2 * STARTING_STACK);
    expect(s.chips[1]).toBe(0);
    expect(s.gameOver).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Scenario: split pot
// ═══════════════════════════════════════════════════════════════════════

describe('scenario: split pot', () => {
  it('both make the same straight on the board → pot chopped', () => {
    const s = freshHu(0);
    const deck = rigDeckHu({
      p0: ['2c', '3d'],
      p1: ['2h', '3s'],
      flop: ['4c', '5d', '6h'],
      turn: '7s',
      river: '8c',
    });
    dealHand(s, deck);

    applyAction(s, 0, { kind: 'call' });
    applyAction(s, 1, { kind: 'check' });
    nextStreet(s);
    applyAction(s, 1, { kind: 'check' });
    applyAction(s, 0, { kind: 'check' });
    nextStreet(s);
    applyAction(s, 1, { kind: 'check' });
    applyAction(s, 0, { kind: 'check' });
    nextStreet(s);
    applyAction(s, 1, { kind: 'check' });
    applyAction(s, 0, { kind: 'check' });
    nextStreet(s);

    expect(s.phase).toBe('showdown');
    expect(s.chips[0]).toBe(STARTING_STACK);
    expect(s.chips[1]).toBe(STARTING_STACK);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Invariant: chip conservation
// ═══════════════════════════════════════════════════════════════════════

describe('invariant: chip conservation', () => {
  it('total chips remain 2 * STARTING_STACK across any HU hand', () => {
    const s = freshHu(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(99)));
    applyAction(s, 0, { kind: 'call' });
    applyAction(s, 1, { kind: 'raise', amount: 60 });
    applyAction(s, 0, { kind: 'call' });
    nextStreet(s);
    applyAction(s, 1, { kind: 'check' });
    applyAction(s, 0, { kind: 'raise', amount: 100 });
    applyAction(s, 1, { kind: 'call' });
    nextStreet(s);
    applyAction(s, 1, { kind: 'check' });
    applyAction(s, 0, { kind: 'check' });
    nextStreet(s);
    applyAction(s, 1, { kind: 'check' });
    applyAction(s, 0, { kind: 'check' });
    nextStreet(s);

    const total = s.chips[0]! + s.chips[1]! + s.pot;
    expect(total).toBe(2 * STARTING_STACK);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// startNextHand
// ═══════════════════════════════════════════════════════════════════════

describe('startNextHand (HU)', () => {
  it('alternates the button', () => {
    const s = freshHu(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(5)));
    applyAction(s, 0, { kind: 'fold' });
    expect(s.buttonIndex).toBe(0);
    startNextHand(s);
    expect(s.buttonIndex).toBe(1);
    startNextHand(s);
    expect(s.buttonIndex).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Illegal actions
// ═══════════════════════════════════════════════════════════════════════

describe('illegal actions', () => {
  it('throws if the wrong player acts', () => {
    const s = freshHu(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(11)));
    expect(() => applyAction(s, 1, { kind: 'check' })).toThrow();
  });

  it('throws on check when facing a bet', () => {
    const s = freshHu(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(12)));
    expect(() => applyAction(s, 0, { kind: 'check' })).toThrow();
  });

  it('throws on raise that does not exceed current bet', () => {
    const s = freshHu(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(13)));
    expect(() => applyAction(s, 0, { kind: 'raise', amount: 10 })).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Multi-player (3+) scenarios
// ═══════════════════════════════════════════════════════════════════════

describe('3-player scenarios', () => {
  function fresh3(button = 0): GameState {
    const s = createGameState(3, 0, ['A', 'B', 'C']);
    s.buttonIndex = button;
    return s;
  }

  it('posts SB/BB by position and UTG acts first', () => {
    const s = fresh3(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(41)));
    // button=0 → SB=1, BB=2, UTG=0
    expect(s.bets[1]).toBe(SB_AMOUNT);
    expect(s.bets[2]).toBe(BB_AMOUNT);
    expect(s.actingPlayer).toBe(0);
  });

  it('limp-limp-check: all three see flop', () => {
    const s = fresh3(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(42)));
    applyAction(s, 0, { kind: 'call' }); // UTG limps
    applyAction(s, 1, { kind: 'call' }); // SB completes
    const r = applyAction(s, 2, { kind: 'check' }); // BB checks
    expect(r.roundClosed).toBe(true);
    nextStreet(s);
    expect(s.phase).toBe('flop');
    // Postflop: first alive after button = SB = 1
    expect(s.actingPlayer).toBe(1);
  });

  it('UTG raise, SB folds, BB calls', () => {
    const s = fresh3(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(43)));
    applyAction(s, 0, { kind: 'raise', amount: 60 });
    applyAction(s, 1, { kind: 'fold' });
    const r = applyAction(s, 2, { kind: 'call' });
    expect(r.roundClosed).toBe(true);
    expect(s.folded[1]).toBe(true);
    expect(s.bets[0]).toBe(60);
    expect(s.bets[2]).toBe(60);
  });

  it('fold to one remaining player awards the pot immediately', () => {
    const s = fresh3(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(44)));
    applyAction(s, 0, { kind: 'raise', amount: 200 });
    applyAction(s, 1, { kind: 'fold' });
    const r = applyAction(s, 2, { kind: 'fold' });
    expect(r.handEnded).toBe(true);
    expect(s.chips[0]).toBe(STARTING_STACK + SB_AMOUNT + BB_AMOUNT);
  });

  it('invariant: 3 * STARTING_STACK preserved across any 3-player hand', () => {
    const s = fresh3(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(45)));
    applyAction(s, 0, { kind: 'raise', amount: 60 });
    applyAction(s, 1, { kind: 'call' });
    applyAction(s, 2, { kind: 'call' });
    nextStreet(s);
    applyAction(s, 1, { kind: 'check' });
    applyAction(s, 2, { kind: 'check' });
    applyAction(s, 0, { kind: 'check' });
    nextStreet(s);
    applyAction(s, 1, { kind: 'check' });
    applyAction(s, 2, { kind: 'check' });
    applyAction(s, 0, { kind: 'check' });
    nextStreet(s);
    applyAction(s, 1, { kind: 'check' });
    applyAction(s, 2, { kind: 'check' });
    applyAction(s, 0, { kind: 'check' });
    nextStreet(s); // showdown
    const total = s.chips[0]! + s.chips[1]! + s.chips[2]! + s.pot;
    expect(total).toBe(3 * STARTING_STACK);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Side pots
// ═══════════════════════════════════════════════════════════════════════

describe('buildSidePots', () => {
  it('single pot when all contributions equal', () => {
    const pots = buildSidePots([100, 100, 100], [false, false, false]);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(300);
    expect(pots[0]!.eligible.sort()).toEqual([0, 1, 2]);
  });

  it('two layers when one player is shorter all-in', () => {
    // A=100 all-in, B=300, C=300. Main pot = 300 (100×3), side pot = 400 (200×2).
    const pots = buildSidePots([100, 300, 300], [false, false, false]);
    expect(pots).toHaveLength(2);
    expect(pots[0]!.amount).toBe(300);
    expect(pots[0]!.eligible.sort()).toEqual([0, 1, 2]);
    expect(pots[1]!.amount).toBe(400);
    expect(pots[1]!.eligible.sort()).toEqual([1, 2]);
  });

  it('folded players contribute to pot but are ineligible', () => {
    // A=100 folded, B=200, C=200. Main pot = 300 (100×3), side = 200 (100×2) both between B/C.
    const pots = buildSidePots([100, 200, 200], [true, false, false]);
    // A's 100 contributes to pot[0] but A is not eligible. Merging happens if
    // eligible sets match across layers; here layer0 eligible={1,2} and layer1
    // eligible={1,2} — should merge into a single pot of 500.
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(500);
    expect(pots[0]!.eligible.sort()).toEqual([1, 2]);
  });
});
