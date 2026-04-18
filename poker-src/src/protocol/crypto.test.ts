import { describe, it, expect } from 'vitest';
import { SigningSession, bytesToHex, hexToBytes, isSignedEnvelope } from './crypto.js';
import type { Message } from './messages.js';

const hello: Message = { type: 'hello', name: 'Alice' };
const action: Message = { type: 'action', player: 0, action: 'raise', amount: 60 };

describe('hex helpers', () => {
  it('round-trips bytes → hex → bytes', () => {
    const b = new Uint8Array([0, 1, 15, 16, 255]);
    expect(hexToBytes(bytesToHex(b))).toEqual(b);
  });
  it('rejects odd-length hex', () => {
    expect(() => hexToBytes('abc')).toThrow();
  });
});

describe('SigningSession round-trip', () => {
  it('host-to-guest: guest verifies host signature', () => {
    const host = new SigningSession();
    const guest = new SigningSession();
    const env = host.wrap(hello);
    const msg = guest.verifyAndUnwrap(env);
    expect(msg).toEqual(hello);
  });

  it('outbound seq increments monotonically', () => {
    const s = new SigningSession();
    const e1 = s.wrap(hello);
    const e2 = s.wrap(action);
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
  });

  it('verify rejects tampered payload', () => {
    const host = new SigningSession();
    const guest = new SigningSession();
    const env = host.wrap(action);
    // Tamper
    const tampered = { ...env, payload: { ...env.payload, amount: 9999 } };
    expect(() => guest.verifyAndUnwrap(tampered)).toThrow('bad signature');
  });

  it('verify rejects forged pubkey (signature over wrong identity)', () => {
    const host = new SigningSession();
    const attacker = new SigningSession();
    const guest = new SigningSession();
    // Attacker signs their own message but claims host's pubkey
    const attackerEnv = attacker.wrap(action);
    const forged = { ...attackerEnv, pub: host.publicKeyHex };
    expect(() => guest.verifyAndUnwrap(forged)).toThrow('bad signature');
  });

  it('verify rejects replay (same seq twice)', () => {
    const host = new SigningSession();
    const guest = new SigningSession();
    const env = host.wrap(hello);
    guest.verifyAndUnwrap(env);
    expect(() => guest.verifyAndUnwrap(env)).toThrow('out-of-order');
  });

  it('verify rejects out-of-order seq', () => {
    const host = new SigningSession();
    const guest = new SigningSession();
    const e1 = host.wrap(hello);
    const e2 = host.wrap(action);
    guest.verifyAndUnwrap(e2);
    // Can't now rewind to e1
    expect(() => guest.verifyAndUnwrap(e1)).toThrow('out-of-order');
  });

  it('verify rejects a pubkey change mid-session', () => {
    const host = new SigningSession();
    const impersonator = new SigningSession();
    const guest = new SigningSession();
    guest.verifyAndUnwrap(host.wrap(hello));
    // Now impersonator tries to send with their own (verifiable) key
    expect(() => guest.verifyAndUnwrap(impersonator.wrap(action)))
      .toThrow('pubkey changed');
  });

  it('isSignedEnvelope validates shape', () => {
    const host = new SigningSession();
    const env = host.wrap(hello);
    expect(isSignedEnvelope(env)).toBe(true);
    expect(isSignedEnvelope({ foo: 'bar' })).toBe(false);
    expect(isSignedEnvelope(null)).toBe(false);
    expect(isSignedEnvelope({ payload: hello, seq: 'x', pub: 'a', sig: 'b' })).toBe(false);
  });

  it('rejects non-envelope input on verify', () => {
    const guest = new SigningSession();
    expect(() => guest.verifyAndUnwrap({ type: 'hello', name: 'Mallory' }))
      .toThrow('not a signed envelope');
  });

  it('keeps seq numbers independent per session', () => {
    const a = new SigningSession();
    const b = new SigningSession();
    a.wrap(hello);
    a.wrap(action);
    b.wrap(hello);
    expect(a.state.sendSeq).toBe(2);
    expect(b.state.sendSeq).toBe(1);
  });
});
