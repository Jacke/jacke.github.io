/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession,
  saveSession,
  loadSession,
  clearSession,
  saveSessionById,
  loadAllSessions,
  removeSession,
  listSessions,
  setActiveSessionId,
  getActiveSessionId,
} from './session.js';
import { createGameState } from '../core/engine.js';

function fakeSession(name = 'Alice') {
  const state = createGameState(2, 0, [name, 'Bob']);
  // Force non-idle so loadSession() doesn't filter it out
  state.phase = 'preflop';
  state.handNum = 1;
  return createSession({
    mode: 'bot',
    difficulty: 'medium',
    numPlayers: 2,
    matchStartChips: 1000,
    state,
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe('multi-session storage', () => {
  it('saveSessionById + loadAllSessions round-trip', () => {
    const a = fakeSession('Alice');
    const b = fakeSession('Bob');
    saveSessionById(a);
    saveSessionById(b);
    const bag = loadAllSessions();
    expect(Object.keys(bag).sort()).toEqual([a.id, b.id].sort());
  });

  it('removeSession drops one entry without affecting others', () => {
    const a = fakeSession('A');
    const b = fakeSession('B');
    saveSessionById(a);
    saveSessionById(b);
    removeSession(a.id);
    const bag = loadAllSessions();
    expect(Object.keys(bag)).toEqual([b.id]);
  });

  it('listSessions returns newest first', async () => {
    const a = fakeSession('A');
    saveSessionById(a);
    // Wait 2ms so Date.now() definitely advances.
    await new Promise(r => setTimeout(r, 2));
    const b = fakeSession('B');
    saveSessionById(b);
    const list = listSessions();
    expect(list[0]!.id).toBe(b.id);
    expect(list[1]!.id).toBe(a.id);
  });

  it('saveSessionById also updates legacy single-session key', () => {
    const a = fakeSession('A');
    saveSessionById(a);
    const legacy = loadSession();
    expect(legacy?.id).toBe(a.id);
  });

  it('removeSession clears legacy key if it points at the removed session', () => {
    const a = fakeSession('A');
    saveSessionById(a);
    removeSession(a.id);
    expect(loadSession()).toBeNull();
  });

  it('migrates from legacy single-session key when bag is empty', () => {
    // Seed only the legacy key — no multi-bag entry.
    const a = fakeSession('Legacy');
    saveSession(a);
    // Fresh read: should seed from the legacy key.
    const bag = loadAllSessions();
    expect(bag[a.id]?.id).toBe(a.id);
  });

  it('active-session pointer round-trips', () => {
    expect(getActiveSessionId()).toBeNull();
    setActiveSessionId('abc');
    expect(getActiveSessionId()).toBe('abc');
    setActiveSessionId(null);
    expect(getActiveSessionId()).toBeNull();
  });

  it('removeSession clears active-session pointer when it matches', () => {
    const a = fakeSession('A');
    saveSessionById(a);
    setActiveSessionId(a.id);
    removeSession(a.id);
    expect(getActiveSessionId()).toBeNull();
  });

  it('clearSession only wipes the legacy key, not the multi-bag', () => {
    const a = fakeSession('A');
    saveSessionById(a);
    clearSession();
    expect(loadSession()).toBeNull();
    const bag = loadAllSessions();
    expect(bag[a.id]?.id).toBe(a.id);
  });
});
