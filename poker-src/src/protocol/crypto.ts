/**
 * Ed25519 signing layer for the wire protocol.
 *
 * Every outbound message is wrapped in a `SignedEnvelope` carrying:
 *   - `seq`  — monotonic per-sender counter (replay / reorder protection)
 *   - `sig`  — Ed25519 signature over `canonicalize({payload, seq, pub})`
 *   - `pub`  — sender's public key, hex-encoded (so receiver can verify
 *              without a PKI — keypairs are ephemeral per session)
 *
 * Threat model:
 *   ✅ Drive-by forgery on the public PeerJS broker — another peer on the
 *      same room ID can't forge actions from either side.
 *   ✅ Replay / reorder — seq must be strictly greater than last received.
 *   ❌ Collusion between two human players — inherently unsolvable without
 *      a trusted dealer (out of scope).
 *
 * The keypair is ephemeral (generated in memory on construction, never
 * persisted). A session restart = a new identity. This is intentional:
 * there is no signup/login for this game.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import type { Message } from './messages.js';
import { isMessage } from './messages.js';

// Configure synchronous SHA-512 once so ed.sign / ed.verify are synchronous.
// Without this the library only exposes async variants.
ed.hashes.sha512 = sha512;

// ═══════════════════════════════════════════════════════════════════════
// Hex helpers — kept tiny so the bundle impact stays near zero.
// ═══════════════════════════════════════════════════════════════════════

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    s += (b[i]! < 16 ? '0' : '') + b[i]!.toString(16);
  }
  return s;
}

export function hexToBytes(h: string): Uint8Array {
  if (h.length % 2 !== 0) throw new Error('hexToBytes: odd length');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(h.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) throw new Error('hexToBytes: invalid char');
    out[i] = byte;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// Canonicalize — deterministic JSON for signing.
// JSON.stringify with key sort gives a byte-identical representation
// across sender/receiver regardless of insertion order.
// ═══════════════════════════════════════════════════════════════════════

function canonicalize(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  const keys = Object.keys(v as object).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const val = (v as Record<string, unknown>)[k];
    if (val === undefined) continue;
    parts.push(JSON.stringify(k) + ':' + canonicalize(val));
  }
  return '{' + parts.join(',') + '}';
}

// ═══════════════════════════════════════════════════════════════════════
// Envelope
// ═══════════════════════════════════════════════════════════════════════

export interface SignedEnvelope {
  payload: Message;
  seq: number;
  pub: string;  // sender pubkey, hex
  sig: string;  // signature over canonicalized {payload, seq, pub}
}

export function isSignedEnvelope(v: unknown): v is SignedEnvelope {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o['seq'] === 'number'
    && typeof o['pub'] === 'string'
    && typeof o['sig'] === 'string'
    && isMessage(o['payload']);
}

// ═══════════════════════════════════════════════════════════════════════
// Keypair + session
// ═══════════════════════════════════════════════════════════════════════

export interface KeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export function generateKeyPair(): KeyPair {
  const keys = ed.keygen();
  return { secretKey: keys.secretKey, publicKey: keys.publicKey };
}

/**
 * SigningSession tracks outbound seq + verified remote pubkey + last
 * received seq. One instance per transport.
 */
export class SigningSession {
  readonly local: KeyPair;
  private sendSeq = 0;
  /** Verified pubkey from peer. Set on first valid inbound envelope. */
  private remotePub: string | null = null;
  /** Highest accepted inbound seq. Replay / reorder guard. */
  private lastRecvSeq = -1;

  constructor(keypair?: KeyPair) {
    this.local = keypair ?? generateKeyPair();
  }

  get publicKeyHex(): string {
    return bytesToHex(this.local.publicKey);
  }

  /** Wrap an outbound message, incrementing our seq. */
  wrap(msg: Message): SignedEnvelope {
    const seq = ++this.sendSeq;
    const pub = this.publicKeyHex;
    const signable = canonicalize({ payload: msg, seq, pub });
    const sig = ed.sign(new TextEncoder().encode(signable), this.local.secretKey);
    return { payload: msg, seq, pub, sig: bytesToHex(sig) };
  }

  /**
   * Verify an inbound envelope. Returns the payload message, or throws.
   * - Signature must validate against envelope.pub
   * - On first message, remembers the pubkey; subsequent messages must
   *   use the same pubkey (TOFU — trust-on-first-use).
   * - seq must be strictly greater than lastRecvSeq
   */
  verifyAndUnwrap(env: unknown): Message {
    if (!isSignedEnvelope(env)) throw new Error('not a signed envelope');
    if (this.remotePub !== null && env.pub !== this.remotePub) {
      throw new Error('pubkey changed mid-session');
    }
    if (env.seq <= this.lastRecvSeq) {
      throw new Error(`out-of-order seq ${env.seq} (last ${this.lastRecvSeq})`);
    }
    const signable = canonicalize({ payload: env.payload, seq: env.seq, pub: env.pub });
    const ok = ed.verify(
      hexToBytes(env.sig),
      new TextEncoder().encode(signable),
      hexToBytes(env.pub),
    );
    if (!ok) throw new Error('bad signature');
    if (this.remotePub === null) this.remotePub = env.pub;
    this.lastRecvSeq = env.seq;
    return env.payload;
  }

  /** Current counters — for tests. */
  get state(): { sendSeq: number; lastRecvSeq: number; remotePub: string | null } {
    return { sendSeq: this.sendSeq, lastRecvSeq: this.lastRecvSeq, remotePub: this.remotePub };
  }
}
