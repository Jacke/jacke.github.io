import type { Card, Suit } from '../core/types.js';
import { DurakState, beats, isTrump, rankOf, canAttackWith, MAX_TABLE_CARDS } from './engine.js';
import { RANK_VALUE, DurakAction } from './types.js';

export type DurakDifficulty = 'easy' | 'medium' | 'hard';

function getCardValue(card: Card, trumpSuit: Suit | null): number {
  let val = RANK_VALUE[card[0] as keyof typeof RANK_VALUE] ?? 0;
  if (trumpSuit && isTrump(card, trumpSuit)) {
    val += 20;
  }
  return val;
}

function sortByValue(hand: Card[], trumpSuit: Suit | null): Card[] {
  return [...hand].sort((a, b) => getCardValue(a, trumpSuit) - getCardValue(b, trumpSuit));
}

function findBeatableCards(hand: Card[], attackCard: Card, trumpSuit: Suit): Card[] {
  return hand.filter(c => beats(c, attackCard, trumpSuit));
}

function findAttackCards(hand: Card[], table: Card[]): Card[] {
  if (table.length === 0) return [...hand];
  const tableRanks = new Set(table.map(c => rankOf(c)));
  return hand.filter(c => tableRanks.has(rankOf(c)));
}

function canPass(state: DurakState): boolean {
  return state.table.length > 0 && state.table.length % 2 === 0;
}

function decideAttack(state: DurakState, player: number, strategy: 'low' | 'mid' | 'smart'): DurakAction {
  const hand = state.hands[player];
  if (!hand || hand.length === 0) {
    return canPass(state) ? { type: 'pass' } : { type: 'none' };
  }
  const trumpSuit = state.trumpSuit;
  const attackCards = findAttackCards(hand, state.table).filter(c => canAttackWith(state, player, c));

  if (attackCards.length === 0 || state.table.length >= MAX_TABLE_CARDS) {
    return canPass(state) ? { type: 'pass' } : { type: 'none' };
  }

  const sorted = sortByValue(attackCards, trumpSuit);
  if (strategy === 'low') {
    return { type: 'attack', card: sorted[0]! };
  }
  if (strategy === 'mid') {
    return { type: 'attack', card: sorted[Math.floor(sorted.length / 2)]! };
  }
  const nonTrumps = sorted.filter(c => !isTrump(c, trumpSuit!));
  return { type: 'attack', card: (nonTrumps[0] ?? sorted[0])! };
}

function decideDefend(state: DurakState, player: number, tolerateTake: boolean): DurakAction {
  const hand = state.hands[player];
  if (!hand || state.table.length === 0) return { type: 'none' };
  const trumpSuit = state.trumpSuit;
  if (!trumpSuit) return { type: 'none' };

  const attackCard = state.table[state.table.length - 1]!;
  const beatable = findBeatableCards(hand, attackCard, trumpSuit);

  if (beatable.length > 0) {
    const sorted = sortByValue(beatable, trumpSuit);
    return { type: 'defend', card: sorted[0]!, targetCard: attackCard };
  }

  if (tolerateTake) return { type: 'take' };
  return { type: 'take' };
}

export function decideDurak(
  state: DurakState,
  player: number,
  difficulty: DurakDifficulty = 'medium',
): DurakAction {
  if (state.phase === 'attack' && player === state.currentAttacker) {
    const strategy: 'low' | 'mid' | 'smart' = difficulty === 'easy' ? 'low' : difficulty === 'medium' ? 'mid' : 'smart';
    return decideAttack(state, player, strategy);
  }
  if (state.phase === 'defend' && player === state.currentDefender) {
    return decideDefend(state, player, true);
  }
  return { type: 'none' };
}

export function thinkDelayMs(difficulty: DurakDifficulty): number {
  const base = { easy: 400, medium: 600, hard: 800 }[difficulty];
  return base + Math.floor(Math.random() * 300);
}
