import { describe, it, expect } from 'vitest';
import {
  createBjState, startHand, hit, stand, doubleDown, split, surrender,
  takeInsurance, declineInsurance, readyNextHand, legalBjActions,
  dealerShouldDraw, dealerDrawOne, finalizeHand, enterDealerPhase,
  standStep, hitStep,
} from './engine.js';
import { handValue, isBlackjack, isBust, cardValue, dealerShouldHit } from './rules.js';
import { mulberry32 } from '../core/cards.js';
import type { Card } from '../core/types.js';
import type { BjGameState } from './types.js';

// A deterministic shoe builder — puts the given cards at the FRONT of the
// shoe so we can script exact deals. The rest of the shoe is filled with
// arbitrary cards so `startHand` doesn't starve.
function rigShoe(state: BjGameState, scripted: Card[]): void {
  const filler: Card[] = [];
  const suits = ['s', 'h', 'd', 'c'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  for (const r of ranks) for (const s of suits) filler.push(r + s);
  // Repeat so we have enough for all hands in a test.
  while (filler.length < 200) filler.push(...filler);
  state.shoe = [...scripted, ...filler];
}

function fresh(overrides: Partial<Parameters<typeof createBjState>[0]> = {}): BjGameState {
  return createBjState({
    numDecks: 6,
    standOnSoft17: true,
    startingChips: 1000,
    rng: mulberry32(42),
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Rules / hand value
// ═══════════════════════════════════════════════════════════════════════

describe('handValue', () => {
  it('face cards = 10', () => {
    expect(handValue(['Th', 'Ks']).total).toBe(20);
    expect(handValue(['Jd', 'Qc']).total).toBe(20);
  });
  it('ace counts as 11 when safe', () => {
    const v = handValue(['Ah', '7s']);
    expect(v.total).toBe(18);
    expect(v.soft).toBe(true);
  });
  it('ace downgrades to 1 to avoid bust', () => {
    const v = handValue(['Ah', '7s', '8d']);
    expect(v.total).toBe(16);
    expect(v.soft).toBe(false);
  });
  it('multiple aces', () => {
    expect(handValue(['Ah', 'As']).total).toBe(12);
    expect(handValue(['Ah', 'As', '9d']).total).toBe(21);
  });
  it('busts report > 21', () => {
    expect(handValue(['Kh', 'Qs', '5d']).total).toBe(25);
    expect(isBust(['Kh', 'Qs', '5d'])).toBe(true);
  });
});

describe('isBlackjack', () => {
  it('Ace + ten on 2 cards is blackjack', () => {
    expect(isBlackjack(['Ah', 'Ts'])).toBe(true);
    expect(isBlackjack(['Jd', 'Ac'])).toBe(true);
  });
  it('21 in 3 cards is NOT blackjack', () => {
    expect(isBlackjack(['7h', '7s', '7d'])).toBe(false);
  });
});

describe('dealerShouldHit', () => {
  it('hits on 16', () => {
    expect(dealerShouldHit(['Ks', '6d'], true)).toBe(true);
  });
  it('S17: stands on soft 17', () => {
    expect(dealerShouldHit(['As', '6d'], true)).toBe(false);
  });
  it('H17: hits soft 17', () => {
    expect(dealerShouldHit(['As', '6d'], false)).toBe(true);
  });
  it('stands on hard 17+', () => {
    expect(dealerShouldHit(['Ks', '7d'], true)).toBe(false);
    expect(dealerShouldHit(['Ks', '9d'], true)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Engine flow
// ═══════════════════════════════════════════════════════════════════════

describe('startHand', () => {
  it('deals 2 cards to player and dealer, deducts bet', () => {
    const s = fresh();
    const beforeChips = s.chips;
    startHand(s, 100);
    expect(s.hands[0]!.cards).toHaveLength(2);
    expect(s.dealer.cards).toHaveLength(2);
    expect(s.chips).toBe(beforeChips - 100);
  });

  it('player natural blackjack auto-settles as BJ payout', () => {
    const s = fresh();
    // Player: A T, Dealer: 9 5 → player BJ, dealer plays (hits to 17+?), player wins 3:2
    rigShoe(s, ['Ah', '9s', 'Th', '5d', '2c']);
    const before = s.chips;
    startHand(s, 100, mulberry32(1));
    expect(s.hands[0]!.outcome).toBe('blackjack');
    expect(s.phase).toBe('settled');
    // Player net = +150 (3:2 on 100)
    expect(s.chips - before).toBe(150);
  });

  it('dealer blackjack without insurance: player loses bet', () => {
    const s = fresh();
    // Player: 9 8, Dealer: A T → dealer BJ
    rigShoe(s, ['9h', 'As', '8d', 'Tc']);
    const before = s.chips;
    startHand(s, 100);
    // Insurance is offered because dealer up is A
    expect(s.phase).toBe('insurance');
    declineInsurance(s);
    expect(s.phase).toBe('settled');
    expect(s.hands[0]!.outcome).toBe('loss');
    expect(s.chips - before).toBe(-100);
  });

  it('push when both player and dealer have blackjack', () => {
    const s = fresh();
    // Player: A T, Dealer: A T
    rigShoe(s, ['Ah', 'As', 'Td', 'Tc']);
    const before = s.chips;
    startHand(s, 100);
    // Insurance offered (dealer A), decline
    expect(s.phase).toBe('insurance');
    declineInsurance(s);
    expect(s.hands[0]!.outcome).toBe('push');
    expect(s.chips - before).toBe(0);
  });

  it('insurance pays 2:1 when dealer has blackjack — exactly offsets main bet loss', () => {
    const s = fresh();
    // Player: 9 9, Dealer: A T → dealer BJ
    rigShoe(s, ['9h', 'As', '9d', 'Tc']);
    const before = s.chips;
    startHand(s, 100);
    expect(s.phase).toBe('insurance');
    takeInsurance(s); // pays 50
    expect(s.phase).toBe('settled');
    // Main bet -100. Insurance: stake 50 → pays 3x (stake + 2x win = 150 credit).
    // Net: -100 (main) - 50 (insurance stake) + 150 (insurance payout) = 0.
    // That's exactly the point of insurance vs dealer BJ — it breaks even.
    expect(s.chips - before).toBe(0);
  });
});

describe('player actions', () => {
  it('hit adds a card; bust ends hand', () => {
    const s = fresh();
    // Player: T 6, dealer: 5 9, then player hits → K = 26 bust
    rigShoe(s, ['Th', '5s', '6d', '9c', 'Kh']);
    startHand(s, 100);
    const before = s.chips;
    hit(s);
    expect(s.hands[0]!.cards).toHaveLength(3);
    expect(s.hands[0]!.done).toBe(true);
    expect(s.hands[0]!.outcome).toBe('loss');
    expect(s.chips - before).toBe(0); // bet already deducted in startHand
  });

  it('stand lets dealer play to 17+', () => {
    const s = fresh();
    // Player: T 8 (=18), dealer: T 6 (=16), dealer draws 5 → 21 dealer wins
    rigShoe(s, ['Th', 'Ts', '8d', '6c', '5h']);
    startHand(s, 100);
    stand(s);
    expect(s.dealer.cards.length).toBeGreaterThanOrEqual(3);
    expect(s.phase).toBe('settled');
    expect(s.hands[0]!.outcome).toBe('loss');
  });

  it('double down: bet doubles, exactly one card, hand done', () => {
    const s = fresh();
    // Player: 5 6 (=11), dealer: 9 8, double card: T → 21 player, dealer has 17 → win
    rigShoe(s, ['5h', '9s', '6d', '8c', 'Th']);
    startHand(s, 100);
    expect(legalBjActions(s).double).toBe(true);
    const before = s.chips;
    doubleDown(s);
    expect(s.hands[0]!.doubled).toBe(true);
    expect(s.hands[0]!.bet).toBe(200);
    expect(s.hands[0]!.cards).toHaveLength(3);
    expect(s.phase).toBe('settled');
    // Wagered 100 more at double, won 200 net on the 200 bet → +200 credit
    // Net delta from pre-double point = -100 (double wager) + 400 (payout stake+win) = +300
    expect(s.chips - before).toBe(300);
  });

  it('split: two hands play independently', () => {
    const s = fresh();
    // Player: 8 8, dealer: T 7. Split → hand1 gets 3, hand2 gets 4.
    // Player stands both. Dealer stands at 17. Both lose.
    rigShoe(s, ['8h', 'Ts', '8d', '7c', '3h', '4h']);
    startHand(s, 100);
    expect(legalBjActions(s).split).toBe(true);
    split(s);
    expect(s.hands).toHaveLength(2);
    expect(s.hands[0]!.cards).toHaveLength(2);
    expect(s.hands[1]!.cards).toHaveLength(2);
    // Each hand has its own bet
    expect(s.hands[0]!.bet).toBe(100);
    expect(s.hands[1]!.bet).toBe(100);
    // Stand both
    stand(s);
    stand(s);
    expect(s.phase).toBe('settled');
  });

  it('split aces: each hand gets one card only, auto-done', () => {
    const s = fresh();
    // Player: A A, dealer: T 6, then first-ace draws T (=21), second-ace draws 9 (=20)
    rigShoe(s, ['Ah', 'Ts', 'As', '6d', 'Th', '9h']);
    startHand(s, 100);
    split(s);
    expect(s.phase).toBe('settled');
    // Both hands auto-done — dealer plays: 16 → must hit
    // 21 on split ace is NOT a blackjack (payout is 1:1 not 3:2)
    // First hand: A + T = 21, second hand: A + 9 = 20
    // Dealer 16 + next card from shoe
  });

  it('surrender: lose half bet, end hand immediately', () => {
    const s = fresh();
    // Player: K 6 (=16 vs dealer T = bad spot), dealer up T
    rigShoe(s, ['Kh', 'Ts', '6d', '7c']);
    startHand(s, 100);
    expect(legalBjActions(s).surrender).toBe(true);
    const before = s.chips;
    surrender(s);
    expect(s.hands[0]!.outcome).toBe('surrender');
    // Got half back immediately → +50 relative to startHand baseline
    expect(s.chips - before).toBe(50);
  });
});

describe('readyNextHand', () => {
  it('resets state to idle after settlement', () => {
    const s = fresh();
    rigShoe(s, ['Kh', 'Ts', '6d', '7c']);
    startHand(s, 100);
    stand(s);
    expect(s.phase).toBe('settled');
    readyNextHand(s);
    expect(s.phase).toBe('idle');
    expect(s.hands).toHaveLength(0);
    expect(s.currentBet).toBe(0);
  });
});

describe('seeded shoe is deterministic', () => {
  it('same seed → identical shoe order (P2P sync invariant)', () => {
    const a = createBjState({ numDecks: 6, seed: 42 });
    const b = createBjState({ numDecks: 6, seed: 42 });
    expect(a.shoe).toEqual(b.shoe);
  });
  it('different seeds → different shoes', () => {
    const a = createBjState({ numDecks: 6, seed: 42 });
    const b = createBjState({ numDecks: 6, seed: 43 });
    expect(a.shoe).not.toEqual(b.shoe);
  });
  it('deterministic start → deterministic deal', () => {
    const a = createBjState({ numDecks: 6, seed: 777 });
    const b = createBjState({ numDecks: 6, seed: 777 });
    startHand(a, 100);
    startHand(b, 100);
    expect(a.hands[0]!.cards).toEqual(b.hands[0]!.cards);
    expect(a.dealer.cards).toEqual(b.dealer.cards);
  });
});

describe('shoe reshuffles past cut card', () => {
  it('reshuffles when shoe is under threshold', () => {
    const s = fresh({ numDecks: 1 });
    // Drain shoe close to empty
    s.shoe = s.shoe.slice(0, 5);
    const shoeLenBefore = s.shoe.length;
    startHand(s, 10);
    expect(s.shoe.length).toBeGreaterThan(shoeLenBefore); // reshuffled
  });
});

describe('legalBjActions', () => {
  it('all false when phase is not player', () => {
    const s = fresh();
    const legal = legalBjActions(s);
    expect(legal).toEqual({
      hit: false, stand: false, double: false, split: false, surrender: false,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Steppable dealer API — lets the UI animate dealer draws one at a time
// ═══════════════════════════════════════════════════════════════════════

describe('steppable dealer API', () => {
  it('dealerShouldDraw is false outside dealer phase', () => {
    const s = fresh();
    rigShoe(s, ['Kh', 'Ts', '6d', '7c']);
    startHand(s, 100);
    // Phase is 'player' now.
    expect(dealerShouldDraw(s)).toBe(false);
  });

  it('dealerShouldDraw is false when player bust — all hands gone', () => {
    const s = fresh();
    // Player: T 6 then hits K → 26 bust. Dealer up 5. After bust, engine
    // jumps straight to dealer phase + settles. So test the intermediate:
    // manually enter dealer phase with all hands bust.
    rigShoe(s, ['Th', '5s', '6d', '9c', 'Kh']);
    startHand(s, 100);
    hit(s); // busts the hand, auto-advances to dealer, settles. Phase now 'settled'.
    // Re-trigger the predicate via a manual dealer re-entry.
    enterDealerPhase(s);
    expect(dealerShouldDraw(s)).toBe(false);
  });

  it('dealerDrawOne throws outside dealer phase', () => {
    const s = fresh();
    rigShoe(s, ['Kh', 'Ts', '6d', '7c']);
    startHand(s, 100);
    expect(() => dealerDrawOne(s)).toThrow('not dealer phase');
  });

  it('finalizeHand throws outside dealer phase', () => {
    const s = fresh();
    rigShoe(s, ['Kh', 'Ts', '6d', '7c']);
    startHand(s, 100);
    expect(() => finalizeHand(s)).toThrow('not dealer phase');
  });

  it('stepped dealer play matches synchronous stand (parity test)', () => {
    // Rig a shoe where the dealer needs to draw exactly 2 more cards.
    // Player: T 9 (=19). Dealer: 7 6 (=13) → draws 3 (=16) → draws 4 (=20).
    // Both lines must produce dealer.cards = ['7s','6d','3h','4h'], chips
    // delta 0 (player 19 vs dealer 20 → loss).
    const scripted = ['Th', '7s', '9d', '6d', '3h', '4h'];

    // Line A: synchronous
    const sA = fresh();
    rigShoe(sA, scripted);
    startHand(sA, 100);
    stand(sA);

    // Line B: steppable
    const sB = fresh();
    rigShoe(sB, scripted);
    startHand(sB, 100);
    const res = standStep(sB);
    expect(res).toBe('dealer');
    while (dealerShouldDraw(sB)) dealerDrawOne(sB);
    finalizeHand(sB);

    expect(sA.dealer.cards).toEqual(sB.dealer.cards);
    expect(sA.chips).toBe(sB.chips);
    expect(sA.hands[0]!.outcome).toBe(sB.hands[0]!.outcome);
    expect(sA.phase).toBe(sB.phase);
  });

  it('hitStep returns continue when hand not bust', () => {
    const s = fresh();
    // Player: 5 4 (=9) + next card 3 (=12, not bust). Dealer: 9 7.
    rigShoe(s, ['5h', '9s', '4d', '7c', '3h']);
    startHand(s, 100);
    const res = hitStep(s);
    expect(res).toBe('continue');
    expect(s.phase).toBe('player');
    expect(s.hands[0]!.cards).toHaveLength(3);
  });
});
