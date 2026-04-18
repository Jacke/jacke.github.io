/**
 * Blackjack engine — pure state machine. No DOM, no network.
 *
 * Flow:
 *   createState → placeBet → deal → (insurance?) → (peek for dealer BJ?)
 *                                  → player actions … → dealer plays → settle
 */

import type { Card } from '../core/types.js';
import { makeDeck, mulberry32, shuffle, type Rng } from '../core/cards.js';
import type { BjGameState, Hand, HandOutcome } from './types.js';
import {
  handValue, isBlackjack, isBust, canDouble, canSplit, canSurrender,
  dealerShouldHit, cardValue,
} from './rules.js';

// ═══════════════════════════════════════════════════════════════════════
// Shoe management
// ═══════════════════════════════════════════════════════════════════════

/** Build a fresh shoe of `numDecks` standard 52-card decks, shuffled. */
export function buildShoe(numDecks: number, rng: Rng): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < numDecks; d++) {
    shoe.push(...makeDeck());
  }
  return shuffle(shoe, rng);
}

/** Cut-card threshold: reshuffle when <25% of the shoe is left. */
function cutCardThreshold(numDecks: number): number {
  return Math.floor(numDecks * 52 * 0.25);
}

// ═══════════════════════════════════════════════════════════════════════
// State construction
// ═══════════════════════════════════════════════════════════════════════

export interface CreateBjOptions {
  numDecks?: number;        // default 6
  standOnSoft17?: boolean;  // default true (S17)
  startingChips?: number;   // default 1000
  rng?: Rng;                // default Math.random
  /**
   * Deterministic seed for shoe construction. When set, overrides `rng`
   * and builds a `mulberry32(seed)` generator. Used by the P2P flow so
   * host + guest construct bit-identical shoes from the same seed.
   */
  seed?: number;
}

export function createBjState(opts: CreateBjOptions = {}): BjGameState {
  const numDecks = opts.numDecks ?? 6;
  const rng = opts.seed !== undefined ? mulberry32(opts.seed) : (opts.rng ?? Math.random);
  return {
    shoe: buildShoe(numDecks, rng),
    cutCard: cutCardThreshold(numDecks),
    numDecks,
    standOnSoft17: opts.standOnSoft17 ?? true,
    chips: opts.startingChips ?? 1000,
    currentBet: 0,
    insuranceBet: 0,
    hands: [],
    activeHandIdx: 0,
    dealer: emptyHand(0),
    phase: 'idle',
    handsPlayed: 0,
  };
}

function emptyHand(bet: number): Hand {
  return {
    cards: [],
    bet,
    done: false,
    outcome: null,
    fromSplitAce: false,
    doubled: false,
    surrendered: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Hand lifecycle
// ═══════════════════════════════════════════════════════════════════════

/** Place a bet and deal the opening cards. Returns null on error. */
export function startHand(state: BjGameState, bet: number, rng: Rng = Math.random): void {
  if (state.phase !== 'idle' && state.phase !== 'settled') {
    throw new Error(`startHand called in phase ${state.phase}`);
  }
  if (bet <= 0) throw new Error('bet must be > 0');
  if (bet > state.chips) throw new Error('not enough chips');

  // Reshuffle if past cut card.
  if (state.shoe.length <= state.cutCard) {
    state.shoe = buildShoe(state.numDecks, rng);
  }

  state.currentBet = bet;
  state.insuranceBet = 0;
  state.chips -= bet;
  state.hands = [emptyHand(bet)];
  state.activeHandIdx = 0;
  state.dealer = emptyHand(0);
  state.phase = 'dealing';

  // Deal 2 to player, 2 to dealer, interleaved as in a real casino.
  drawTo(state, state.hands[0]!);
  drawTo(state, state.dealer);
  drawTo(state, state.hands[0]!);
  drawTo(state, state.dealer);

  // Insurance offered if dealer up card is an ace.
  const dealerUp = state.dealer.cards[0]!;
  if (cardValue(dealerUp) === 11) {
    state.phase = 'insurance';
    return;
  }

  // If dealer up card is 10-value, peek for BJ. If yes, resolve immediately.
  if (cardValue(dealerUp) === 10 && isBlackjack(state.dealer.cards)) {
    resolveDealerBJ(state);
    return;
  }

  // Player blackjack on the natural hand → auto-stand and settle.
  if (isBlackjack(state.hands[0]!.cards)) {
    state.hands[0]!.done = true;
    playDealerAndSettle(state, rng);
    return;
  }

  state.phase = 'player';
}

function drawTo(state: BjGameState, hand: Hand): void {
  const c = state.shoe.shift();
  if (!c) throw new Error('shoe empty');
  hand.cards.push(c);
}

// ═══════════════════════════════════════════════════════════════════════
// Insurance
// ═══════════════════════════════════════════════════════════════════════

export function takeInsurance(state: BjGameState, rng: Rng = Math.random): void {
  if (state.phase !== 'insurance') throw new Error('not in insurance phase');
  const half = Math.floor(state.currentBet / 2);
  if (half > state.chips) throw new Error('not enough chips for insurance');
  state.insuranceBet = half;
  state.chips -= half;
  afterInsurance(state, rng);
}

export function declineInsurance(state: BjGameState, rng: Rng = Math.random): void {
  if (state.phase !== 'insurance') throw new Error('not in insurance phase');
  afterInsurance(state, rng);
}

function afterInsurance(state: BjGameState, rng: Rng): void {
  // Dealer peeks for BJ regardless of insurance choice.
  if (isBlackjack(state.dealer.cards)) {
    resolveDealerBJ(state);
    return;
  }
  // No dealer BJ — insurance lost, continue to player turn.
  // Insurance side bet stays at whatever it was; settleAll() will handle.
  if (isBlackjack(state.hands[0]!.cards)) {
    state.hands[0]!.done = true;
    playDealerAndSettle(state, rng);
    return;
  }
  state.phase = 'player';
}

// ═══════════════════════════════════════════════════════════════════════
// Player actions
//
// Each action has two flavors:
//   1. A `*Step` variant that mutates state and returns a discriminator
//      ('continue' | 'advance' | 'dealer') indicating what the caller
//      should do next. These never auto-play the dealer — the UI uses
//      them so it can animate dealer draws one at a time.
//   2. The original name (`hit`, `stand`, ...) which is now a thin
//      wrapper that calls the step variant and, if the result is
//      'dealer', immediately plays the dealer to completion. This
//      preserves the synchronous behavior the existing tests rely on.
// ═══════════════════════════════════════════════════════════════════════

/** Result of a step-API player action. */
export type StepResult = 'continue' | 'advance' | 'dealer';

export function hitStep(state: BjGameState): StepResult {
  if (state.phase !== 'player') throw new Error('not player phase');
  const hand = activeHand(state);
  if (hand.done) throw new Error('hand already done');
  drawTo(state, hand);
  if (isBust(hand.cards) || hand.fromSplitAce) {
    hand.done = true;
    return advanceOrEnterDealer(state);
  }
  return 'continue';
}

export function standStep(state: BjGameState): Exclude<StepResult, 'continue'> {
  if (state.phase !== 'player') throw new Error('not player phase');
  const hand = activeHand(state);
  hand.done = true;
  return advanceOrEnterDealer(state);
}

export function doubleStep(state: BjGameState): Exclude<StepResult, 'continue'> {
  if (state.phase !== 'player') throw new Error('not player phase');
  const hand = activeHand(state);
  if (!canDouble(hand, state.chips)) throw new Error('cannot double');
  state.chips -= hand.bet;
  hand.bet *= 2;
  hand.doubled = true;
  drawTo(state, hand);
  hand.done = true;
  return advanceOrEnterDealer(state);
}

export function splitStep(state: BjGameState): StepResult {
  if (state.phase !== 'player') throw new Error('not player phase');
  const hand = activeHand(state);
  if (!canSplit(hand, state.chips, state.hands.length)) throw new Error('cannot split');
  state.chips -= hand.bet;

  const [c1, c2] = [hand.cards[0]!, hand.cards[1]!];
  const isAce = cardValue(c1) === 11;
  const newHand: Hand = {
    cards: [c2],
    bet: hand.bet,
    done: false,
    outcome: null,
    fromSplitAce: isAce,
    doubled: false,
    surrendered: false,
  };
  hand.cards = [c1];
  hand.fromSplitAce = isAce;
  // Insert the new hand right after the current active one.
  state.hands.splice(state.activeHandIdx + 1, 0, newHand);

  // Deal one card to each split hand.
  drawTo(state, hand);
  drawTo(state, newHand);

  // Split aces: each hand gets exactly one card, no further action.
  if (isAce) {
    hand.done = true;
    newHand.done = true;
    return advanceOrEnterDealer(state);
  }
  return 'continue';
}

export function surrenderStep(state: BjGameState): Exclude<StepResult, 'continue'> {
  if (state.phase !== 'player') throw new Error('not player phase');
  const hand = activeHand(state);
  if (!canSurrender(hand, state.hands.length)) throw new Error('cannot surrender');
  hand.surrendered = true;
  hand.done = true;
  hand.outcome = 'surrender';
  // Player gets half the bet back immediately.
  state.chips += Math.floor(hand.bet / 2);
  return advanceOrEnterDealer(state);
}

// ── Legacy synchronous wrappers — preserved for existing tests and any
//    non-UI caller that wants the whole hand resolved in one call.

export function hit(state: BjGameState, rng: Rng = Math.random): void {
  const result = hitStep(state);
  if (result === 'dealer') playDealerAndSettle(state, rng);
}

export function stand(state: BjGameState, rng: Rng = Math.random): void {
  const result = standStep(state);
  if (result === 'dealer') playDealerAndSettle(state, rng);
}

export function doubleDown(state: BjGameState, rng: Rng = Math.random): void {
  const result = doubleStep(state);
  if (result === 'dealer') playDealerAndSettle(state, rng);
}

export function split(state: BjGameState, rng: Rng = Math.random): void {
  const result = splitStep(state);
  if (result === 'dealer') playDealerAndSettle(state, rng);
}

export function surrender(state: BjGameState, rng: Rng = Math.random): void {
  const result = surrenderStep(state);
  if (result === 'dealer') playDealerAndSettle(state, rng);
}

function activeHand(state: BjGameState): Hand {
  return state.hands[state.activeHandIdx]!;
}

/**
 * Find the next un-done hand; if none remain, enter the dealer phase
 * WITHOUT playing it out. Returns 'advance' or 'dealer' so callers know
 * whether to keep taking player input or start the dealer sequence.
 */
function advanceOrEnterDealer(state: BjGameState): Exclude<StepResult, 'continue'> {
  for (let i = state.activeHandIdx + 1; i < state.hands.length; i++) {
    if (!state.hands[i]!.done) {
      state.activeHandIdx = i;
      return 'advance';
    }
  }
  enterDealerPhase(state);
  return 'dealer';
}

// ═══════════════════════════════════════════════════════════════════════
// Dealer play + settlement
//
// Split into three steppable pieces so the UI can interleave animation:
//   1. enterDealerPhase → sets phase='dealer' (no draws, no settle).
//   2. dealerShouldDraw → predicate, UI-driven loop.
//   3. dealerDrawOne    → draws one card and returns it, UI animates.
//   4. finalizeHand     → settleAll + phase='settled'.
//
// The legacy synchronous wrapper playDealerAndSettle composes them so
// any non-UI caller (and the existing 25 tests) get unchanged behavior.
// ═══════════════════════════════════════════════════════════════════════

export function enterDealerPhase(state: BjGameState): void {
  state.phase = 'dealer';
}

export function dealerShouldDraw(state: BjGameState): boolean {
  if (state.phase !== 'dealer') return false;
  // If every player hand is already resolved (bust or surrender), the
  // dealer doesn't need to draw — the outcome is decided.
  const allGone = state.hands.every(h => h.surrendered || isBust(h.cards));
  if (allGone) return false;
  return dealerShouldHit(state.dealer.cards, state.standOnSoft17);
}

export function dealerDrawOne(state: BjGameState): Card {
  if (state.phase !== 'dealer') throw new Error('not dealer phase');
  const c = state.shoe.shift();
  if (!c) throw new Error('shoe empty');
  state.dealer.cards.push(c);
  return c;
}

export function finalizeHand(state: BjGameState): void {
  if (state.phase !== 'dealer') throw new Error('not dealer phase');
  settleAll(state);
}

function playDealerAndSettle(state: BjGameState, rng: Rng): void {
  enterDealerPhase(state);
  while (dealerShouldDraw(state)) dealerDrawOne(state);
  finalizeHand(state);
  void rng; // rng intentionally unused here
}

function resolveDealerBJ(state: BjGameState): void {
  // Dealer has blackjack on first 2 cards. Player hand (singular — no split
  // has happened yet at this point) either also has BJ (push) or loses.
  state.phase = 'dealer';
  // Insurance pays 2:1 if taken.
  if (state.insuranceBet > 0) {
    state.chips += state.insuranceBet * 3; // stake + 2x win
  }
  settleAll(state);
}

function settleAll(state: BjGameState): void {
  const dealerBJ = isBlackjack(state.dealer.cards);
  const dealerBust = isBust(state.dealer.cards);
  const dealerTotal = handValue(state.dealer.cards).total;

  for (const hand of state.hands) {
    const outcome = classifyHand(hand, dealerBJ, dealerBust, dealerTotal);
    hand.outcome = outcome;
    state.chips += payout(hand, outcome);
  }
  state.phase = 'settled';
  state.handsPlayed++;
}

function classifyHand(
  hand: Hand,
  dealerBJ: boolean,
  dealerBust: boolean,
  dealerTotal: number,
): HandOutcome {
  if (hand.surrendered) return 'surrender';
  const playerBJ = isBlackjack(hand.cards) && !hand.fromSplitAce && hand.cards.length === 2;
  if (playerBJ && dealerBJ) return 'push';
  if (playerBJ) return 'blackjack';
  if (dealerBJ) return 'loss';
  const playerBust = isBust(hand.cards);
  if (playerBust) return 'loss';
  if (dealerBust) return 'win';
  const playerTotal = handValue(hand.cards).total;
  if (playerTotal > dealerTotal) return 'win';
  if (playerTotal < dealerTotal) return 'loss';
  return 'push';
}

/** Chip delta credited back to the player for this hand's outcome. */
function payout(hand: Hand, outcome: HandOutcome): number {
  switch (outcome) {
    case 'blackjack': return hand.bet + Math.floor(hand.bet * 1.5); // 3:2 → stake + 1.5×
    case 'win':       return hand.bet * 2; // stake + 1x
    case 'push':      return hand.bet; // stake back
    case 'loss':      return 0; // stake gone
    case 'surrender': return 0; // half already credited at surrender()
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Query helpers for the UI
// ═══════════════════════════════════════════════════════════════════════

export interface LegalActions {
  hit: boolean;
  stand: boolean;
  double: boolean;
  split: boolean;
  surrender: boolean;
}

export function legalBjActions(state: BjGameState): LegalActions {
  if (state.phase !== 'player') {
    return { hit: false, stand: false, double: false, split: false, surrender: false };
  }
  const hand = activeHand(state);
  if (hand.done) {
    return { hit: false, stand: false, double: false, split: false, surrender: false };
  }
  return {
    hit: true,
    stand: true,
    double: canDouble(hand, state.chips),
    split: canSplit(hand, state.chips, state.hands.length),
    surrender: canSurrender(hand, state.hands.length),
  };
}

/** Reset to idle, clear last hand's cards. Call between hands. */
export function readyNextHand(state: BjGameState): void {
  if (state.phase !== 'settled') return;
  state.hands = [];
  state.dealer = emptyHand(0);
  state.activeHandIdx = 0;
  state.currentBet = 0;
  state.insuranceBet = 0;
  state.phase = 'idle';
}
