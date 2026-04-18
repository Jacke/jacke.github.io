import { describe, it, expect } from 'vitest';
import {
  SigningSession, isSignedEnvelope, isMessage,
} from '../../src/protocol/envelope.js';
import type { Message } from '../../src/protocol/envelope.js';

const hello: Message = { type: 'hello', name: 'Stan' };

describe('shared envelope (cross-project contract)', () => {
  it('two independent sessions can exchange signed messages', () => {
    const alice = new SigningSession();
    const bob = new SigningSession();

    const env = alice.wrap(hello);
    expect(isSignedEnvelope(env)).toBe(true);

    const received = bob.verifyAndUnwrap(env);
    expect(received).toEqual(hello);
  });

  it('rejects a forged signature (wrong pubkey)', () => {
    const alice = new SigningSession();
    const mallory = new SigningSession();
    const bob = new SigningSession();
    const env = mallory.wrap(hello);
    const forged = { ...env, pub: alice.publicKeyHex };
    expect(() => bob.verifyAndUnwrap(forged)).toThrow('bad signature');
  });

  it('rejects out-of-order seq (replay guard)', () => {
    const alice = new SigningSession();
    const bob = new SigningSession();
    const e1 = alice.wrap(hello);
    const e2 = alice.wrap({ type: 'ready' });
    bob.verifyAndUnwrap(e2);
    expect(() => bob.verifyAndUnwrap(e1)).toThrow('out-of-order');
  });

  it('isMessage validator (from shared module) accepts game messages', () => {
    expect(isMessage({ type: 'hello', name: 'A' })).toBe(true);
    expect(isMessage({ type: 'chat', from: 'A', text: 'hi', ts: Date.now() })).toBe(true);
    expect(isMessage({ type: 'bj-start', seed: 1, startingChips: 1000 })).toBe(true);
  });
});
