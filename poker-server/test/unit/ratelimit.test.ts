/**
 * Token bucket unit tests — drive time manually via the injectable clock.
 *
 * We bypass the real `Date.now` by assigning `limiter.now = () => t`, so
 * each assertion knows exactly how many milliseconds have "elapsed" and
 * the refill math is deterministic. Real wall-clock tests would be flaky
 * under CI load.
 */

import { describe, it, expect } from 'vitest';
import { TokenBucketLimiter } from '../../src/ratelimit/token-bucket.js';
import { getLimiter, tryTake, resetLimiters } from '../../src/ratelimit/index.js';

function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) { t += ms; },
    set(to: number) { t = to; },
  };
}

describe('TokenBucketLimiter', () => {
  it('starts full and allows burst up to capacity', () => {
    const clock = fakeClock();
    const lim = new TokenBucketLimiter({ capacity: 5, refillPerSec: 1 });
    lim.now = clock.now;

    for (let i = 0; i < 5; i++) {
      expect(lim.take('alice')).toBe(true);
    }
    // 6th request fails — bucket is empty.
    expect(lim.take('alice')).toBe(false);
  });

  it('refills at the configured rate', () => {
    const clock = fakeClock();
    const lim = new TokenBucketLimiter({ capacity: 3, refillPerSec: 1 });
    lim.now = clock.now;

    // Drain.
    for (let i = 0; i < 3; i++) expect(lim.take('k')).toBe(true);
    expect(lim.take('k')).toBe(false);

    // 1 second passes → 1 token back.
    clock.advance(1000);
    expect(lim.take('k')).toBe(true);
    expect(lim.take('k')).toBe(false);

    // 3 seconds → refill caps at capacity (not 4).
    clock.advance(3000);
    expect(lim.peek('k')).toBeCloseTo(3, 5);
  });

  it('isolates buckets per key', () => {
    const clock = fakeClock();
    const lim = new TokenBucketLimiter({ capacity: 2, refillPerSec: 1 });
    lim.now = clock.now;

    expect(lim.take('alice')).toBe(true);
    expect(lim.take('alice')).toBe(true);
    expect(lim.take('alice')).toBe(false); // Alice drained.

    // Bob is unaffected.
    expect(lim.take('bob')).toBe(true);
    expect(lim.take('bob')).toBe(true);
    expect(lim.take('bob')).toBe(false);
  });

  it('rejected take does not debit', () => {
    const clock = fakeClock();
    const lim = new TokenBucketLimiter({ capacity: 1, refillPerSec: 1 });
    lim.now = clock.now;

    expect(lim.take('k')).toBe(true);
    // Drained. Repeat denials should not push the count below zero.
    for (let i = 0; i < 10; i++) expect(lim.take('k')).toBe(false);

    // After exactly 1 second, exactly 1 token is back — not 11.
    clock.advance(1000);
    expect(lim.take('k')).toBe(true);
    expect(lim.take('k')).toBe(false);
  });

  it('evicts idle buckets after idleEvictMs', () => {
    const clock = fakeClock();
    const lim = new TokenBucketLimiter({
      capacity: 2, refillPerSec: 1, idleEvictMs: 100,
    });
    lim.now = clock.now;

    lim.take('k');
    expect(lim.size()).toBe(1);

    // Advance past the sweep interval (60 s) AND past the idle cutoff.
    clock.advance(120_000);
    // Next take for a DIFFERENT key triggers a sweep; 'k' should be evicted.
    lim.take('other');
    expect(lim.size()).toBe(1); // only 'other' now
  });
});

describe('ratelimit registry', () => {
  it('chat limiter allows bursts then throttles', () => {
    resetLimiters();
    const chat = getLimiter('chat');
    // capacity 10, refill 2/s — 10 in a row should succeed.
    for (let i = 0; i < 10; i++) {
      expect(tryTake('chat', 'alice')).toBe(true);
    }
    // 11th denied.
    expect(tryTake('chat', 'alice')).toBe(false);
    // Bob still fresh.
    expect(tryTake('chat', 'bob')).toBe(true);
    void chat; // mark used
  });

  it('matchmake limiter is strict by design', () => {
    resetLimiters();
    // capacity 5 — should allow 5 bursts then deny.
    for (let i = 0; i < 5; i++) {
      expect(tryTake('matchmake', 'p1')).toBe(true);
    }
    expect(tryTake('matchmake', 'p1')).toBe(false);
  });

  it('email limiter has small burst', () => {
    resetLimiters();
    expect(tryTake('email', 'p1')).toBe(true);
    expect(tryTake('email', 'p1')).toBe(true);
    expect(tryTake('email', 'p1')).toBe(true);
    expect(tryTake('email', 'p1')).toBe(false);
  });
});
