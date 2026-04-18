/**
 * Server-side re-export of the client's signing primitives.
 *
 * `SigningSession` lives in `poker-src/src/protocol/crypto.ts` and is
 * already Node-compatible — it imports `@noble/ed25519` and `@noble/hashes`,
 * both isomorphic. We reach into it via the tsconfig path alias
 * `@protocol/*` → `../poker-src/src/protocol/*`. Building this module
 * proves the cross-project wiring works.
 *
 * This guarantees the server uses the EXACT same crypto code as the
 * client — no protocol drift, no duplicated canonicalization logic.
 */

export {
  SigningSession,
  isSignedEnvelope,
  generateKeyPair,
  bytesToHex,
  hexToBytes,
} from '@protocol/crypto.js';

export type {
  KeyPair,
  SignedEnvelope,
} from '@protocol/crypto.js';

export { isMessage, parseMessage, serializeMessage } from '@protocol/messages.js';
export type { Message } from '@protocol/messages.js';
