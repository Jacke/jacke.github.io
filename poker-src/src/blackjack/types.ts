/**
 * Blackjack types. Cards are the same 2-char strings as the poker engine
 * (rank + suit) so we can reuse the card renderer, deck builder, and RNG.
 *
 * A "shoe" is 6 standard 52-card decks shuffled together, as is standard
 * for Vegas Strip blackjack tables. We reshuffle whenever the cut-card
 * threshold (~75% dealt) is reached.
 */

import type { Card } from '../core/types.js';

export type BjActionKind =
  | 'hit'
  | 'stand'
  | 'double'
  | 'split'
  | 'surrender'
  | 'insurance-yes'
  | 'insurance-no';

/** One player hand. A single seat may hold multiple hands after splits. */
export interface Hand {
  cards: Card[];
  bet: number;
  /** True once this hand is finalized (stood, busted, doubled, BJ'd, or surrendered). */
  done: boolean;
  /** Final outcome after settlement. Null until the hand is settled. */
  outcome: HandOutcome | null;
  /** True for a hand born from split aces (may only receive one card). */
  fromSplitAce: boolean;
  /** True if the hand was doubled down (bet is 2x, exactly one extra card dealt). */
  doubled: boolean;
  /** True if the hand was surrendered (player gets half bet back). */
  surrendered: boolean;
}

export type HandOutcome =
  | 'blackjack'     // natural 21 on first 2 cards, pays 3:2
  | 'win'           // higher total than dealer or dealer bust
  | 'push'          // tie
  | 'loss'          // lower total or bust
  | 'surrender';    // voluntary surrender — half bet back

export type Phase =
  | 'idle'         // no hand in progress — waiting for bet
  | 'dealing'      // cards being dealt
  | 'insurance'    // dealer up is A, offering insurance
  | 'player'       // player's turn on current hand
  | 'dealer'       // dealer's auto-play
  | 'settled';     // hand finished, chips paid out

export interface BjGameState {
  /** The shoe — remaining cards, dealt front-to-back. */
  shoe: Card[];
  /** Cut-card position — when shoe.length drops below this, reshuffle next hand. */
  cutCard: number;
  /** Total decks in the shoe (default 6). */
  numDecks: number;
  /** Does the dealer stand on soft 17? True = S17, false = H17. */
  standOnSoft17: boolean;

  /** Player's bankroll (chips) — persists across hands. */
  chips: number;
  /** Current bet amount chosen by the player before the hand. */
  currentBet: number;
  /** Amount paid for insurance this hand (0 if none). */
  insuranceBet: number;

  /** Player hands — usually 1, up to 4 after splits. */
  hands: Hand[];
  /** Index of the hand the player is currently acting on. */
  activeHandIdx: number;
  /** Dealer's hand. Second card is hidden during player's turn. */
  dealer: Hand;

  phase: Phase;
  /** Number of hands played in this session (for stats). */
  handsPlayed: number;
}
