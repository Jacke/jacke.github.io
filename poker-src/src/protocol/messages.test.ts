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
  it('rejects a deal with non-numeric button', () => {
    expect(isMessage({ type: 'deal', deck: makeDeck(), button: 'zero', handNum: 1 })).toBe(false);
  });
  it('accepts multi-player button values', () => {
    expect(isMessage({ type: 'deal', deck: makeDeck(), button: 3, handNum: 1 })).toBe(true);
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

describe('chat message', () => {
  it('accepts valid chat', () => {
    expect(isMessage({ type: 'chat', from: 'Stan', text: 'hello', ts: Date.now() })).toBe(true);
  });
  it('rejects empty chat text', () => {
    expect(isMessage({ type: 'chat', from: 'Stan', text: '', ts: Date.now() })).toBe(false);
  });
  it('rejects chat text over 500 chars', () => {
    expect(isMessage({ type: 'chat', from: 'Stan', text: 'x'.repeat(501), ts: Date.now() })).toBe(false);
  });
  it('rejects chat without ts', () => {
    expect(isMessage({ type: 'chat', from: 'Stan', text: 'hi' })).toBe(false);
  });
});

describe('blackjack P2P messages', () => {
  it('accepts bj-start with seed + chips', () => {
    expect(isMessage({ type: 'bj-start', seed: 12345, startingChips: 1000 })).toBe(true);
  });
  it('rejects bj-start with zero chips', () => {
    expect(isMessage({ type: 'bj-start', seed: 1, startingChips: 0 })).toBe(false);
  });
  it('accepts bj-bet', () => {
    expect(isMessage({ type: 'bj-bet', player: 0, amount: 100 })).toBe(true);
  });
  it('accepts bj-deal with bets array', () => {
    expect(isMessage({ type: 'bj-deal', round: 1, bets: [100, 50] })).toBe(true);
  });
  it('rejects bj-deal with non-array bets', () => {
    expect(isMessage({ type: 'bj-deal', round: 1, bets: 'nope' })).toBe(false);
  });
  it('accepts all bj-action kinds', () => {
    for (const a of ['hit', 'stand', 'double', 'split', 'surrender']) {
      expect(isMessage({ type: 'bj-action', player: 0, action: a })).toBe(true);
    }
  });
  it('rejects bj-action with bogus kind', () => {
    expect(isMessage({ type: 'bj-action', player: 0, action: 'yolo' })).toBe(false);
  });
  it('accepts bj-insurance', () => {
    expect(isMessage({ type: 'bj-insurance', player: 1, accept: true })).toBe(true);
    expect(isMessage({ type: 'bj-insurance', player: 1, accept: false })).toBe(true);
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
