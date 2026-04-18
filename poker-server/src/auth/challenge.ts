/**
 * Ed25519 challenge-response authentication.
 *
 * Flow:
 *   1. Server issues `welcome { nonce, serverTime }` on WS connect.
 *   2. Client generates (or loads) an Ed25519 keypair.
 *   3. Client signs the nonce with their secret key.
 *   4. Client sends `auth { pubkey, nonce, sig, name? }`.
 *   5. Server verifies the signature against the nonce.
 *   6. If valid, server marks the session authed, upserts the user row,
 *      and replies with `authed { pubkey, displayName }`.
 *
 * Nonces expire after `AUTH_NONCE_TTL_MS` to prevent replay across
 * reconnects. One-shot: each nonce is consumed on first use.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { hexToBytes, bytesToHex } from '../protocol/envelope.js';

// noble-ed25519 requires a sync sha512 implementation to enable sync verify.
ed.hashes.sha512 = sha512;

interface Challenge {
  nonce: string;
  issuedAt: number;
}

// Map of nonce → issued timestamp. Keyed on nonce so no per-socket lookup.
const challenges = new Map<string, Challenge>();

export function issueChallenge(): Challenge {
  const nonce = bytesToHex(randomBytes(16));
  const challenge: Challenge = { nonce, issuedAt: Date.now() };
  challenges.set(nonce, challenge);
  // Opportunistic cleanup — cheap since TTL is short.
  gc();
  return challenge;
}

/**
 * Verify an `auth` message. Returns true on success + invalidates the nonce.
 */
export async function verifyAuth(
  nonce: string,
  pubkeyHex: string,
  sigHex: string,
): Promise<boolean> {
  const challenge = challenges.get(nonce);
  if (!challenge) return false;
  challenges.delete(nonce); // one-shot, regardless of outcome
  if (Date.now() - challenge.issuedAt > config.authNonceTtlMs) return false;

  try {
    const sig = hexToBytes(sigHex);
    const pub = hexToBytes(pubkeyHex);
    const msg = new TextEncoder().encode(nonce);
    return ed.verify(sig, msg, pub);
  } catch {
    return false;
  }
}

function gc(): void {
  const cutoff = Date.now() - config.authNonceTtlMs;
  for (const [nonce, c] of challenges) {
    if (c.issuedAt < cutoff) challenges.delete(nonce);
  }
}

/** Test helper — wipe the map between tests. */
export function resetChallenges(): void {
  challenges.clear();
}
