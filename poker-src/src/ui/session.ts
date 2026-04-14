/**
 * Game session persistence — every match gets a unique ID and a full state
 * snapshot saved to localStorage after every hand. On page load, the app can
 * offer to resume the last unfinished session.
 *
 * No backend required: this is single-device resume. Cross-device would need
 * a server.
 */

import type { GameState } from '../core/types.js';
import type { Difficulty } from '../bot/bot.js';

const CURRENT_KEY = 'iamjacke-poker-session-current';

export interface GameSession {
  id: string;
  mode: 'pvp' | 'bot';
  difficulty: Difficulty;
  numPlayers: number;
  matchStartChips: number;
  matchHandCount: number;
  state: GameState;
  createdAt: number;
  updatedAt: number;
}

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return (crypto as { randomUUID: () => string }).randomUUID();
    }
  } catch { /* fallthrough */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Create a new session record (not yet saved). */
export function createSession(params: {
  mode: 'pvp' | 'bot';
  difficulty: Difficulty;
  numPlayers: number;
  matchStartChips: number;
  state: GameState;
}): GameSession {
  const now = Date.now();
  return {
    id: genId(),
    mode: params.mode,
    difficulty: params.difficulty,
    numPlayers: params.numPlayers,
    matchStartChips: params.matchStartChips,
    matchHandCount: 0,
    state: params.state,
    createdAt: now,
    updatedAt: now,
  };
}

export function saveSession(session: GameSession): void {
  try {
    session.updatedAt = Date.now();
    localStorage.setItem(CURRENT_KEY, JSON.stringify(session));
  } catch { /* ignore */ }
}

export function loadSession(): GameSession | null {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameSession;
    // Don't resume completed games.
    if (parsed.state.gameOver) return null;
    if (parsed.state.phase === 'idle') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try { localStorage.removeItem(CURRENT_KEY); } catch { /* ignore */ }
}

/** Human-readable summary for the resume button. */
export function sessionSummary(session: GameSession): string {
  const bots = session.numPlayers - 1;
  const ago = Math.floor((Date.now() - session.updatedAt) / 60000);
  const agoText = ago < 1 ? 'just now' : ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`;
  const label = session.mode === 'bot'
    ? `${session.difficulty} · ${bots} ${bots === 1 ? 'bot' : 'bots'}`
    : 'PvP';
  return `${label} · hand #${session.state.handNum} · ${agoText}`;
}
