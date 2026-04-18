/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  startLogSession, appendLogEntry, endLogSession,
  listSessions, loadLog, clearLog,
} from './match-log.js';

beforeEach(() => {
  localStorage.clear();
});

describe('match log', () => {
  it('starts an empty log per game kind', () => {
    expect(loadLog('poker').sessions).toEqual([]);
    expect(loadLog('blackjack').sessions).toEqual([]);
  });

  it('creates a new session with startLogSession', () => {
    const id = startLogSession('blackjack', { mode: 'bot', label: 'solo' });
    const sessions = loadLog('blackjack').sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(id);
    expect(sessions[0]!.mode).toBe('bot');
    expect(sessions[0]!.label).toBe('solo');
    expect(sessions[0]!.endedAt).toBeNull();
  });

  it('appends hand entries', () => {
    const id = startLogSession('blackjack', { mode: 'bot', label: 'solo' });
    appendLogEntry('blackjack', id, { kind: 'hand', ts: 1000, summary: 'Won $50', delta: 50 });
    const sessions = loadLog('blackjack').sessions;
    expect(sessions[0]!.entries).toHaveLength(1);
    expect(sessions[0]!.entries[0]).toMatchObject({ kind: 'hand', summary: 'Won $50', delta: 50 });
  });

  it('appends chat entries', () => {
    const id = startLogSession('poker', { mode: 'pvp', label: 'vs Bob' });
    appendLogEntry('poker', id, { kind: 'chat', ts: 1000, from: 'Alice', text: 'gg' });
    const sessions = loadLog('poker').sessions;
    expect(sessions[0]!.entries[0]).toMatchObject({ kind: 'chat', from: 'Alice', text: 'gg' });
  });

  it('endLogSession freezes endedAt and finalDelta', () => {
    const id = startLogSession('blackjack', { mode: 'bot', label: 'solo' });
    endLogSession('blackjack', id, -200);
    const session = loadLog('blackjack').sessions[0]!;
    expect(session.endedAt).not.toBeNull();
    expect(session.finalDelta).toBe(-200);
  });

  it('listSessions returns newest first', () => {
    startLogSession('poker', { mode: 'bot', label: 'first' });
    const second = startLogSession('poker', { mode: 'bot', label: 'second' });
    const list = listSessions('poker');
    expect(list[0]!.id).toBe(second);
  });

  it('poker and blackjack logs are independent', () => {
    startLogSession('poker', { mode: 'bot', label: 'P1' });
    startLogSession('blackjack', { mode: 'bot', label: 'B1' });
    expect(loadLog('poker').sessions).toHaveLength(1);
    expect(loadLog('blackjack').sessions).toHaveLength(1);
    clearLog('poker');
    expect(loadLog('poker').sessions).toHaveLength(0);
    expect(loadLog('blackjack').sessions).toHaveLength(1);
  });

  it('appendLogEntry on missing session is a no-op', () => {
    appendLogEntry('blackjack', 'bogus-id', { kind: 'system', ts: 1, text: 'nope' });
    expect(loadLog('blackjack').sessions).toEqual([]);
  });
});
