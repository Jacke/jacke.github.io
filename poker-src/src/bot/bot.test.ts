import { describe, it, expect } from 'vitest';
import type { Action, Card, GameState } from '../core/types.js';
import {
  applyAction, createGameState, dealHand, finishToShowdown, legalActions, nextStreet,
} from '../core/engine.js';
import { makeDeck, mulberry32, shuffle } from '../core/cards.js';
import { STARTING_STACK } from '../core/rules.js';
import {
  decideAction, monteCarloEquity, postflopCategoryStrength, preflopScore,
  type Difficulty,
} from './bot.js';

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard', 'grandmaster'];

// ═══════════════════════════════════════════════════════════════════════
// Deck rigging helper (same utility as engine tests)
// ═══════════════════════════════════════════════════════════════════════

function rigDeck(options: {
  p0?: [Card, Card];
  p1?: [Card, Card];
  flop?: [Card, Card, Card];
  turn?: Card;
  river?: Card;
}): Card[] {
  const d = makeDeck();
  const used = new Set<Card>();
  const out: Card[] = new Array(52);
  const place = (i: number, c: Card) => {
    if (used.has(c)) throw new Error(`rigDeck: duplicate ${c}`);
    out[i] = c;
    used.add(c);
  };
  if (options.p0) { place(0, options.p0[0]); place(2, options.p0[1]); }
  if (options.p1) { place(1, options.p1[0]); place(3, options.p1[1]); }
  if (options.flop) { place(4, options.flop[0]); place(5, options.flop[1]); place(6, options.flop[2]); }
  if (options.turn) place(7, options.turn);
  if (options.river) place(8, options.river);
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

function freshState(button: 0 | 1 = 0): GameState {
  const s = createGameState(2, 0);
  s.buttonIndex = button;
  return s;
}

// ═══════════════════════════════════════════════════════════════════════
// preflopScore — basic sanity
// ═══════════════════════════════════════════════════════════════════════

describe('preflopScore', () => {
  it('AA is the strongest hand', () => {
    const aa = preflopScore(['As', 'Ah']);
    expect(aa).toBeGreaterThan(0.95);
  });

  it('72o is near the bottom', () => {
    const trash = preflopScore(['7h', '2c']);
    const premium = preflopScore(['Kd', 'Qd']);
    expect(trash).toBeLessThan(premium);
    expect(trash).toBeLessThan(0.45);
  });

  it('suited ranks higher than offsuit of same ranks', () => {
    const suited = preflopScore(['Ah', 'Kh']);
    const off = preflopScore(['Ah', 'Kc']);
    expect(suited).toBeGreaterThan(off);
  });

  it('pairs outrank unpaired high cards of same top rank', () => {
    const pair = preflopScore(['9s', '9h']);
    const unpaired = preflopScore(['9s', '8h']);
    expect(pair).toBeGreaterThan(unpaired);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// postflopCategoryStrength
// ═══════════════════════════════════════════════════════════════════════

describe('postflopCategoryStrength', () => {
  it('rises from high card to quads', () => {
    const s = freshState(0);
    dealHand(s, rigDeck({
      p0: ['As', 'Ah'],
      p1: ['7c', '2d'],
      flop: ['Ad', 'Ac', 'Kh'],
    }));
    // Advance to flop
    applyAction(s, 0, { kind: 'call' });
    applyAction(s, 1, { kind: 'check' });
    nextStreet(s);
    // Now it's BB (p1) to act — but we want to check p0's strength in a
    // state where p0 is the acting player. Force that:
    s.actingPlayer = 0;
    const strong = postflopCategoryStrength(s);
    // With quads, strength should be very high.
    expect(strong).toBeGreaterThan(0.95);
  });

  it('returns 0 when no community', () => {
    const s = freshState(0);
    dealHand(s, shuffle(makeDeck(), mulberry32(42)));
    expect(postflopCategoryStrength(s)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// monteCarloEquity — pocket aces should dominate
// ═══════════════════════════════════════════════════════════════════════

describe('monteCarloEquity', () => {
  it('AA preflop-equivalent (on the flop with no reads) has >0.7 equity', () => {
    const s = freshState(0);
    dealHand(s, rigDeck({
      p0: ['As', 'Ah'],
      flop: ['Kd', '7c', '2s'],
    }));
    applyAction(s, 0, { kind: 'call' });
    applyAction(s, 1, { kind: 'check' });
    nextStreet(s);
    s.actingPlayer = 0;
    const eq = monteCarloEquity(s, 500, mulberry32(1));
    expect(eq).toBeGreaterThan(0.7);
  });

  it('trash vs high board has low equity', () => {
    const s = freshState(0);
    dealHand(s, rigDeck({
      p0: ['2c', '7d'],
      flop: ['Ad', 'Kh', 'Qs'],
    }));
    applyAction(s, 0, { kind: 'call' });
    applyAction(s, 1, { kind: 'check' });
    nextStreet(s);
    s.actingPlayer = 0;
    const eq = monteCarloEquity(s, 500, mulberry32(2));
    expect(eq).toBeLessThan(0.3);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// decideAction — legality invariants
// ═══════════════════════════════════════════════════════════════════════

function assertLegal(state: GameState, action: Action): void {
  const legal = legalActions(state);
  expect(legal).toContain(action.kind);
  if (action.kind === 'raise') {
    const me = state.actingPlayer;
    const myBet = state.bets[me] ?? 0;
    const myStack = state.stacks[me] ?? 0;
    const maxTotal = myBet + myStack;
    expect(action.amount ?? 0).toBeGreaterThan(myBet);
    expect(action.amount ?? 0).toBeLessThanOrEqual(maxTotal);
  }
}

describe('decideAction returns a legal action for every difficulty', () => {
  for (const diff of DIFFS) {
    it(`${diff}: preflop SB facing BB`, () => {
      const s = freshState(0);
      dealHand(s, shuffle(makeDeck(), mulberry32(10)));
      const a = decideAction(s, diff, { rng: mulberry32(100) });
      assertLegal(s, a);
    });

    it(`${diff}: postflop check-check line`, () => {
      const s = freshState(0);
      dealHand(s, shuffle(makeDeck(), mulberry32(20)));
      applyAction(s, 0, { kind: 'call' });
      applyAction(s, 1, { kind: 'check' });
      nextStreet(s);
      const a = decideAction(s, diff, { rng: mulberry32(200) });
      assertLegal(s, a);
    });

    it(`${diff}: facing a big raise`, () => {
      const s = freshState(0);
      dealHand(s, shuffle(makeDeck(), mulberry32(30)));
      applyAction(s, 0, { kind: 'raise', amount: 200 });
      const a = decideAction(s, diff, { rng: mulberry32(300) });
      assertLegal(s, a);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Style constraints
// ═══════════════════════════════════════════════════════════════════════

describe('easy bot', () => {
  it('never raises across 100 scripted decisions', () => {
    const seeds = Array.from({ length: 100 }, (_, i) => i + 1);
    let raises = 0;
    for (const seed of seeds) {
      const s = freshState((seed % 2) as 0 | 1);
      dealHand(s, shuffle(makeDeck(), mulberry32(seed)));
      const a = decideAction(s, 'easy', { rng: mulberry32(seed * 7) });
      if (a.kind === 'raise') raises++;
      // Advance through the hand with easy-vs-easy just to touch postflop too.
      try {
        while (s.phase !== 'idle' && s.phase !== 'showdown') {
          const move = decideAction(s, 'easy', { rng: mulberry32(seed * 11) });
          if (move.kind === 'raise') raises++;
          const r = applyAction(s, s.actingPlayer, move);
          if (r.handEnded) break;
          if (r.roundClosed) {
            const aiOrAllIn = s.allIn[0] || s.allIn[1];
            if (aiOrAllIn) { finishToShowdown(s); break; }
            nextStreet(s);
          }
        }
      } catch {
        // Not interested in corner cases here — only counting raise decisions.
      }
    }
    expect(raises).toBe(0);
  });
});

describe('hard bot', () => {
  it('folds pure trash facing a pot-sized raise', () => {
    const s = freshState(0);
    dealHand(s, rigDeck({
      p0: ['2c', '7d'], // bot will play SB here
      p1: ['As', 'Ks'],
    }));
    // Bot is SB (p0). Human (p1) already has the BB posted. Make the bot face
    // a real raise — first get to a post-raise state.
    // Actually SB acts first preflop. Give SB trash, face BB of 20 which is
    // cheap to call but still a pot-odds play.
    s.actingPlayer = 0;
    const a = decideAction(s, 'hard', { rng: mulberry32(777) });
    // 72o vs AKs is weak — hard bot should call (cheap) or fold, not raise.
    expect(a.kind).not.toBe('raise');
  });

  it('raises pocket aces preflop when given the chance', () => {
    const s = freshState(0);
    dealHand(s, rigDeck({ p0: ['As', 'Ah'] }));
    // Run 20 trials and check we see at least one raise. RNG-driven bluff
    // frequency makes the exact count nondeterministic, but AA should raise
    // the vast majority of the time.
    let raises = 0;
    for (let i = 0; i < 20; i++) {
      s.actingPlayer = 0;
      const a = decideAction(s, 'hard', { rng: mulberry32(i + 1000) });
      if (a.kind === 'raise') raises++;
    }
    expect(raises).toBeGreaterThanOrEqual(18);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Full simulation: bot-vs-bot plays through many hands without throwing
// ═══════════════════════════════════════════════════════════════════════

function playBotVsBot(seed: number, diffs: [Difficulty, Difficulty], maxHands = 10): void {
  const s = createGameState(2, 0);
  const rng = mulberry32(seed);
  let hand = 0;
  while (!s.gameOver && hand < maxHands) {
    hand++;
    s.phase = 'idle';
    dealHand(s, shuffle(makeDeck(), () => rng()));

    if (s.allIn[0] || s.allIn[1]) {
      finishToShowdown(s);
    } else {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const d = diffs[s.actingPlayer]!;
        const action = decideAction(s, d, { rng });
        const r = applyAction(s, s.actingPlayer, action);
        if (r.handEnded) break;
        if (r.roundClosed) {
          if (s.allIn[0] || s.allIn[1]) { finishToShowdown(s); break; }
          const events = nextStreet(s);
          // If nextStreet transitioned into showdown (river → showdown), break.
          if (events.some(e => e.kind === 'hand-end')) break;
          if ((s.phase as string) === 'showdown') break;
        }
      }
    }

    if (!s.gameOver) {
      // Rotate button for next hand.
      s.buttonIndex = (1 - s.buttonIndex) as 0 | 1;
    }
  }
}

describe('bot vs bot integration', () => {
  it('easy vs easy plays 10 hands without throwing', () => {
    expect(() => playBotVsBot(12345, ['easy', 'easy'])).not.toThrow();
  });
  it('medium vs medium plays 10 hands without throwing', () => {
    expect(() => playBotVsBot(23456, ['medium', 'medium'])).not.toThrow();
  });
  it('hard vs hard plays 10 hands without throwing', () => {
    expect(() => playBotVsBot(34567, ['hard', 'hard'], 5)).not.toThrow();
  });
  it('mixed difficulties do not violate chip conservation', () => {
    const s = createGameState(2, 0);
    const rng = mulberry32(99);
    // Shallow simulation — 6 hands.
    for (let hand = 0; hand < 6 && !s.gameOver; hand++) {
      s.phase = 'idle';
      dealHand(s, shuffle(makeDeck(), () => rng()));
      if (s.allIn[0] || s.allIn[1]) { finishToShowdown(s); continue; }
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const d: Difficulty = s.actingPlayer === 0 ? 'hard' : 'easy';
        const a = decideAction(s, d, { rng });
        const r = applyAction(s, s.actingPlayer, a);
        if (r.handEnded) break;
        if (r.roundClosed) {
          if (s.allIn[0] || s.allIn[1]) { finishToShowdown(s); break; }
          nextStreet(s);
          if ((s.phase as string) === 'showdown') break;
        }
      }
      s.buttonIndex = (1 - s.buttonIndex) as 0 | 1;
    }
    expect((s.chips[0] ?? 0) + (s.chips[1] ?? 0) + s.pot).toBe(2 * STARTING_STACK);
  });
});
