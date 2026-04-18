import type { Action, ActionKind, Card, DealResult, GameState, Phase, SidePot, GameConfig } from './types.js';
import { bestHand, bestHandOmaha } from './hands.js';
import {
  BB_AMOUNT, SB_AMOUNT, STARTING_STACK, MIN_PLAYERS, MAX_PLAYERS,
  actorCount, aliveCount, bbIndex, callAmount, firstActorPreflop,
  firstAliveAfterButton, maxBet, maxRaise, minRaise, nextAlive, sbIndex,
  canRaise as canRaiseBase, flBetSize, getDiscardPhase, getDiscardCount,
} from './rules.js';
import { getDeckSize, makeVariantDeck } from './cards.js';
import { DEFAULT_CONFIG } from './types.js';

// ═══════════════════════════════════════════════════════════════════════
// Events — emitted by each state transition so the UI can animate/log.
// ═══════════════════════════════════════════════════════════════════════

export type EngineEvent =
  | { kind: 'hand-start'; handNum: number; button: number }
  | { kind: 'blinds-posted'; sb: { player: number; amount: number }; bb: { player: number; amount: number } }
  | { kind: 'hole-cards'; cards: ReadonlyArray<readonly Card[] | null> }
  | { kind: 'action'; player: number; action: Action; effective: number; allIn: boolean }
  | { kind: 'phase'; phase: Phase }
  | { kind: 'community'; cards: Card[]; phase: 'flop' | 'turn' | 'river' }
  | { kind: 'showdown'; result: DealResult }
  | { kind: 'award'; pots: Array<{ winners: number[]; amount: number }>; reason: 'fold' | 'showdown' }
  | { kind: 'hand-end'; gameOver: boolean };

// ═══════════════════════════════════════════════════════════════════════
// State factory
// ═══════════════════════════════════════════════════════════════════════

export function createGameState(
  numPlayers: number,
  myIndex: number,
  names?: string[],
  startingStack: number = STARTING_STACK,
  config: GameConfig = DEFAULT_CONFIG,
): GameState {
  if (numPlayers < MIN_PLAYERS || numPlayers > MAX_PLAYERS) {
    throw new Error(`createGameState: numPlayers must be ${MIN_PLAYERS}-${MAX_PLAYERS}, got ${numPlayers}`);
  }
  if (myIndex < 0 || myIndex >= numPlayers) {
    throw new Error(`createGameState: myIndex ${myIndex} out of range for ${numPlayers} players`);
  }
  const resolvedNames = names && names.length === numPlayers
    ? names.slice()
    : Array.from({ length: numPlayers }, (_, i) => `Player ${i + 1}`);
  const zeros = (v: number) => Array.from({ length: numPlayers }, () => v);
  const falses = () => Array.from({ length: numPlayers }, () => false);
  return {
    numPlayers,
    myIndex,
    names: resolvedNames,
    chips: Array.from({ length: numPlayers }, () => startingStack),
    buttonIndex: 0,
    handNum: 0,
    config,
    deck: [],
    holeCards: Array.from({ length: numPlayers }, () => null),
    community: [],
    pot: 0,
    bets: zeros(0),
    stacks: Array.from({ length: numPlayers }, () => startingStack),
    handContribs: zeros(0),
    phase: 'idle',
    actingPlayer: 0,
    lastAggressor: 0,
    toAct: falses(),
    allIn: falses(),
    folded: falses(),
    lastRaiseSize: BB_AMOUNT,
    blinds: null,
    gameOver: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Hand start
// ═══════════════════════════════════════════════════════════════════════

/**
 * Begin a new hand with a pre-shuffled deck. Posts blinds, deals hole cards,
 * sets acting player. Caller should check if the hand immediately ended
 * (e.g. a blind put someone all-in AND only 1 non-all-in player remains).
 */
export function dealHand(state: GameState, deck: Card[]): EngineEvent[] {
  const expectedSize = getDeckSize(state.config.variant);
  if (deck.length !== expectedSize) {
    throw new Error(`dealHand expects a ${expectedSize}-card deck for ${state.config.variant}, got ${deck.length}`);
  }
  if (state.gameOver) throw new Error('dealHand called after game over');

  const events: EngineEvent[] = [];
  state.handNum++;
  state.phase = 'preflop';
  state.community = [];
  state.pot = 0;
  state.bets = new Array<number>(state.numPlayers).fill(0);
  state.allIn = new Array<boolean>(state.numPlayers).fill(false);
  state.folded = new Array<boolean>(state.numPlayers).fill(false);
  state.handContribs = new Array<number>(state.numPlayers).fill(0);
  state.deck = deck.slice();
  state.stacks = state.chips.slice();
  state.lastRaiseSize = BB_AMOUNT;

  events.push({ kind: 'hand-start', handNum: state.handNum, button: state.buttonIndex });

  // Deal hole cards based on variant config
  const holeCardCount = state.config.holeCards;
  const sb = sbIndex(state);
  const holeBuf: Array<Card[]> = Array.from({ length: state.numPlayers }, () => []);
  let deckIdx = 0;
  
  for (let round = 0; round < holeCardCount; round++) {
    for (let step = 0; step < state.numPlayers; step++) {
      const p = (sb + step) % state.numPlayers;
      holeBuf[p]!.push(state.deck[deckIdx++]!);
    }
  }
  state.holeCards = holeBuf.map(h => (h.length > 0 ? h as readonly Card[] : null));
  events.push({ kind: 'hole-cards', cards: state.holeCards });

  // Post antes (tournament only — cash mode leaves `blinds` null).
  const anteAmt = state.blinds?.ante ?? 0;
  if (anteAmt > 0) {
    for (let i = 0; i < state.numPlayers; i++) {
      const ante = Math.min(anteAmt, state.stacks[i]!);
      if (ante <= 0) continue;
      state.stacks[i]! -= ante;
      state.handContribs[i]! += ante;
      state.pot += ante;
      if (state.stacks[i] === 0) state.allIn[i] = true;
    }
  }

  // Post blinds. Tournament mode uses per-hand override; cash mode uses constants.
  const sbConfig = state.blinds?.sb ?? SB_AMOUNT;
  const bbConfig = state.blinds?.bb ?? BB_AMOUNT;
  const bb = bbIndex(state);
  const sbAmt = Math.min(sbConfig, state.stacks[sb]!);
  const bbAmt = Math.min(bbConfig, state.stacks[bb]!);
  postBlind(state, sb, sbAmt);
  postBlind(state, bb, bbAmt);
  state.lastRaiseSize = bbConfig;
  events.push({
    kind: 'blinds-posted',
    sb: { player: sb, amount: sbAmt },
    bb: { player: bb, amount: bbAmt },
  });

  // Initialize per-player "needs to act" flags. Everyone non-folded non-all-in
  // starts with toAct=true. BB already has option preflop, so leave as true.
  state.toAct = state.folded.map((f, i) => !f && !state.allIn[i]!);
  state.actingPlayer = firstActorPreflop(state);
  // Skip any all-in players (shouldn't happen from blinds in a healthy game
  // with > 2 players, but defensive).
  if (state.folded[state.actingPlayer] || state.allIn[state.actingPlayer]) {
    state.actingPlayer = nextAlive(state, state.actingPlayer);
  }
  state.lastAggressor = bb;
  events.push({ kind: 'phase', phase: 'preflop' });
  return events;
}

function postBlind(state: GameState, player: number, amount: number): void {
  state.stacks[player]! -= amount;
  state.bets[player] = amount;
  state.handContribs[player] = (state.handContribs[player] ?? 0) + amount;
  state.pot += amount;
  if (state.stacks[player] === 0) state.allIn[player] = true;
}

// ═══════════════════════════════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════════════════════════════

export interface ApplyActionResult {
  events: EngineEvent[];
  /** True if the current betting round is now closed (advance to next street). */
  roundClosed: boolean;
  /** True if the hand ended entirely (fold-to-one or immediate showdown). */
  handEnded: boolean;
}

/**
 * Apply a player action. Mutates state. Validates legality and throws on illegal input.
 */
export function applyAction(
  state: GameState,
  playerIdx: number,
  action: Action,
): ApplyActionResult {
  if (state.phase === 'idle' || state.phase === 'showdown') {
    throw new Error(`applyAction in phase ${state.phase}`);
  }
  if (state.actingPlayer !== playerIdx) {
    throw new Error(`not ${playerIdx}'s turn (acting=${state.actingPlayer})`);
  }
  if (state.folded[playerIdx]) {
    throw new Error(`player ${playerIdx} has folded`);
  }
  if (state.allIn[playerIdx]) {
    throw new Error(`player ${playerIdx} is all-in`);
  }

  const events: EngineEvent[] = [];
  let effective = 0;

  switch (action.kind) {
    case 'fold': {
      state.folded[playerIdx] = true;
      state.toAct[playerIdx] = false;
      events.push({ kind: 'action', player: playerIdx, action, effective: 0, allIn: false });
      // Fold-wins: only one non-folded player left.
      if (aliveCount(state) === 1) {
        const events2 = awardToLastStanding(state);
        return { events: [...events, ...events2], roundClosed: true, handEnded: true };
      }
      break;
    }

    case 'check': {
      if (callAmount(state) !== 0) {
        throw new Error(`cannot check: must call ${callAmount(state)}`);
      }
      state.toAct[playerIdx] = false;
      events.push({ kind: 'action', player: playerIdx, action, effective: 0, allIn: false });
      break;
    }

    case 'call': {
      const toCall = callAmount(state);
      state.stacks[playerIdx]! -= toCall;
      state.bets[playerIdx]! += toCall;
      state.handContribs[playerIdx]! += toCall;
      state.pot += toCall;
      effective = toCall;
      const allIn = state.stacks[playerIdx] === 0;
      if (allIn) state.allIn[playerIdx] = true;
      state.toAct[playerIdx] = false;
      events.push({ kind: 'action', player: playerIdx, action, effective, allIn });
      break;
    }

    case 'raise': {
      const target = action.amount ?? 0;
      const maxTotal = state.bets[playerIdx]! + state.stacks[playerIdx]!;
      const total = Math.min(target, maxTotal);
      const extra = total - state.bets[playerIdx]!;
      if (extra <= 0) throw new Error(`illegal raise: total ${total} <= current bet ${state.bets[playerIdx]}`);
      const priorTop = maxBet(state);
      state.stacks[playerIdx]! -= extra;
      state.bets[playerIdx] = total;
      state.handContribs[playerIdx]! += extra;
      state.pot += extra;
      state.lastRaiseSize = Math.max(BB_AMOUNT, total - priorTop);
      state.lastAggressor = playerIdx;
      effective = extra;
      const allIn = state.stacks[playerIdx] === 0;
      if (allIn) state.allIn[playerIdx] = true;
      state.toAct[playerIdx] = false;
      // A raise re-opens action for all other non-folded non-all-in players.
      for (let i = 0; i < state.numPlayers; i++) {
        if (i === playerIdx) continue;
        if (!state.folded[i] && !state.allIn[i]) state.toAct[i] = true;
      }
      events.push({ kind: 'action', player: playerIdx, action: { kind: 'raise', amount: total }, effective, allIn });
      break;
    }
  }

  // Determine if the round is closed: nobody still needs to act.
  const stillToAct = state.toAct.some((t, i) => t && !state.folded[i] && !state.allIn[i]);

  if (!stillToAct) {
    return { events, roundClosed: true, handEnded: false };
  }

  // Advance to next alive player who still needs to act.
  state.actingPlayer = nextActorToAct(state, playerIdx);
  return { events, roundClosed: false, handEnded: false };
}

function nextActorToAct(state: GameState, from: number): number {
  for (let step = 1; step <= state.numPlayers; step++) {
    const i = (from + step) % state.numPlayers;
    if (!state.folded[i] && !state.allIn[i] && state.toAct[i]) return i;
  }
  // Fallback — shouldn't happen; stillToAct would be false.
  return nextAlive(state, from);
}

// ═══════════════════════════════════════════════════════════════════════
// Street progression
// ═══════════════════════════════════════════════════════════════════════

/**
 * Advance to the next street after a closed betting round. If only one player
 * can still act (others all-in or folded), this may trigger run-out via the
 * caller — but this function only moves one street forward.
 */
export function nextStreet(state: GameState): EngineEvent[] {
  if (state.phase === 'idle' || state.phase === 'showdown') {
    throw new Error(`nextStreet in phase ${state.phase}`);
  }
  const events: EngineEvent[] = [];

  state.bets = new Array<number>(state.numPlayers).fill(0);
  state.lastRaiseSize = state.blinds?.bb ?? BB_AMOUNT;

  // Check if we need to go through a discard phase
  const discardPhase = getDiscardPhase(state.config.variant);
  const needsDiscard = discardPhase && shouldGoToDiscard(state.phase, discardPhase);
  
  if (needsDiscard) {
    // Go to discard phase instead of dealing community cards
    const discardCount = getDiscardCount(state.config.variant);
    state.phase = discardPhase as Phase;
    state.toAct = state.folded.map((f, i) => !f && !state.allIn[i]!);
    state.actingPlayer = firstAliveAfterButton(state);
    events.push({ kind: 'phase', phase: state.phase });
    return events;
  }

  // River → showdown.
  if (state.phase === 'river') {
    events.push(...doShowdown(state));
    return events;
  }

  // Deal next street's community cards.
  switch (state.phase) {
    case 'preflop': {
      const cards = [state.deck[4]!, state.deck[5]!, state.deck[6]!];
      state.community = cards.slice();
      state.phase = 'flop';
      events.push({ kind: 'community', cards, phase: 'flop' });
      break;
    }
    case 'flop': {
      const card = state.deck[7]!;
      state.community.push(card);
      state.phase = 'turn';
      events.push({ kind: 'community', cards: [card], phase: 'turn' });
      break;
    }
    case 'turn': {
      const card = state.deck[8]!;
      state.community.push(card);
      state.phase = 'river';
      events.push({ kind: 'community', cards: [card], phase: 'river' });
      break;
    }
    // Handle transition from discard phases to next street
    case 'discard-preflop': {
      const cards = [state.deck[4]!, state.deck[5]!, state.deck[6]!];
      state.community = cards.slice();
      state.phase = 'flop';
      events.push({ kind: 'community', cards, phase: 'flop' });
      break;
    }
    case 'discard-postflop': {
      const card = state.deck[7]!;
      state.community.push(card);
      state.phase = 'turn';
      events.push({ kind: 'community', cards: [card], phase: 'turn' });
      break;
    }
    case 'discard-post-turn': {
      const card = state.deck[8]!;
      state.community.push(card);
      state.phase = 'river';
      events.push({ kind: 'community', cards: [card], phase: 'river' });
      break;
    }
  }

  // Set toAct flags for the new street: everyone still active owes an action.
  state.toAct = state.folded.map((f, i) => !f && !state.allIn[i]!);

  // First alive player after button acts first postflop.
  state.actingPlayer = firstAliveAfterButton(state);
  events.push({ kind: 'phase', phase: state.phase });
  return events;
}

/** Check if current phase should transition to the discard phase */
function shouldGoToDiscard(currentPhase: string, discardPhase: string): boolean {
  if (discardPhase === 'discard-preflop' && currentPhase === 'preflop') return true;
  if (discardPhase === 'discard-postflop' && currentPhase === 'flop') return true;
  if (discardPhase === 'discard-post-turn' && currentPhase === 'turn') return true;
  return false;
}

/** Apply a discard action (discard selected cards) */
export function applyDiscard(state: GameState, playerIdx: number, discardIndices: number[]): EngineEvent[] {
  const hole = state.holeCards[playerIdx];
  if (!hole) throw new Error('applyDiscard: no hole cards');
  
  const discardCount = getDiscardCount(state.config.variant);
  if (discardIndices.length !== discardCount) {
    throw new Error(`applyDiscard: must discard exactly ${discardCount} cards, got ${discardIndices.length}`);
  }
  
  // Sort indices descending to remove from end first
  const sorted = [...discardIndices].sort((a, b) => b - a);
  const newHole = [...hole];
  for (const idx of sorted) {
    if (idx < 0 || idx >= newHole.length) {
      throw new Error(`applyDiscard: invalid index ${idx}`);
    }
    newHole.splice(idx, 1);
  }
  
  state.holeCards[playerIdx] = newHole as readonly Card[];
  
  return [];
}

/**
 * Deal all remaining community cards and go straight to showdown. Used when
 * all remaining players are all-in (no more actions possible).
 */
export function finishToShowdown(state: GameState): EngineEvent[] {
  const events: EngineEvent[] = [];
  state.bets = new Array<number>(state.numPlayers).fill(0);

  while (state.phase !== 'showdown' && state.phase !== 'idle') {
    if (state.phase === 'river') {
      events.push(...doShowdown(state));
      break;
    }
    // Deal the next street without invoking the toAct/actingPlayer logic.
    switch (state.phase) {
      case 'preflop': {
        const cards = [state.deck[4]!, state.deck[5]!, state.deck[6]!];
        state.community = cards.slice();
        state.phase = 'flop';
        events.push({ kind: 'community', cards, phase: 'flop' });
        break;
      }
      case 'flop': {
        const card = state.deck[7]!;
        state.community.push(card);
        state.phase = 'turn';
        events.push({ kind: 'community', cards: [card], phase: 'turn' });
        break;
      }
      case 'turn': {
        const card = state.deck[8]!;
        state.community.push(card);
        state.phase = 'river';
        events.push({ kind: 'community', cards: [card], phase: 'river' });
        break;
      }
      default:
        break;
    }
  }

  return events;
}

// ═══════════════════════════════════════════════════════════════════════
// Showdown + side pots
// ═══════════════════════════════════════════════════════════════════════

/** Build side pots from per-player contributions + folded flags. */
export function buildSidePots(
  contributions: readonly number[],
  folded: readonly boolean[],
): SidePot[] {
  const n = contributions.length;
  const left = contributions.slice();
  const pots: SidePot[] = [];

  while (true) {
    let min = Infinity;
    for (let i = 0; i < n; i++) {
      if (left[i]! > 0 && left[i]! < min) min = left[i]!;
    }
    if (min === Infinity) break;

    let amount = 0;
    const eligible: number[] = [];
    for (let i = 0; i < n; i++) {
      if (left[i]! >= min) {
        amount += min;
        left[i]! -= min;
        if (!folded[i]) eligible.push(i);
      }
    }
    // Merge with previous pot if the eligible set matches — keeps the list tight.
    const prev = pots[pots.length - 1];
    if (prev && sameSet(prev.eligible, eligible)) {
      prev.amount += amount;
    } else {
      pots.push({ amount, eligible });
    }
  }
  return pots;
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const x of b) if (!s.has(x)) return false;
  return true;
}

export function doShowdown(state: GameState): EngineEvent[] {
  state.phase = 'showdown';
  const events: EngineEvent[] = [{ kind: 'phase', phase: 'showdown' }];

  const n = state.numPlayers;
  const hands: (ReturnType<typeof bestHand> | null)[] = new Array(n).fill(null);
  const variant = state.config.variant;
  
  for (let i = 0; i < n; i++) {
    if (state.folded[i]) continue;
    const hole = state.holeCards[i];
    if (!hole) continue;
    
    // Omaha: must use exactly 2 hole cards
    if (variant === 'omaha' || variant === 'irish') {
      if (hole.length === 4 && state.community.length >= 3) {
        hands[i] = bestHandOmaha([...hole], [...state.community], variant);
      } else {
        hands[i] = bestHand([...hole, ...state.community], variant);
      }
    } else {
      hands[i] = bestHand([...hole, ...state.community], variant);
    }
  }

  const pots = buildSidePots(state.handContribs, state.folded);
  const awards: Array<{ winners: number[]; amount: number }> = [];

  for (const pot of pots) {
    if (pot.eligible.length === 0) continue;
    let best = -Infinity;
    let winners: number[] = [];
    for (const p of pot.eligible) {
      const h = hands[p];
      if (!h) continue;
      if (h.score > best) {
        best = h.score;
        winners = [p];
      } else if (h.score === best) {
        winners.push(p);
      }
    }
    if (winners.length === 0) continue;
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const w of winners) {
      state.stacks[w]! += share;
      if (remainder > 0) { state.stacks[w]! += 1; remainder--; }
    }
    awards.push({ winners, amount: pot.amount });
  }

  const result: DealResult = {
    pots: awards.map(a => ({ amount: a.amount, winners: a.winners, reason: 'showdown' })),
    hands,
    reason: 'showdown',
  };
  events.push({ kind: 'showdown', result });

  state.pot = 0;
  state.chips = state.stacks.slice();
  events.push({ kind: 'award', pots: awards, reason: 'showdown' });

  const alive = state.chips.filter(c => c > 0).length;
  const gameOver = alive <= 1;
  if (gameOver) state.gameOver = true;
  events.push({ kind: 'hand-end', gameOver });

  return events;
}

/** Called when everyone but one folded — that one takes the pot uncontested. */
function awardToLastStanding(state: GameState): EngineEvent[] {
  const events: EngineEvent[] = [];
  const winner = state.folded.findIndex(f => !f);
  if (winner < 0) return events;

  const pot = state.pot;
  state.stacks[winner]! += pot;
  state.pot = 0;
  state.chips = state.stacks.slice();

  events.push({ kind: 'award', pots: [{ winners: [winner], amount: pot }], reason: 'fold' });

  const alive = state.chips.filter(c => c > 0).length;
  const gameOver = alive <= 1;
  if (gameOver) state.gameOver = true;
  events.push({ kind: 'hand-end', gameOver });
  return events;
}

// ═══════════════════════════════════════════════════════════════════════
// Next hand
// ═══════════════════════════════════════════════════════════════════════

/**
 * Rotate the button to the next player with chips. Resets per-hand state.
 * Skip-busted rotation: if the next player has 0 chips, keep moving.
 */
export function startNextHand(state: GameState): void {
  if (state.gameOver) throw new Error('startNextHand after game over');
  let next = (state.buttonIndex + 1) % state.numPlayers;
  for (let step = 0; step < state.numPlayers; step++) {
    if (state.chips[next]! > 0) break;
    next = (next + 1) % state.numPlayers;
  }
  state.buttonIndex = next;
  state.phase = 'idle';
  state.pot = 0;
  state.bets = new Array<number>(state.numPlayers).fill(0);
  state.community = [];
  state.holeCards = new Array(state.numPlayers).fill(null);
  state.allIn = new Array<boolean>(state.numPlayers).fill(false);
  state.folded = new Array<boolean>(state.numPlayers).fill(false);
  state.handContribs = new Array<number>(state.numPlayers).fill(0);
  state.toAct = new Array<boolean>(state.numPlayers).fill(false);
}

// ═══════════════════════════════════════════════════════════════════════
// Convenience
// ═══════════════════════════════════════════════════════════════════════

/** Legal action kinds for the current acting player. */
export function legalActions(state: GameState): ActionKind[] {
  if (state.phase === 'idle' || state.phase === 'showdown') return [];
  
  const p = state.actingPlayer;
  if (state.folded[p] || state.allIn[p]) return [];
  
  // Handle discard phases (Pineapple, Crazy Pineapple, Irish)
  if (state.phase === 'discard-preflop' || state.phase === 'discard-postflop' || state.phase === 'discard-post-turn') {
    const discardCount = getDiscardCount(state.config.variant);
    if (discardCount > 0 && state.holeCards[p] && state.holeCards[p]!.length >= discardCount) {
      return ['discard'];
    }
    return [];
  }
  
  const toCall = callAmount(state);
  const canRaise = state.stacks[p]! > toCall; // must have chips left after calling
  const actions: ActionKind[] = ['fold'];
  if (toCall === 0) actions.push('check');
  else actions.push('call');
  if (canRaise) actions.push('raise');
  return actions;
}

/** True if no more voluntary action is possible (0 or 1 players left who can act). */
export function noMoreAction(state: GameState): boolean {
  return actorCount(state) <= 1;
}
