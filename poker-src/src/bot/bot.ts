import type { Action, Card, GameState, GameVariant } from '../core/types.js';
import { bestHand, bestHandOmaha } from '../core/hands.js';
import { RANKS, SUITS, rankOf, suitOf, shortDeckRankOf, mulberry32, type Rng } from '../core/cards.js';
import { BB_AMOUNT, callAmount, minRaiseAmount } from '../core/rules.js';
import { legalActions } from '../core/engine.js';

export type Difficulty = 'easy' | 'medium' | 'hard';

// ═══════════════════════════════════════════════════════════════════════
// Decision context — common inputs every strategy needs.
// ═══════════════════════════════════════════════════════════════════════

interface DecisionContext {
  state: GameState;
  me: number;
  hole: readonly Card[];
  toCall: number;
  legal: Set<string>;
  /** Required equity to make a call profitable (pot odds). */
  requiredEquity: number;
  /** Game variant */
  variant: GameVariant;
}

function buildContext(state: GameState): DecisionContext {
  const me = state.actingPlayer;
  const hole = state.holeCards[me];
  if (!hole) throw new Error('bot: no hole cards for acting player');
  const toCall = callAmount(state);
  const legal = new Set(legalActions(state));
  const requiredEquity = toCall === 0 ? 0 : toCall / (state.pot + toCall);
  return { state, me, hole, toCall, legal, requiredEquity, variant: state.config.variant };
}

// ═══════════════════════════════════════════════════════════════════════
// Hand strength heuristics
// ═══════════════════════════════════════════════════════════════════════

/** Get rank value based on variant */
function getRankValue(card: Card, variant?: GameVariant): number {
  if (variant === 'shortdeck') {
    return shortDeckRankOf(card);
  }
  return rankOf(card);
}

/** Very simple preflop hand score in [0..1] for standard 2-card hands. */
export function preflopScore2Cards(hole: readonly Card[], variant?: GameVariant): number {
  if (hole.length !== 2) return preflopScoreMulti(hole, variant);
  
  const r1 = getRankValue(hole[0], variant);
  const r2 = getRankValue(hole[1], variant);
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const pair = r1 === r2;
  const suited = suitOf(hole[0]) === suitOf(hole[1]);
  const gap = hi - lo;

  // Base strength from high card + a bit from low card.
  let score = (hi / 14) * 0.45 + (lo / 14) * 0.15;

  if (pair) {
    // Pair bonus — scales with rank. AA ≈ 0.98, 22 ≈ 0.52.
    score = 0.4 + (hi / 14) * 0.58;
  } else {
    if (suited) score += 0.07;
    if (gap === 1) score += 0.06; // connector
    else if (gap === 2) score += 0.03;
    else if (gap === 3) score += 0.01;

    // Penalize offsuit rags.
    if (!suited && gap >= 4 && lo < 10) score -= 0.08;
    if (!suited && hi < 10) score -= 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

/** Preflop score for games with 3+ hole cards (Pineapple, Omaha, Irish) */
function preflopScoreMulti(hole: readonly Card[], variant?: GameVariant): number {
  if (hole.length < 3) return preflopScore2Cards(hole, variant);
  
  // For multi-card games, evaluate all 2-card combinations and take the best
  let bestScore = 0;
  
  // Generate all C(n,2) combinations
  const n = hole.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const score = preflopScore2Cards([hole[i]!, hole[j]!], variant);
      if (score > bestScore) bestScore = score;
    }
  }
  
  // In Omaha/Irish, having more cards gives more potential - slightly boost
  if (n >= 4) bestScore *= 1.05;
  
  return Math.min(1, bestScore);
}

/** Main preflop score function - dispatches based on hole card count */
export function preflopScore(hole: readonly Card[], variant?: GameVariant): number {
  if (hole.length === 2) {
    return preflopScore2Cards(hole, variant);
  }
  return preflopScoreMulti(hole, variant);
}

/** Postflop: hand-category-based strength in [0..1]. Cheap. */
export function postflopCategoryStrength(state: GameState): number {
  const me = state.actingPlayer;
  const hole = state.holeCards[me];
  if (!hole || state.community.length < 3) return 0;
  
  const variant = state.config.variant;
  
  // Omaha uses special bestHand that enforces exactly 2 hole cards
  if ((variant === 'omaha' || variant === 'irish') && hole.length === 4 && state.community.length >= 3) {
    const hand = bestHandOmaha([...hole], [...state.community], variant);
    const ladder = [0.20, 0.40, 0.55, 0.70, 0.80, 0.87, 0.93, 0.98, 1.00];
    return ladder[hand.category] ?? 0.2;
  }
  
  const hand = bestHand([...hole, ...state.community], variant);
  // High card (0) → 0.20, pair (1) → 0.40, two pair (2) → 0.55,
  // trips (3) → 0.70, straight (4) → 0.80, flush (5) → 0.87,
  // boat (6) → 0.93, quads (7) → 0.98, SF (8) → 1.00.
  const ladder = [0.20, 0.40, 0.55, 0.70, 0.80, 0.87, 0.93, 0.98, 1.00];
  return ladder[hand.category] ?? 0.2;
}

/**
 * Monte-Carlo equity estimate — samples random runouts + random villain hole
 * cards from the remaining deck and tallies win/tie/loss.
 * Returns a number in [0..1].
 * Supports Short Deck (36 cards) and Omaha variants.
 */
export function monteCarloEquity(
  state: GameState,
  iterations: number,
  rng: Rng = Math.random,
): number {
  const me = state.actingPlayer;
  const hole = state.holeCards[me];
  if (!hole) return 0;

  const variant = state.config.variant;
  const isShortDeck = variant === 'shortdeck';
  
  // Short Deck ranks
  const shortDeckRanks = ['6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const ranks = isShortDeck ? shortDeckRanks : RANKS;
  
  const known = new Set<Card>([...hole, ...state.community]);
  const remaining: Card[] = [];
  for (const s of SUITS) {
    for (const r of ranks) {
      const c = r + s;
      if (!known.has(c)) remaining.push(c);
    }
  }

  const needBoard = 5 - state.community.length;
  // For Omaha, villain also has 4 hole cards (we'll pick best 2)
  const isOmaha = (variant === 'omaha' || variant === 'irish') && hole.length === 4;
  const draws = isOmaha 
    ? needBoard + 4 // runout + 4 villain hole cards for Omaha
    : needBoard + 2; // runout + 2 villain hole cards for Hold'em
  if (draws > remaining.length) return 0;

  let wins = 0;
  let ties = 0;
  const deck = remaining.slice();
  const n = deck.length;

  for (let iter = 0; iter < iterations; iter++) {
    // Partial Fisher-Yates: only shuffle the first `draws` positions.
    for (let i = 0; i < draws; i++) {
      const j = i + Math.floor(rng() * (n - i));
      const tmp = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = tmp;
    }
    const board = state.community.slice();
    for (let i = 0; i < needBoard; i++) board.push(deck[i]!);

    // Calculate my hand
    let myHand: ReturnType<typeof bestHand>;
    if (isOmaha && hole.length === 4) {
      myHand = bestHandOmaha([...hole], board, variant);
    } else {
      myHand = bestHand([...hole, ...board], variant);
    }

    // Calculate villain hand
    let vHand: ReturnType<typeof bestHand>;
    if (isOmaha) {
      const villainHole = [deck[needBoard]!, deck[needBoard + 1]!, deck[needBoard + 2]!, deck[needBoard + 3]!];
      vHand = bestHandOmaha(villainHole, board, variant);
    } else {
      const villainHole = [deck[needBoard]!, deck[needBoard + 1]!];
      vHand = bestHand([...villainHole, ...board], variant);
    }

    if (myHand.score > vHand.score) wins++;
    else if (myHand.score === vHand.score) ties++;
  }

  return (wins + ties * 0.5) / iterations;
}

// ═══════════════════════════════════════════════════════════════════════
// Raise sizing helpers
// ═══════════════════════════════════════════════════════════════════════

type RaiseSize = 'min' | 'half' | 'value' | 'pot';

function raiseTo(state: GameState, size: RaiseSize): number {
  const me = state.actingPlayer;
  const myBet = state.bets[me] ?? 0;
  const myStack = state.stacks[me] ?? 0;
  const maxTotal = myBet + myStack;
  const minTotal = Math.min(minRaiseAmount(state), maxTotal);

  // Base target off the current top bet — works for N players.
  let topBet = 0;
  for (const b of state.bets) if (b > topBet) topBet = b;

  let target: number;
  switch (size) {
    case 'min':
      target = minTotal;
      break;
    case 'half':
      target = topBet + Math.max(BB_AMOUNT, Math.floor(state.pot / 2));
      break;
    case 'value':
      target = topBet + Math.max(BB_AMOUNT, Math.floor(state.pot * 0.75));
      break;
    case 'pot':
      target = topBet + Math.max(BB_AMOUNT, state.pot);
      break;
  }
  return Math.max(minTotal, Math.min(target, maxTotal));
}

// ═══════════════════════════════════════════════════════════════════════
// Strategies
// ═══════════════════════════════════════════════════════════════════════

/**
 * Easy: passive and loose-call. Never raises. Calls with almost anything.
 * Human should usually win against this.
 */
function decideEasy(c: DecisionContext, rng: Rng): Action {
  // Handle discard phase - return discard indices
  if (c.state.phase === 'discard-preflop' || c.state.phase === 'discard-postflop' || c.state.phase === 'discard-post-turn') {
    return decideDiscard(c.hole, c.state.config.variant);
  }
  
  const strength = c.state.phase === 'preflop'
    ? preflopScore(c.hole, c.variant)
    : postflopCategoryStrength(c.state);

  if (c.toCall === 0) return { kind: 'check' };

  // Big call → fold more often even with decent hand.
  const myStack = c.state.stacks[c.me] ?? 0;
  const relativeCost = c.toCall / Math.max(myStack + c.toCall, 1);
  if (relativeCost > 0.4 && strength < 0.6) return { kind: 'fold' };

  // Call with almost any pair or face-heavy holding.
  if (strength >= 0.28) return { kind: 'call' };

  // Occasional curious calls.
  if (rng() < 0.2 && c.toCall <= BB_AMOUNT * 2) return { kind: 'call' };

  return { kind: 'fold' };
}

/**
 * Medium: value-oriented, folds weak to aggression, occasionally bets for value.
 */
function decideMedium(c: DecisionContext, rng: Rng): Action {
  // Handle discard phase - return discard indices
  if (c.state.phase === 'discard-preflop' || c.state.phase === 'discard-postflop' || c.state.phase === 'discard-post-turn') {
    return decideDiscard(c.hole, c.state.config.variant);
  }
  
  const strength = c.state.phase === 'preflop'
    ? preflopScore(c.hole, c.variant)
    : postflopCategoryStrength(c.state);

  if (c.toCall === 0) {
    if (strength > 0.72 && c.legal.has('raise')) {
      return { kind: 'raise', amount: raiseTo(c.state, 'half') };
    }
    if (strength > 0.55 && c.legal.has('raise') && rng() < 0.4) {
      return { kind: 'raise', amount: raiseTo(c.state, 'half') };
    }
    return { kind: 'check' };
  }

  // Facing a bet
  if (strength >= 0.88 && c.legal.has('raise')) {
    return { kind: 'raise', amount: raiseTo(c.state, 'value') };
  }
  if (strength > c.requiredEquity + 0.1) return { kind: 'call' };
  // Small bet → sometimes float.
  if (c.requiredEquity < 0.2 && strength > 0.35 && rng() < 0.5) return { kind: 'call' };
  return { kind: 'fold' };
}

/**
 * Hard: equity-aware via Monte Carlo on flop+. Plays reasonable NLH.
 */
function decideHard(c: DecisionContext, rng: Rng): Action {
  // Handle discard phase - return discard indices
  if (c.state.phase === 'discard-preflop' || c.state.phase === 'discard-postflop' || c.state.phase === 'discard-post-turn') {
    return decideDiscard(c.hole, c.state.config.variant);
  }
  
  const preflop = c.state.phase === 'preflop';
  const equity = preflop
    ? preflopScore(c.hole, c.variant)
    : monteCarloEquity(c.state, 350, rng);

  if (c.toCall === 0) {
    // No bet to face — bet for value or bluff occasionally.
    if (equity > 0.78 && c.legal.has('raise')) {
      return { kind: 'raise', amount: raiseTo(c.state, 'pot') };
    }
    if (equity > 0.62 && c.legal.has('raise')) {
      return { kind: 'raise', amount: raiseTo(c.state, 'half') };
    }
    // Small bluff frequency on later streets.
    if (!preflop && equity > 0.35 && equity < 0.5 && rng() < 0.15 && c.legal.has('raise')) {
      return { kind: 'raise', amount: raiseTo(c.state, 'half') };
    }
    return { kind: 'check' };
  }

  // Facing a bet.
  if (equity > 0.82 && c.legal.has('raise')) {
    return { kind: 'raise', amount: raiseTo(c.state, 'pot') };
  }
  if (equity > 0.68 && c.legal.has('raise') && rng() < 0.6) {
    return { kind: 'raise', amount: raiseTo(c.state, 'value') };
  }
  if (equity > c.requiredEquity + 0.06) return { kind: 'call' };
  return { kind: 'fold' };
}

// ═══════════════════════════════════════════════════════════════════════
// Discard strategy for Pineapple/Irish
// ═══════════════════════════════════════════════════════════════════════

/**
 * Decide which cards to discard in Pineapple/Irish variants.
 * Returns indices of cards to discard.
 */
function decideDiscard(hole: readonly Card[], variant: GameVariant): Action {
  if (hole.length < 3) {
    return { kind: 'discard', discardIndices: [] };
  }
  
  // Get rank values
  const getRank = (c: Card) => getRankValue(c, variant);
  
  // Score each 2-card combination
  const scores: { idx1: number; idx2: number; score: number }[] = [];
  const n = hole.length;
  const discardCount = variant === 'irish' ? 2 : 1;
  
  // For discard-1 (Pineapple): find worst 2-card combo, discard the 3rd card
  if (discardCount === 1) {
    // Find the 2-card combination with lowest score - that's the "keep"
    // The card NOT in that combo is the discard
    let worstScore = Infinity;
    let discardIdx = 0;
    
    for (let i = 0; i < n; i++) {
      // Try discarding card i, keep the rest
      const remaining = hole.filter((_, idx) => idx !== i);
      const score = preflopScore2Cards(remaining, variant);
      if (score < worstScore) {
        worstScore = score;
        discardIdx = i;
      }
    }
    return { kind: 'discard', discardIndices: [discardIdx] };
  }
  
  // For discard-2 (Irish): find worst pair to discard
  if (discardCount === 2) {
    let worstScore = Infinity;
    let discardIdxs: number[] = [0, 1];
    
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // Try discarding cards i and j
        const remaining = hole.filter((_, idx) => idx !== i && idx !== j);
        const score = preflopScore2Cards(remaining, variant);
        if (score < worstScore) {
          worstScore = score;
          discardIdxs = [i, j];
        }
      }
    }
    return { kind: 'discard', discardIndices: discardIdxs };
  }
  
  // Fallback: discard first card(s)
  return { 
    kind: 'discard', 
    discardIndices: Array.from({ length: discardCount }, (_, i) => i) 
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Public entry point
// ═══════════════════════════════════════════════════════════════════════

export interface DecideOptions {
  /** Optional seeded RNG for reproducible tests. */
  rng?: Rng;
}

/**
 * Decide an action for the bot. Guarantees a legal action by falling back
 * gracefully if the difficulty strategy returns something illegal.
 */
export function decideAction(
  state: GameState,
  difficulty: Difficulty,
  options: DecideOptions = {},
): Action {
  const rng = options.rng ?? Math.random;
  const c = buildContext(state);

  if (c.legal.size === 0) {
    throw new Error(`bot: no legal actions (phase=${state.phase}, player=${state.actingPlayer})`);
  }

  let chosen: Action;
  switch (difficulty) {
    case 'easy':   chosen = decideEasy(c, rng); break;
    case 'medium': chosen = decideMedium(c, rng); break;
    case 'hard':   chosen = decideHard(c, rng); break;
  }

  return coerceToLegal(chosen, c);
}

/** If the strategy returned an illegal action, degrade to the safest legal one. */
function coerceToLegal(a: Action, c: DecisionContext): Action {
  const l = c.legal;
  if (a.kind === 'check' && !l.has('check')) {
    if (l.has('call') && c.requiredEquity <= 0.2) return { kind: 'call' };
    return { kind: 'fold' };
  }
  if (a.kind === 'call' && !l.has('call')) {
    if (l.has('check')) return { kind: 'check' };
    return { kind: 'fold' };
  }
  if (a.kind === 'raise' && !l.has('raise')) {
    if (l.has('call')) return { kind: 'call' };
    if (l.has('check')) return { kind: 'check' };
    return { kind: 'fold' };
  }
  if (a.kind === 'raise') {
    // Clamp raise amount into legal range.
    const myBet = c.state.bets[c.me] ?? 0;
    const myStack = c.state.stacks[c.me] ?? 0;
    const maxTotal = myBet + myStack;
    const minTotal = Math.min(minRaiseAmount(c.state), maxTotal);
    const target = Math.max(minTotal, Math.min(a.amount ?? minTotal, maxTotal));
    return { kind: 'raise', amount: target };
  }
  return a;
}

// ═══════════════════════════════════════════════════════════════════════
// Timing — how long the bot should "think" before acting, for UX
// ═══════════════════════════════════════════════════════════════════════

export function thinkDelayMs(difficulty: Difficulty, rng: Rng = Math.random): number {
  const base = { easy: 450, medium: 650, hard: 850 }[difficulty];
  return base + Math.floor(rng() * 400);
}

// Re-export for tests that want a seeded RNG.
export { mulberry32 };
