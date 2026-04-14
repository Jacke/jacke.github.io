import type { GameState, BettingStructure } from './types.js';

export const SB_AMOUNT = 10;
export const BB_AMOUNT = 20;
export const STARTING_STACK = 1000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

// Fixed-Limit bet sizes (for FL games)
export const FL_BET_PREFLOP = 20; // = BB
export const FL_BET_FLOP = 20;
export const FL_BET_TURN = 40; // doubles on turn/river
export const FL_BET_RIVER = 40;

// Maximum raises per betting round (common in FL)
export const MAX_RAISES_PER_STREET = 4;

/** Small blind position. Heads-up: button IS the SB. 3+: SB = button+1. */
export function sbIndex(state: Pick<GameState, 'buttonIndex' | 'numPlayers'>): number {
  return state.numPlayers === 2 ? state.buttonIndex : (state.buttonIndex + 1) % state.numPlayers;
}

/** Big blind position. Heads-up: non-button. 3+: SB+1. */
export function bbIndex(state: Pick<GameState, 'buttonIndex' | 'numPlayers'>): number {
  return state.numPlayers === 2
    ? (1 - state.buttonIndex + state.numPlayers) % state.numPlayers
    : (state.buttonIndex + 2) % state.numPlayers;
}

/** First player to act preflop. HU: SB (button). 3+: UTG = BB+1. */
export function firstActorPreflop(state: Pick<GameState, 'buttonIndex' | 'numPlayers'>): number {
  return state.numPlayers === 2 ? sbIndex(state) : (bbIndex(state) + 1) % state.numPlayers;
}

/** Cycle to next alive player (not folded, not all-in). Falls back to `from` if none. */
export function nextAlive(
  state: Pick<GameState, 'numPlayers' | 'folded' | 'allIn'>,
  from: number,
): number {
  for (let step = 1; step <= state.numPlayers; step++) {
    const i = (from + step) % state.numPlayers;
    if (!state.folded[i] && !state.allIn[i]) return i;
  }
  return from;
}

/** First alive player starting from (button+1). Used for first-to-act postflop. */
export function firstAliveAfterButton(
  state: Pick<GameState, 'numPlayers' | 'buttonIndex' | 'folded' | 'allIn'>,
): number {
  return nextAlive(state, state.buttonIndex);
}

/** Count players who haven't folded. */
export function aliveCount(state: Pick<GameState, 'numPlayers' | 'folded'>): number {
  let c = 0;
  for (let i = 0; i < state.numPlayers; i++) if (!state.folded[i]) c++;
  return c;
}

/** Count players who can still voluntarily act. */
export function actorCount(state: Pick<GameState, 'numPlayers' | 'folded' | 'allIn'>): number {
  let c = 0;
  for (let i = 0; i < state.numPlayers; i++) {
    if (!state.folded[i] && !state.allIn[i]) c++;
  }
  return c;
}

/** Max bet currently on the table this street. */
export function maxBet(state: Pick<GameState, 'bets'>): number {
  let m = 0;
  for (const b of state.bets) if (b > m) m = b;
  return m;
}

/** Chips the acting player must add to call the current max bet. */
export function callAmount(state: Pick<GameState, 'actingPlayer' | 'bets' | 'stacks'>): number {
  const p = state.actingPlayer;
  const top = maxBet(state);
  return Math.min(top - state.bets[p]!, state.stacks[p]!);
}

/**
 * Minimum legal raise amount (total bet, not delta).
 * Rule: min raise = current top bet + max(BB, last raise size).
 */
export function minRaiseAmount(
  state: Pick<GameState, 'bets' | 'lastRaiseSize'>,
): number {
  const top = maxBet(state);
  const lastRaise = Math.max(BB_AMOUNT, state.lastRaiseSize);
  return top + lastRaise;
}

/** Maximum total the acting player can raise to (shove). */
export function maxRaiseAmount(
  state: Pick<GameState, 'actingPlayer' | 'bets' | 'stacks'>,
): number {
  const p = state.actingPlayer;
  return state.bets[p]! + state.stacks[p]!;
}

export function isMyTurn(state: Pick<GameState, 'actingPlayer' | 'myIndex'>): boolean {
  return state.actingPlayer === state.myIndex;
}

/** Get the current bet size for Fixed-Limit based on phase */
export function flBetSize(phase: string): number {
  switch (phase) {
    case 'preflop':
    case 'flop':
      return FL_BET_PREFLOP;
    case 'turn':
    case 'river':
      return FL_BET_TURN;
    default:
      return FL_BET_PREFLOP;
  }
}

/** Check if a player can raise (respects betting structure) */
export function canRaise(
  state: Pick<GameState, 'bets' | 'stacks' | 'phase' | 'config'>,
): boolean {
  const config = state.config;
  const stack = state.stacks[state.actingPlayer]!;
  const topBet = maxBet(state);
  
  // No raise if no chips to raise with
  if (stack <= 0) return false;
  
  // For Fixed-Limit: can only raise if haven't hit max raises
  if (config.betting === 'fl') {
    const hasBet = topBet > 0;
    const canStillRaise = true; // Could track raise count per street
    return hasBet && canStillRaise;
  }
  
  // For Pot-Limit: check if pot-sized raise is possible
  if (config.betting === 'pl') {
    const potSize = state.pot + topBet * state.bets.filter((_, i) => i !== state.actingPlayer).reduce((a, b) => a + b, 0);
    const maxPLRaise = topBet + potSize;
    return stack >= maxPLRaise - state.bets[state.actingPlayer]!;
  }
  
  // No-Limit: can always raise if has chips
  return stack > 0;
}

/** Get max raise amount respecting betting structure */
export function maxRaise(
  state: Pick<GameState, 'actingPlayer' | 'bets' | 'stacks' | 'pot' | 'config'>,
): number {
  const config = state.config;
  const stack = state.stacks[state.actingPlayer]!;
  const topBet = maxBet(state);
  
  if (config.betting === 'fl') {
    const streetBet = flBetSize(state.phase);
    return topBet + streetBet; // FL only allows 1 raise per street
  }
  
  if (config.betting === 'pl') {
    // Pot-limit: max = current bet + pot
    const sidePots = state.pot; // Simplified
    const maxPL = state.bets[state.actingPlayer]! + stack;
    return Math.min(maxPL, topBet + sidePots);
  }
  
  // No-Limit: all-in
  return state.bets[state.actingPlayer]! + stack;
}

/** Get min raise amount respecting betting structure */
export function minRaise(
  state: Pick<GameState, 'bets' | 'lastRaiseSize' | 'config' | 'phase'>,
): number {
  const config = state.config;
  const top = maxBet(state);
  
  if (config.betting === 'fl') {
    return top + flBetSize(state.phase);
  }
  
  const lastRaise = Math.max(BB_AMOUNT, state.lastRaiseSize);
  return top + lastRaise;
}

/**
 * Check if a discard phase is needed for this variant.
 * Returns the phase after which discard happens, or null if no discard.
 */
export function getDiscardPhase(variant: string): string | null {
  switch (variant) {
    case 'pineapple':
      return 'discard-preflop';
    case 'crazypineapple':
      return 'discard-postflop';
    case 'irish':
      return 'discard-post-turn';
    default:
      return null;
  }
}

/** Get number of cards to discard for a variant */
export function getDiscardCount(variant: string): number {
  switch (variant) {
    case 'pineapple':
    case 'crazypineapple':
      return 1;
    case 'irish':
      return 2;
    default:
      return 0;
  }
}
