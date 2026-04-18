/**
 * Central limiter registry — one TokenBucketLimiter per category.
 *
 * Categories (tuned for a small P2P-style game server, not a public API):
 *   - chat       : 10 tokens, refill 2/s   (burst 10, steady 2 msgs/sec)
 *   - matchmake  : 5 tokens,  refill 0.1/s (1 request every 10 s sustained)
 *   - email      : 3 tokens,  refill 1/120s (3 mails in 6 min window)
 *
 * The idea: be tight on abusive patterns (matchmake loop, email spam)
 * while letting a normal player chat as fast as they can type.
 *
 * Every limiter is keyed by pubkey so socket churn can't bypass it —
 * opening a new WS gives you a fresh *session* but the same bucket.
 */

import { TokenBucketLimiter } from './token-bucket.js';

export type LimiterKind = 'chat' | 'matchmake' | 'email';

const limiters: Record<LimiterKind, TokenBucketLimiter> = {
  chat: new TokenBucketLimiter({ capacity: 10, refillPerSec: 2 }),
  matchmake: new TokenBucketLimiter({ capacity: 5, refillPerSec: 0.1 }),
  email: new TokenBucketLimiter({ capacity: 3, refillPerSec: 1 / 120 }),
};

export function getLimiter(kind: LimiterKind): TokenBucketLimiter {
  return limiters[kind];
}

export function tryTake(kind: LimiterKind, key: string, n = 1): boolean {
  return limiters[kind].take(key, n);
}

/** Test helper — wipes every limiter. */
export function resetLimiters(): void {
  for (const k of Object.keys(limiters) as LimiterKind[]) {
    limiters[k].reset();
  }
}

export { TokenBucketLimiter } from './token-bucket.js';
