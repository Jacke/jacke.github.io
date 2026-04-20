import type { Card, Suit, Rank } from '../core/types.js';
import { shuffle, defaultRng, type Rng } from '../core/cards.js';
import type { DurakState, DurakPhase } from './types.js';
import { DURAK_RANKS, DURAK_SUITS, RANK_VALUE } from './types.js';

export interface DurakEvents {
  type: 'durak-start' | 'durak-attack' | 'durak-defend' | 'durak-card-played' | 'durak-take' | 'durak-pass' | 'durak-round-end' | 'durak-game-end';
  data?: Record<string, unknown>;
}

const MIN_DURAK_CARDS = 36;
export const MAX_TABLE_CARDS = 6;

export function createDurakState(numPlayers: number = 2): DurakState {
  return {
    phase: 'idle',
    deck: [],
    discardPile: [],
    trumpCard: null,
    trumpSuit: null,
    hands: Array.from({ length: numPlayers }, () => []),
    table: [],
    currentAttacker: 0,
    currentDefender: 1 % numPlayers,
    defenderCanTake: true,
    attackerCardsLeft: 0,
    roundWinner: null,
    gameWinner: null,
  };
}

export function createDurakDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of DURAK_SUITS) {
    for (const r of DURAK_RANKS) {
      deck.push(r + s);
    }
  }
  return deck;
}

export function rankOf(card: Card): number {
  return RANK_VALUE[card[0] as Rank] ?? 0;
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

function dealDurak(state: DurakState, rng: Rng = defaultRng): void {
  state.deck = shuffle(createDurakDeck(), rng);
  state.trumpCard = state.deck.pop() ?? null;
  state.trumpSuit = state.trumpCard ? suitOf(state.trumpCard) : null;
  
  const cardsPerPlayer = 6;
  for (let i = 0; i < cardsPerPlayer; i++) {
    for (let p = 0; p < state.hands.length; p++) {
      const card = state.deck.pop();
      if (card) state.hands[p]!.push(card);
    }
  }
}

export function isTrump(card: Card, trumpSuit: Suit): boolean {
  return suitOf(card) === trumpSuit;
}

export function beats(card: Card, target: Card, trumpSuit: Suit): boolean {
  const cardRank = rankOf(card);
  const targetRank = rankOf(target);
  
  if (isTrump(card, trumpSuit) && !isTrump(target, trumpSuit)) return true;
  if (!isTrump(card, trumpSuit) && isTrump(target, trumpSuit)) return false;
  
  return cardRank > targetRank;
}

export function canAttackWith(state: DurakState, attacker: number, card: Card): boolean {
  if (state.table.length >= MAX_TABLE_CARDS) return false;
  if (state.hands[attacker]!.length === 0) return false;
  
  if (state.table.length === 0) return true;
  
  const tableRanks = state.table.map(c => rankOf(c));
  const cardRank = rankOf(card);
  return tableRanks.includes(cardRank);
}

export function canDefendWith(state: DurakState, defender: number, attackCard: Card, defenseCard: Card): boolean {
  return beats(defenseCard, attackCard, state.trumpSuit!);
}

export function startDurak(state: DurakState, rng: Rng = defaultRng): DurakEvents[] {
  const events: DurakEvents[] = [];
  
  state.phase = 'attack';
  dealDurak(state, rng);
  
  let lowestTrump = 15;
  let firstAttacker = 0;
  
  for (let p = 0; p < state.hands.length; p++) {
    const trumpCards = state.hands[p]!.filter(c => isTrump(c, state.trumpSuit!));
    for (const c of trumpCards) {
      const r = rankOf(c);
      if (r < lowestTrump) {
        lowestTrump = r;
        firstAttacker = p;
      }
    }
  }
  
  state.currentAttacker = firstAttacker;
  state.currentDefender = (firstAttacker + 1) % state.hands.length;
  state.attackerCardsLeft = state.hands[firstAttacker]!.length;
  state.table = [];
  state.discardPile = [];
  
  events.push({ type: 'durak-start', data: { attacker: firstAttacker } });
  
  return events;
}

export function attack(state: DurakState, attacker: number, card: Card): DurakEvents[] {
  const events: DurakEvents[] = [];
  
  if (state.phase !== 'attack') return events;
  if (attacker !== state.currentAttacker) return events;
  
  const hand = state.hands[attacker];
  const cardIdx = hand.indexOf(card);
  if (cardIdx === -1) return events;
  
  if (!canAttackWith(state, attacker, card)) return events;
  
  hand.splice(cardIdx, 1);
  state.table.push(card);
  
  state.phase = 'defend';
  state.defenderCanTake = true;
  
  events.push({ type: 'durak-attack', data: { player: attacker, card } });
  
  return events;
}

export function defend(state: DurakState, defender: number, attackCard: Card, defenseCard: Card): DurakEvents[] {
  const events: DurakEvents[] = [];
  
  if (state.phase !== 'defend') return events;
  if (defender !== state.currentDefender) return events;
  if (!state.defenderCanTake) return events;
  
  const hand = state.hands[defender];
  const cardIdx = hand.indexOf(defenseCard);
  if (cardIdx === -1) return events;
  
  if (!canDefendWith(state, defender, attackCard, defenseCard)) return events;
  
  hand.splice(cardIdx, 1);
  state.table.push(defenseCard);
  
  state.attackerCardsLeft = state.hands[state.currentAttacker]!.length;
  
  if (state.table.length >= MAX_TABLE_CARDS || state.attackerCardsLeft === 0) {
    events.push(...endRound(state, state.currentDefender));
  } else {
    events.push({ type: 'durak-defend', data: { player: defender, attackCard, defenseCard } });
  }
  
  return events;
}

export function take(state: DurakState, defender: number): DurakEvents[] {
  const events: DurakEvents[] = [];
  
  if (state.phase !== 'defend') return events;
  if (defender !== state.currentDefender) return events;
  if (!state.defenderCanTake) return events;
  
  for (const card of state.table) {
    state.hands[defender]!.push(card);
  }
  state.discardPile.push(...state.table);
  state.table = [];
  
  events.push(...endRound(state, defender));
  events.push({ type: 'durak-take', data: { player: defender } });
  
  return events;
}

export function pass(state: DurakState, attacker: number): DurakEvents[] {
  const events: DurakEvents[] = [];
  
  if (state.phase !== 'attack') return events;
  if (attacker !== state.currentAttacker) return events;
  
  state.defenderCanTake = false;
  
  events.push({ type: 'durak-pass', data: { player: attacker } });
  
  return events;
}

function dealToPlayers(state: DurakState): void {
  const attackerHand = state.hands[state.currentAttacker];
  const defenderHand = state.hands[state.currentDefender];
  
  while (attackerHand.length < 6 && state.deck.length > 0) {
    attackerHand.push(state.deck.pop()!);
  }
  while (defenderHand.length < 6 && state.deck.length > 0) {
    defenderHand.push(state.deck.pop()!);
  }
}

export function endRound(state: DurakState, winner: number): DurakEvents[] {
  const events: DurakEvents[] = [];
  
  for (const card of state.table) {
    state.discardPile.push(card);
  }
  state.table = [];
  
  dealToPlayers(state);
  
  state.roundWinner = winner;
  
  if (state.hands[0]!.length === 0) {
    state.gameWinner = 0;
    state.phase = 'end';
    events.push({ type: 'durak-game-end', data: { winner: 0 } });
  } else if (state.hands[1]!.length === 0) {
    state.gameWinner = 1;
    state.phase = 'end';
    events.push({ type: 'durak-game-end', data: { winner: 1 } });
  } else {
    state.currentAttacker = winner;
    state.currentDefender = (winner + 1) % state.hands.length;
    state.attackerCardsLeft = state.hands[winner]!.length;
    state.phase = 'attack';
    events.push({ type: 'durak-round-end', data: { winner } });
  }
  
  return events;
}