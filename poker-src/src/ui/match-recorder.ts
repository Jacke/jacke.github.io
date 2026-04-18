import type { Card } from '../core/types.js';

/**
 * Match recorder — buffers deck + action sequence for every hand in a match,
 * then saves to localStorage at game-over so the user can replay it later.
 */

export interface RecordedAction {
  player: number;
  kind: 'fold' | 'check' | 'call' | 'raise' | 'discard';
  amount?: number;
}

export interface RecordedHand {
  handNum: number;
  button: number;
  deck: Card[];
  actions: RecordedAction[];
  result: { reason: 'fold' | 'showdown'; winners: number[] };
}

export interface Match {
  mode: 'pvp' | 'bot';
  numPlayers: number;
  names: string[];
  timestamp: number;
  hands: RecordedHand[];
}

const STORAGE_KEY = 'iamjacke-poker-last-match';

let current: RecordedHand[] = [];
let currentHand: RecordedHand | null = null;

export function recordHandStart(deck: Card[], button: number, handNum: number): void {
  currentHand = {
    handNum,
    button,
    deck: deck.slice(),
    actions: [],
    result: { reason: 'showdown', winners: [] },
  };
}

export function recordAction(
  player: number,
  kind: 'fold' | 'check' | 'call' | 'raise' | 'discard',
  amount?: number,
): void {
  if (!currentHand) return;
  currentHand.actions.push({ player, kind, ...(amount !== undefined ? { amount } : {}) });
}

export function recordHandEnd(reason: 'fold' | 'showdown', winners: number[]): void {
  if (!currentHand) return;
  currentHand.result = { reason, winners: winners.slice() };
  current.push(currentHand);
  currentHand = null;
}

export function saveMatch(meta: { mode: 'pvp' | 'bot'; numPlayers: number; names: string[] }): void {
  if (current.length === 0) return;
  const match: Match = {
    mode: meta.mode,
    numPlayers: meta.numPlayers,
    names: meta.names.slice(),
    timestamp: Date.now(),
    hands: current.slice(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(match));
  } catch {
    /* ignore */
  }
  current = [];
}

export function hasMatch(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function loadMatch(): Match | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Match;
  } catch {
    return null;
  }
}

export function clearMatch(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  current = [];
  currentHand = null;
}
