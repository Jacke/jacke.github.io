import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Pairer, type MatchedRoom, MATCH_GRACE_MS } from '../../src/matchmaker/pairer.js';

let onMatched: ReturnType<typeof vi.fn>;
let onGraceTimeout: ReturnType<typeof vi.fn>;
let pairer: Pairer;

beforeEach(() => {
  vi.useFakeTimers();
  onMatched = vi.fn();
  onGraceTimeout = vi.fn();
  pairer = new Pairer({ onMatched, onGraceTimeout });
});

function enq(pubkey: string, game: 'poker' | 'blackjack' = 'poker', seats = 2) {
  return pairer.enqueue({
    pubkey,
    gameKind: game,
    seats,
    socketId: pubkey + '-sock',
    displayName: pubkey,
  });
}

describe('Pairer', () => {
  it('pairs two players in the same bucket immediately', () => {
    enq('a');
    enq('b');
    expect(onMatched).toHaveBeenCalledTimes(1);
    const room: MatchedRoom = onMatched.mock.calls[0]![0];
    expect(room.players.map(p => p.pubkey)).toEqual(['a', 'b']);
    expect(room.gameKind).toBe('poker');
    expect(room.seatCount).toBe(2);
    expect(pairer.totalQueued()).toBe(0);
  });

  it('keeps separate buckets per (game, seats)', () => {
    enq('a', 'poker', 2);
    enq('b', 'blackjack', 2);
    expect(onMatched).not.toHaveBeenCalled();
    enq('c', 'poker', 2);
    expect(onMatched).toHaveBeenCalledTimes(1);
    expect(onMatched.mock.calls[0]![0].players.map((p: { pubkey: string }) => p.pubkey)).toEqual(['a', 'c']);
  });

  it('rejects double-enqueue from same pubkey', () => {
    expect(enq('a')).toEqual({ queued: true, bucket: 'poker:2' });
    expect(enq('a')).toEqual({ queued: false, reason: 'already-queued' });
  });

  it('cancel removes from bucket and prevents pairing', () => {
    enq('a');
    expect(pairer.cancel('a')).toBe(true);
    enq('b');
    expect(onMatched).not.toHaveBeenCalled();
  });

  it('grace timeout re-enqueues survivor at front', () => {
    enq('a');
    enq('b');
    expect(onMatched).toHaveBeenCalledTimes(1);
    const room: MatchedRoom = onMatched.mock.calls[0]![0];
    // 'a' joins, 'b' doesn't
    pairer.markJoined('a', room.roomId);
    vi.advanceTimersByTime(MATCH_GRACE_MS + 10);
    expect(onGraceTimeout).toHaveBeenCalledWith(room.roomId, ['b']);
    // 'a' should be re-enqueued at front of poker:2 bucket
    const snapshot = pairer.bucketSnapshot('poker', 2);
    expect(snapshot[0]?.pubkey).toBe('a');
  });

  it('both players join → grace timer cleared, no timeout fires', () => {
    enq('a');
    enq('b');
    const room: MatchedRoom = onMatched.mock.calls[0]![0];
    pairer.markJoined('a', room.roomId);
    pairer.markJoined('b', room.roomId);
    vi.advanceTimersByTime(MATCH_GRACE_MS * 2);
    expect(onGraceTimeout).not.toHaveBeenCalled();
  });

  it('totalQueued reflects all buckets', () => {
    enq('a', 'poker', 2);
    enq('b', 'blackjack', 2);
    enq('c', 'poker', 6);
    expect(pairer.totalQueued()).toBe(3);
  });
});
