/**
 * Persistent per-game-kind match log.
 *
 * Every time a hand finishes (solo or P2P), we append a compact entry
 * to the session log. Chat messages from P2P sessions are also written
 * here so they survive reloads and are always browsable from the header.
 *
 * Storage layout:
 *   localStorage key `iamjacke-log-<kind>` → { sessions: LoggedSession[] }
 *
 * Each session contains entries in chronological order. A `session` is
 * a single match (for bot mode) or a single P2P connection. When the
 * connection drops and a new one starts, that's a new session.
 *
 * Cap: keep the most recent 50 sessions per game kind. Older ones drop
 * off the front. This prevents unbounded localStorage growth and keeps
 * the viewer snappy.
 */

export type GameKind = 'poker' | 'blackjack';

export type LogEntry =
  | { kind: 'hand'; ts: number; summary: string; delta?: number }
  | { kind: 'chat'; ts: number; from: string; text: string }
  | { kind: 'system'; ts: number; text: string };

export interface LoggedSession {
  id: string;
  kind: GameKind;
  mode: 'bot' | 'pvp';
  startedAt: number;
  endedAt: number | null;
  /** Opponent / bot label for the session row header. */
  label: string;
  /** Final chip delta if known (bot mode has this, pvp sometimes). */
  finalDelta: number | null;
  entries: LogEntry[];
}

interface LogStore {
  sessions: LoggedSession[];
}

const MAX_SESSIONS = 50;
const MAX_ENTRIES_PER_SESSION = 500;

function storageKey(kind: GameKind): string {
  return `iamjacke-log-${kind}`;
}

function emptyStore(): LogStore {
  return { sessions: [] };
}

export function loadLog(kind: GameKind): LogStore {
  try {
    const raw = localStorage.getItem(storageKey(kind));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as LogStore;
    if (!parsed || !Array.isArray(parsed.sessions)) return emptyStore();
    return parsed;
  } catch {
    return emptyStore();
  }
}

function saveLog(kind: GameKind, store: LogStore): void {
  try {
    // Enforce caps before serializing to keep writes bounded.
    if (store.sessions.length > MAX_SESSIONS) {
      store.sessions = store.sessions.slice(-MAX_SESSIONS);
    }
    for (const s of store.sessions) {
      if (s.entries.length > MAX_ENTRIES_PER_SESSION) {
        s.entries = s.entries.slice(-MAX_ENTRIES_PER_SESSION);
      }
    }
    localStorage.setItem(storageKey(kind), JSON.stringify(store));
  } catch { /* ignore quota errors */ }
}

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return (crypto as { randomUUID: () => string }).randomUUID();
    }
  } catch { /* fallthrough */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Start a new logged session. Returns the session ID. */
export function startLogSession(
  kind: GameKind,
  opts: { mode: 'bot' | 'pvp'; label: string },
): string {
  const store = loadLog(kind);
  const session: LoggedSession = {
    id: genId(),
    kind,
    mode: opts.mode,
    startedAt: Date.now(),
    endedAt: null,
    label: opts.label,
    finalDelta: null,
    entries: [],
  };
  store.sessions.push(session);
  saveLog(kind, store);
  return session.id;
}

/** Append an entry to a specific session. No-op if session not found. */
export function appendLogEntry(kind: GameKind, sessionId: string, entry: LogEntry): void {
  const store = loadLog(kind);
  const session = store.sessions.find(s => s.id === sessionId);
  if (!session) return;
  session.entries.push(entry);
  saveLog(kind, store);
}

/** Close a session — freezes startedAt/endedAt, records the final delta. */
export function endLogSession(
  kind: GameKind,
  sessionId: string,
  finalDelta: number | null,
): void {
  const store = loadLog(kind);
  const session = store.sessions.find(s => s.id === sessionId);
  if (!session) return;
  session.endedAt = Date.now();
  if (finalDelta !== null) session.finalDelta = finalDelta;
  saveLog(kind, store);
}

/** Fetch the log for the UI viewer. Sessions are returned newest-first. */
export function listSessions(kind: GameKind): LoggedSession[] {
  return loadLog(kind).sessions.slice().reverse();
}

/** Wipe the entire log for a game kind. */
export function clearLog(kind: GameKind): void {
  try { localStorage.removeItem(storageKey(kind)); } catch { /* ignore */ }
}

/** Human-friendly relative time ("just now", "3m ago", "2h ago"). */
export function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
