import type { Card, Suit } from '../core/types.js';
import { DurakState, beats, isTrump, rankOf, suitOf, canAttackWith, MAX_TABLE_CARDS } from './engine.js';
import { RANK_VALUE } from './types.js';

export type DurakDifficulty = 'easy' | 'medium' | 'hard';

function getCardValue(card: Card, trumpSuit: Suit | null): number {
  let val = RANK_VALUE[card[0]] ?? 0;
  if (trumpSuit && isTrump(card, trumpSuit)) {
    val += 20;
  }
  return val;
}

function sortByValue(hand: Card[], trumpSuit: Suit | null): Card[] {
  return [...hand].sort((a, b) => getCardValue(b, trumpSuit) - getCardValue(a, trumpSuit));
}

function findBeatableCards(hand: Card[], attackCard: Card, trumpSuit: Suit): Card[] {
  return hand.filter(c => beats(c, attackCard, trumpSuit));
}

function findAttackCards(hand: Card[], table: Card[]): Card[] {
  if (table.length === 0) return hand;
  
  const tableRanks = new Set(table.map(c => rankOf(c)));
  return hand.filter(c => tableRanks.has(rankOf(c)));
}

function decideDurakEasy(state: DurakState, player: number): DurakAction {
  const hand = state.hands[player];
  const trumpSuit = state.trumpSuit;
  
  if (state.phase === 'attack' && player === state.currentAttacker) {
    const attackCards = findAttackCards(hand, state.table);
    if (attackCards.length > 0) {
      const sorted = sortByValue(attackCards, trumpSuit);
      return { type: 'attack', card: sorted[0] };
    }
    if (hand.length > 0) {
      return { type: 'attack', card: hand[0] };
    }
  }
  
  if (state.phase === 'defend' && player === state.currentDefender) {
    if (state.table.length > 0) {
      const attackCard = state.table[state.table.length - 1]!;
      const beatable = findBeatableCards(hand, attackCard, trumpSuit!);
      
      if (beatable.length > 0) {
        const sorted = sortByValue(beatable, trumpSuit);
        return { type: 'defend', card: sorted[0], targetCard: attackCard };
      }
      
      if (state.defenderCanTake) {
        return { type: 'take' };
      }
    }
  }
  
  if (state.phase === 'attack' && player === state.currentAttacker && !state.defenderCanTake) {
    return { type: 'pass' };
  }
  
  return { type: 'none' };
}

function decideDurakMedium(state: DurakState, player: number): DurakAction {
  const hand = state.hands[player];
  const trumpSuit = state.trumpSuit;
  
  if (state.phase === 'attack' && player === state.currentAttacker) {
    const attackCards = findAttackCards(hand, state.table);
    
    if (state.table.length === 0) {
      const lowCards = hand.filter(c => getCardValue(c, trumpSuit) < 15);
      if (lowCards.length > 0) {
        return { type: 'attack', card: lowCards[0] };
      }
      return { type: 'attack', card: hand[0] };
    }
    
    if (attackCards.length > 0 && state.table.length < MAX_TABLE_CARDS) {
      const sorted = sortByValue(attackCards, trumpSuit);
      return { type: 'attack', card: sorted[sorted.length - 1] };
    }
    
    if (hand.length > 0 && state.table.length < MAX_TABLE_CARDS) {
      return { type: 'attack', card: hand[0] };
    }
    
    return { type: 'pass' };
  }
  
  if (state.phase === 'defend' && player === state.currentDefender) {
    if (state.table.length > 0) {
      const attackCard = state.table[state.table.length - 1]!;
      const beatable = findBeatableCards(hand, attackCard, trumpSuit!);
      
      if (beatable.length > 0) {
        const sorted = sortByValue(beatable, trumpSuit);
        return { type: 'defend', card: sorted[0], targetCard: attackCard };
      }
      
      if (state.defenderCanTake && hand.length > 4) {
        return { type: 'take' };
      }
    }
  }
  
  return { type: 'none' };
}

function decideDurakHard(state: DurakState, player: number): DurakAction {
  const hand = state.hands[player];
  const trumpSuit = state.trumpSuit;
  const trumpCount = hand.filter(c => isTrump(c, trumpSuit!)).length;
  
  if (state.phase === 'attack' && player === state.currentAttacker) {
    if (state.table.length === 0) {
      if (trumpCount > 0 && hand.length > 3) {
        const nonTrumps = hand.filter(c => !isTrump(c, trumpSuit!));
        if (nonTrumps.length > 0) {
          return { type: 'attack', card: nonTrumps[0] };
        }
      }
      return { type: 'attack', card: hand[0] };
    }
    
    const attackCards = findAttackCards(hand, state.table);
    
    if (attackCards.length > 0 && state.table.length < MAX_TABLE_CARDS - 1) {
      const midValue = attackCards.map(c => getCardValue(c, trumpSuit)).sort((a, b) => a - b)[Math.floor(attackCards.length / 2)];
      const selected = attackCards.find(c => getCardValue(c, trumpSuit) === midValue);
      return { type: 'attack', card: selected || attackCards[0] };
    }
    
    if (attackCards.length > 0 && state.table.length < MAX_TABLE_CARDS) {
      return { type: 'attack', card: attackCards[0] };
    }
    
    if (trumpCount >= 2 && state.table.length < MAX_TABLE_CARDS) {
      return { type: 'attack', card: hand[0] };
    }
    
    return { type: 'pass' };
  }
  
  if (state.phase === 'defend' && player === state.currentDefender) {
    if (state.table.length > 0) {
      const attackCard = state.table[state.table.length - 1]!;
      const beatable = findBeatableCards(hand, attackCard, trumpSuit!);
      
      if (beatable.length > 0) {
        const lowBeat = beatable.sort((a, b) => getCardValue(a, trumpSuit) - getCardValue(b, trumpSuit))[0];
        return { type: 'defend', card: lowBeat, targetCard: attackCard };
      }
      
      const canTake = state.defenderCanTake && hand.length + state.table.length <= 6;
      if (canTake && trumpCount < 2) {
        return { type: 'take' };
      }
    }
  }
  
  return { type: 'none' };
}

export function decideDurak(
  state: DurakState,
  player: number,
  difficulty: DurakDifficulty = 'medium'
): DurakAction {
  switch (difficulty) {
    case 'easy':
      return decideDurakEasy(state, player);
    case 'hard':
      return decideDurakHard(state, player);
    case 'medium':
    default:
      return decideDurakMedium(state, player);
  }
}

export function thinkDelayMs(difficulty: DurakDifficulty): number {
  const base = { easy: 400, medium: 600, hard: 800 }[difficulty];
  return base + Math.floor(Math.random() * 300);
}