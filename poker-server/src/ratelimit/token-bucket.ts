/**
 * Token-bucket rate limiter — classic leaky-ish bucket, no background timers.
 *
 * Each actor (pubkey) gets its own bucket with `capacity` tokens that
 * refill at `refillPerSec`. Tokens are computed lazily on every `take()`
 * from the elapsed wall-clock time — no setInterval, so a million idle
 * pubkeys cost zero CPU.
 *
 * `take(n)` returns true and debits the bucket if at least `n` tokens
 * are available, false otherwise. A rejected take never debits. This
 * means a client that gets 429'd on a message doesn't lose its next
 * token by trying — they simply wait out the refill.
 *
 * Buckets are evicted after `idleEvictMs` of inactivity so long-running
 * servers don't accumulate dead state.
 */

export interface TokenBucketOpts {
  /** Max tokens the bucket holds. Bursts up to this many are free. */
  capacity: number;
  /** Steady-state tokens-per-second the bucket refills at. */
  refillPerSec: number;
  /** Buckets untouched for longer than this are dropped. Default 10 min. */
  idleEvictMs?: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  lastTouchedMs: number;
}

export class TokenBucketLimiter {
  readonly capacity: number;
  readonly refillPerSec: number;
  readonly idleEvictMs: number;
  private buckets = new Map<string, Bucket>();
  private lastSweepMs = 0;
  /** Injectable for tests; defaults to Date.now. */
  now: () => number = Date.now;

  constructor(opts: TokenBucketOpts) {
    if (opts.capacity <= 0) throw new Error('capacity must be > 0');
    if (opts.refillPerSec <= 0) throw new Error('refillPerSec must be > 0');
    this.capacity = opts.capacity;
    this.refillPerSec = opts.refillPerSec;
    this.idleEvictMs = opts.idleEvictMs ?? 600_000;
  }

  /**
   * Try to debit `n` tokens from `key`'s bucket. Returns true on success
   * (bucket debited, action allowed) or false on denial (bucket unchanged).
   */
  take(key: string, n = 1): boolean {
    this.sweepIfDue();
    const now = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, lastRefillMs: now, lastTouchedMs: now };
      this.buckets.set(key, b);
    }
    // Lazy refill based on elapsed time since last access.
    const elapsed = Math.max(0, now - b.lastRefillMs);
    if (elapsed > 0) {
      b.tokens = Math.min(this.capacity, b.tokens + (elapsed / 1000) * this.refillPerSec);
      b.lastRefillMs = now;
    }
    b.lastTouchedMs = now;
    if (b.tokens >= n) {
      b.tokens -= n;
      return true;
    }
    return false;
  }

  /** Current token count for a key — useful in tests, noisy in prod. */
  peek(key: string): number {
    const b = this.buckets.get(key);
    if (!b) return this.capacity;
    const now = this.now();
    const elapsed = Math.max(0, now - b.lastRefillMs);
    return Math.min(this.capacity, b.tokens + (elapsed / 1000) * this.refillPerSec);
  }

  /** Number of buckets currently tracked. For health/debug. */
  size(): number {
    return this.buckets.size;
  }

  /** Wipe every bucket — test helper and admin hot-reset. */
  reset(): void {
    this.buckets.clear();
  }

  /** Drop buckets that haven't been touched in `idleEvictMs`. Called at
   *  most once per minute from `take()`. */
  private sweepIfDue(): void {
    const now = this.now();
    if (now - this.lastSweepMs < 60_000) return;
    this.lastSweepMs = now;
    for (const [key, b] of this.buckets) {
      if (now - b.lastTouchedMs > this.idleEvictMs) {
        this.buckets.delete(key);
      }
    }
  }
}
