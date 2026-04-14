// ═══════════════════════════════════════════════════════════════════════════════
// Game variants and configuration
// ═══════════════════════════════════════════════════════════════════════════════

export type BettingStructure = 'nl' | 'pl' | 'fl'; // No-Limit, Pot-Limit, Fixed-Limit
export type GameVariant = 'holdem' | 'omaha' | 'shortdeck' | 'pineapple' | 'crazypineapple' | 'irish';
export type HoleCardCount = 2 | 3 | 4;

export interface GameConfig {
  /** Game variant (Texas Hold'em, Omaha, Short Deck, etc.) */
  variant: GameVariant;
  /** Betting structure */
  betting: BettingStructure;
  /** Number of hole cards dealt to each player */
  holeCards: HoleCardCount;
  /** True to allow split pot (Hi-Lo) - future extension */
  hiLo: boolean;
  /** True to run it twice (double board) - future extension */
  doubleBoard: boolean;
}

/** Default game config - standard No-Limit Texas Hold'em */
export const DEFAULT_CONFIG: GameConfig = {
  variant: 'holdem',
  betting: 'nl',
  holeCards: 2,
  hiLo: false,
  doubleBoard: false,
};

// Shared types for the pure game core.
// No DOM, no network, no side effects.

export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

/** A card is a 2-char string: rank + suit, e.g. "Ah", "Ts", "2c". */
export type Card = string;

export type Phase = 'idle' | 'preflop' | 'discard-preflop' | 'flop' | 'discard-postflop' | 'turn' | 'discard-post-turn' | 'river' | 'showdown';

export type ActionKind = 'fold' | 'check' | 'call' | 'raise' | 'discard';

export interface Action {
  kind: ActionKind;
  /** Raise-to amount (total bet for the street). Ignored for fold/check/call. */
  amount?: number;
  /** Card indices to discard (for discard actions in Pineapple/Irish) */
  discardIndices?: number[];
}

/** Numeric category of a 5-card hand, 0 (high card) through 8 (straight flush). */
export type HandCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface HandRank {
  /** Packed integer — higher = better. Directly comparable. */
  score: number;
  /** The 5 cards that form the best hand. */
  cards: Card[];
  /** Human-readable name, e.g. "Flush", "Two Pair". */
  name: string;
  category: HandCategory;
}

/** Side pot: a slice of the total pot with its own set of eligible winners. */
export interface SidePot {
  amount: number;
  /** Player indices that can win this pot (not folded, contributed enough). */
  eligible: number[];
}

/**
 * The authoritative game state. Multi-player (2 through ~9).
 * Mutated in place by engine reducers — kept as a single object (not a class)
 * so it's trivial to snapshot and diff in tests.
 */
export interface GameState {
  /** Number of seats. Fixed for a given game instance. */
  numPlayers: number;
  /** Player index this state belongs to (0..numPlayers-1). 0 = human in bot mode. */
  myIndex: number;

  names: string[];
  /** Persistent chip stacks (carried across hands). */
  chips: number[];

  /** Dealer button position (0..numPlayers-1). */
  buttonIndex: number;
  handNum: number;

  // ─── Per-hand state (reset each hand) ───────────────────────────────
  config: GameConfig;
  deck: Card[];
  /** Hole cards - tuple length matches config.holeCards (2, 3, or 4) */
  holeCards: (readonly Card[] | null)[];
  community: Card[];
  pot: number;
  bets: number[];
  /** Stacks DURING a hand (blinds/bets already deducted). */
  stacks: number[];
  /** Total chips each player has contributed to this hand (across streets). */
  handContribs: number[];
  phase: Phase;
  actingPlayer: number;
  /** Player index of the most recent raise. */
  lastAggressor: number;
  /** true once player has acted this street since the last aggression. */
  toAct: boolean[];
  allIn: boolean[];
  folded: boolean[];
  /** Last raise size (delta, not total). Used to compute min-raise. */
  lastRaiseSize: number;

  /** true once one player has all chips and nobody can play further. */
  gameOver: boolean;
}

/** Showdown outcome for one hand. */
export interface DealResult {
  /** One entry per side pot. Winner indices may overlap across pots. */
  pots: Array<{ amount: number; winners: number[]; reason: 'fold' | 'showdown' }>;
  /** Best hand per non-folded player (for display). */
  hands: (HandRank | null)[];
  reason: 'fold' | 'showdown';
}
