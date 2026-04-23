import type { Card, Suit, Rank } from '../core/types.js';

export type DurakPhase = 'idle' | 'attack' | 'defend' | 'draw' | 'end';

export type ActionKind = 'attack' | 'defend' | 'take' | 'pass' | 'none';

export interface DurakAction {
  type: ActionKind;
  card?: Card;
  targetCard?: Card;
}

export interface DurakState {
  phase: DurakPhase;
  deck: Card[];
  discardPile: Card[];
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  hands: Card[][];
  table: Card[];
  currentAttacker: number;
  currentDefender: number;
  defenderCanTake: boolean;
  attackerCardsLeft: number;
  roundWinner: number | null;
  gameWinner: number | null;
}

export const DURAK_RANKS: readonly Rank[] = [
  '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A',
];

export const DURAK_SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];

export const RANK_VALUE: Readonly<Partial<Record<Rank, number>>> = {
  '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

export type GameType = 'poker' | 'durak';