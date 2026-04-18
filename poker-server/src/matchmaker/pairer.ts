/**
 * Pairing engine — drains FIFO queues into rooms.
 *
 * Per-bucket pairing happens synchronously on every enqueue: if the
 * bucket has at least `seatCount` waiters, shift them and emit a match.
 * No background tick needed.
 *
 * After a match is emitted, players have `MATCH_GRACE_MS` to send their
 * `join-room`. If they don't, the room is destroyed and any survivor is
 * re-enqueued at the FRONT of their bucket — they keep their seniority.
 */

import { randomBytes } from 'node:crypto';
import { scoped } from '../log.js';
import { FifoQueue, type QueueEntry } from './queue.js';

const log = scoped('pairer');

export const MATCH_GRACE_MS = 30_000;

export interface MatchPayload {
  socketId: string;
  displayName: string;
}

export interface MatchedRoom {
  roomId: string;
  gameKind: 'poker' | 'blackjack';
  seatCount: number;
  players: Array<{
    pubkey: string;
    socketId: string;
    displayName: string;
    seat: number;
  }>;
}

export interface PairerEvents {
  onMatched: (room: MatchedRoom) => void;
  onGraceTimeout: (roomId: string, missingPubkeys: string[]) => void;
}

interface PendingRoom {
  room: MatchedRoom;
  joined: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

function bucketKey(game: string, seats: number): string {
  return `${game}:${seats}`;
}

function genRoomId(): string {
  return 'mm-' + randomBytes(6).toString('base64url');
}

export class Pairer {
  private buckets = new Map<string, FifoQueue<MatchPayload>>();
  private pending = new Map<string, PendingRoom>();
  private events: PairerEvents;

  constructor(events: PairerEvents) {
    this.events = events;
  }

  /** Add a player to a queue and synchronously try to fill a room. */
  enqueue(opts: {
    pubkey: string;
    gameKind: 'poker' | 'blackjack';
    seats: number;
    socketId: string;
    displayName: string;
  }): { queued: true; bucket: string } | { queued: false; reason: string } {
    if (this.isInPending(opts.pubkey)) {
      return { queued: false, reason: 'already-in-room' };
    }
    const key = bucketKey(opts.gameKind, opts.seats);
    let q = this.buckets.get(key);
    if (!q) {
      q = new FifoQueue<MatchPayload>();
      this.buckets.set(key, q);
    }
    if (q.has(opts.pubkey)) {
      return { queued: false, reason: 'already-queued' };
    }
    q.enqueue({
      pubkey: opts.pubkey,
      payload: { socketId: opts.socketId, displayName: opts.displayName },
      enqueuedAt: Date.now(),
    });
    log.info({ pubkey: opts.pubkey, key, size: q.size }, 'enqueued');
    this.tryPair(opts.gameKind, opts.seats);
    return { queued: true, bucket: key };
  }

  cancel(pubkey: string): boolean {
    for (const [key, q] of this.buckets) {
      if (q.cancel(pubkey)) {
        log.info({ pubkey, key }, 'canceled');
        return true;
      }
    }
    return false;
  }

  /** Mark a player as having joined their pending room. Returns the room
   *  metadata if both players have now joined, otherwise null. */
  markJoined(pubkey: string, roomId: string): MatchedRoom | null {
    const pending = this.pending.get(roomId);
    if (!pending) return null;
    pending.joined.add(pubkey);
    if (pending.joined.size === pending.room.players.length) {
      clearTimeout(pending.timer);
      this.pending.delete(roomId);
      log.info({ roomId }, 'all players joined — match confirmed');
      return pending.room;
    }
    return null;
  }

  isPendingRoom(roomId: string): boolean {
    return this.pending.has(roomId);
  }

  totalQueued(): number {
    let total = 0;
    for (const q of this.buckets.values()) total += q.size;
    return total;
  }

  /** Inspect a bucket's contents. For tests + telemetry. */
  bucketSnapshot(game: 'poker' | 'blackjack', seats: number): QueueEntry<MatchPayload>[] {
    const q = this.buckets.get(bucketKey(game, seats));
    return q ? q.toArray() : [];
  }

  // ── private ─────────────────────────────────────────────────────────

  private tryPair(game: 'poker' | 'blackjack', seats: number): void {
    const key = bucketKey(game, seats);
    const q = this.buckets.get(key);
    if (!q || q.size < seats) return;

    const drained = q.shift(seats);
    const room: MatchedRoom = {
      roomId: genRoomId(),
      gameKind: game,
      seatCount: seats,
      players: drained.map((entry, i) => ({
        pubkey: entry.pubkey,
        socketId: entry.payload.socketId,
        displayName: entry.payload.displayName,
        seat: i,
      })),
    };
    log.info({ roomId: room.roomId, key, players: room.players.map(p => p.pubkey) }, 'matched');

    const pending: PendingRoom = {
      room,
      joined: new Set(),
      timer: setTimeout(() => this.handleGraceTimeout(room.roomId), MATCH_GRACE_MS),
    };
    this.pending.set(room.roomId, pending);
    this.events.onMatched(room);
  }

  private handleGraceTimeout(roomId: string): void {
    const pending = this.pending.get(roomId);
    if (!pending) return;
    this.pending.delete(roomId);
    const missing = pending.room.players
      .filter(p => !pending.joined.has(p.pubkey))
      .map(p => p.pubkey);
    log.warn({ roomId, missing }, 'grace timeout — re-enqueueing survivors');

    // Survivors get re-enqueued at the FRONT of their bucket so they keep
    // seniority — they showed up; the dropouts are punished.
    const survivors = pending.room.players.filter(p => pending.joined.has(p.pubkey));
    if (survivors.length > 0) {
      const key = bucketKey(pending.room.gameKind, pending.room.seatCount);
      let q = this.buckets.get(key);
      if (!q) {
        q = new FifoQueue<MatchPayload>();
        this.buckets.set(key, q);
      }
      // Reverse so the original head ends up at the head.
      for (const s of survivors.slice().reverse()) {
        q.enqueueFront({
          pubkey: s.pubkey,
          payload: { socketId: s.socketId, displayName: s.displayName },
          enqueuedAt: Date.now(),
        });
      }
    }
    this.events.onGraceTimeout(roomId, missing);
  }

  private isInPending(pubkey: string): boolean {
    for (const p of this.pending.values()) {
      if (p.room.players.some(pl => pl.pubkey === pubkey)) return true;
    }
    return false;
  }

  /** Test helper. */
  reset(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.buckets.clear();
  }
}
