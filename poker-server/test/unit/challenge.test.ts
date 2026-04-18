import { describe, it, expect, beforeEach } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { issueChallenge, verifyAuth, resetChallenges } from '../../src/auth/challenge.js';
import { bytesToHex } from '../../src/protocol/envelope.js';

ed.hashes.sha512 = sha512;

beforeEach(() => {
  resetChallenges();
});

describe('challenge.ts — Ed25519 challenge-response', () => {
  it('verifies a correctly signed nonce', async () => {
    const challenge = issueChallenge();
    const sk = ed.utils.randomSecretKey();
    const pk = ed.getPublicKey(sk);
    const sig = ed.sign(new TextEncoder().encode(challenge.nonce), sk);

    const ok = await verifyAuth(challenge.nonce, bytesToHex(pk), bytesToHex(sig));
    expect(ok).toBe(true);
  });

  it('rejects a tampered signature', async () => {
    const challenge = issueChallenge();
    const sk = ed.utils.randomSecretKey();
    const pk = ed.getPublicKey(sk);
    const sig = ed.sign(new TextEncoder().encode(challenge.nonce), sk);
    // Flip a byte
    const tampered = Buffer.from(sig);
    tampered[0] = (tampered[0]! + 1) & 0xff;
    const ok = await verifyAuth(challenge.nonce, bytesToHex(pk), bytesToHex(tampered));
    expect(ok).toBe(false);
  });

  it('rejects an unknown nonce', async () => {
    const sk = ed.utils.randomSecretKey();
    const pk = ed.getPublicKey(sk);
    const fakeNonce = 'deadbeefdeadbeefdeadbeefdeadbeef';
    const sig = ed.sign(new TextEncoder().encode(fakeNonce), sk);
    const ok = await verifyAuth(fakeNonce, bytesToHex(pk), bytesToHex(sig));
    expect(ok).toBe(false);
  });

  it('one-shot: a nonce cannot be reused', async () => {
    const challenge = issueChallenge();
    const sk = ed.utils.randomSecretKey();
    const pk = ed.getPublicKey(sk);
    const sig = ed.sign(new TextEncoder().encode(challenge.nonce), sk);

    const first = await verifyAuth(challenge.nonce, bytesToHex(pk), bytesToHex(sig));
    expect(first).toBe(true);
    const second = await verifyAuth(challenge.nonce, bytesToHex(pk), bytesToHex(sig));
    expect(second).toBe(false);
  });
});
