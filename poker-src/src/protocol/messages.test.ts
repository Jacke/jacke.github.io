import { describe, it, expect } from 'vitest';
import { isMessage, parseMessage, serializeMessage } from './messages.js';
import { makeDeck } from '../core/cards.js';

describe('isMessage', () => {
  it('accepts valid hello', () => {
    expect(isMessage({ type: 'hello', name: 'Stan' })).toBe(true);
  });
  it('rejects hello without name', () => {
    expect(isMessage({ type: 'hello' })).toBe(false);
  });
  it('accepts ready and next_hand', () => {
    expect(isMessage({ type: 'ready' })).toBe(true);
    expect(isMessage({ type: 'next_hand' })).toBe(true);
  });
  it('accepts a valid deal message', () => {
    expect(isMessage({ type: 'deal', deck: makeDeck(), button: 0, handNum: 1 })).toBe(true);
  });
  it('rejects a deal with wrong deck length', () => {
    expect(isMessage({ type: 'deal', deck: ['As'], button: 0, handNum: 1 })).toBe(false);
  });
  it('rejects a deal with bad button', () => {
    expect(isMessage({ type: 'deal', deck: makeDeck(), button: 2, handNum: 1 })).toBe(false);
  });
  it('accepts all action kinds', () => {
    for (const a of ['fold', 'check', 'call', 'raise']) {
      expect(isMessage({ type: 'action', player: 0, action: a })).toBe(true);
    }
  });
  it('accepts action with amount', () => {
    expect(isMessage({ type: 'action', player: 1, action: 'raise', amount: 60 })).toBe(true);
  });
  it('rejects action with bogus kind', () => {
    expect(isMessage({ type: 'action', player: 0, action: 'teleport' })).toBe(false);
  });
  it('rejects unknown type', () => {
    expect(isMessage({ type: 'mystery' })).toBe(false);
  });
  it('rejects non-object', () => {
    expect(isMessage(null)).toBe(false);
    expect(isMessage('hello')).toBe(false);
    expect(isMessage(42)).toBe(false);
  });
});

describe('parseMessage + serializeMessage', () => {
  it('round-trips through JSON', () => {
    const msg = { type: 'deal' as const, deck: makeDeck(), button: 0 as const, handNum: 3 };
    const raw = serializeMessage(msg);
    const parsed = parseMessage(raw);
    expect(parsed).toEqual(msg);
  });
  it('throws on invalid JSON', () => {
    expect(() => parseMessage('not json')).toThrow();
  });
  it('throws on valid JSON but wrong shape', () => {
    expect(() => parseMessage('{"type":"lolnope"}')).toThrow();
  });
});
