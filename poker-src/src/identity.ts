/**
 * Persistent Ed25519 identity — one keypair per browser.
 *
 * The player's pubkey is their stable identifier on the server
 * (`users.pubkey`). Losing it loses their lifetime stats, so we keep
 * the secret key in `localStorage` and reuse it across sessions.
 *
 * Threat model: a cross-site script that gets `localStorage` access can
 * impersonate the user. We accept this because (a) the site doesn't
 * load third-party scripts, (b) the key unlocks only an ephemeral
 * game identity — no money, no PII — and (c) storing in IndexedDB
 * wouldn't change the attack. A determined user can clear storage and
 * start fresh; that's a feature, not a bug.
 */

import { generateKeyPair, bytesToHex, hexToBytes, type KeyPair } from './protocol/crypto.js';

const SECRET_KEY_LS = 'iamjacke-identity-sk';
const PUBKEY_LS = 'iamjacke-identity-pk';

let cached: KeyPair | null = null;

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); }
  catch { /* private tab, storage disabled — caller uses ephemeral key */ }
}

/**
 * Return this browser's persistent keypair, creating + saving a new one
 * on first call. Subsequent calls return the cached instance.
 */
export function loadIdentity(): KeyPair {
  if (cached) return cached;
  const sk = lsGet(SECRET_KEY_LS);
  const pk = lsGet(PUBKEY_LS);
  if (sk && pk) {
    try {
      cached = { secretKey: hexToBytes(sk), publicKey: hexToBytes(pk) };
      return cached;
    } catch {
      // Corrupted storage — fall through and regenerate.
    }
  }
  const fresh = generateKeyPair();
  lsSet(SECRET_KEY_LS, bytesToHex(fresh.secretKey));
  lsSet(PUBKEY_LS, bytesToHex(fresh.publicKey));
  cached = fresh;
  return fresh;
}

/** Hex-encoded public key — the identity the server sees. */
export function getPubkeyHex(): string {
  return bytesToHex(loadIdentity().publicKey);
}

/** Wipe + regenerate — useful from devtools when testing multi-account flows. */
export function resetIdentity(): KeyPair {
  try {
    localStorage.removeItem(SECRET_KEY_LS);
    localStorage.removeItem(PUBKEY_LS);
  } catch { /* ignore */ }
  cached = null;
  return loadIdentity();
}
