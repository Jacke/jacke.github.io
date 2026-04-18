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
/** Multi-table bag: Record<sessionId, GameSession>. */
const ALL_KEY = 'iamjacke-poker-sessions';
/** Which tab the user was on when they last left — so reload restores focus. */
const ACTIVE_KEY = 'iamjacke-poker-active-session';

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

// ═══════════════════════════════════════════════════════════════════════
// Multi-table: Record<id, GameSession>
// ═══════════════════════════════════════════════════════════════════════

/** Read the full multi-table bag. Silently returns {} on missing / corrupt. */
export function loadAllSessions(): Record<string, GameSession> {
  try {
    const raw = localStorage.getItem(ALL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, GameSession>;
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch { /* ignore */ }
  // Migration: if there's an old single-session key but no bag, seed the
  // bag from it so existing users don't lose their in-progress match.
  const legacy = loadSession();
  if (legacy) return { [legacy.id]: legacy };
  return {};
}

export function saveAllSessions(bag: Record<string, GameSession>): void {
  try {
    localStorage.setItem(ALL_KEY, JSON.stringify(bag));
  } catch { /* ignore */ }
}

/**
 * Upsert one session into the multi-table bag AND the legacy single-session
 * key (so the existing resume path still works for one-table users).
 */
export function saveSessionById(session: GameSession): void {
  const bag = loadAllSessions();
  session.updatedAt = Date.now();
  bag[session.id] = session;
  saveAllSessions(bag);
  // Legacy mirror — the most recently saved session is the "current" one.
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(session));
  } catch { /* ignore */ }
}

/** Remove a session from the multi-table bag. */
export function removeSession(id: string): void {
  const bag = loadAllSessions();
  if (!(id in bag)) return;
  delete bag[id];
  saveAllSessions(bag);
  // If the legacy current key points at the removed session, clear it.
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GameSession;
      if (parsed?.id === id) localStorage.removeItem(CURRENT_KEY);
    }
  } catch { /* ignore */ }
  // Active tab pointer too.
  try {
    const active = localStorage.getItem(ACTIVE_KEY);
    if (active === id) localStorage.removeItem(ACTIVE_KEY);
  } catch { /* ignore */ }
}

/** List all sessions, newest first by updatedAt. */
export function listSessions(): GameSession[] {
  const bag = loadAllSessions();
  return Object.values(bag).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function setActiveSessionId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, id);
  } catch { /* ignore */ }
}

export function getActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
