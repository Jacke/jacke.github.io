/**
 * Room — relays signed envelopes between members + closes when empty.
 *
 * The server is a DUMB relay: it never decodes, mutates, or re-signs
 * game messages. End-to-end signature integrity is preserved because
 * every fan-out is the original envelope bytes. The server's only
 * authority over game traffic is:
 *   1. Persistence — every relayed message is written to SQLite first.
 *   2. Routing — only members of THIS room receive THIS room's messages.
 *
 * Each room tracks members in a Map<pubkey, RoomMember>. When the last
 * active member leaves, the room enters an `orphaned` state for
 * `ROOM_GRACE_MS` (5 min default). If the same pubkey reconnects within
 * that window they rejoin; otherwise the room hard-closes.
 */

import type { WsFrame } from '../protocol/server-messages.js';
import type { SignedEnvelope } from '../protocol/envelope.js';
import { isMessage } from '../protocol/envelope.js';
import { openDb } from '../db/sqlite.js';
import { getQueries } from '../db/queries.js';
import { config } from '../config.js';
import { scoped } from '../log.js';
import { persistRelayed } from './persistence.js';

const log = scoped('room');

export interface RoomMember {
  pubkey: string;
  socketId: string;
  seat: number;
  send: (frame: WsFrame) => void;
  /** True if currently connected; false during the grace window. */
  active: boolean;
}

export class Room {
  readonly id: string;
  readonly gameKind: 'poker' | 'blackjack';
  readonly seatCount: number;
  readonly createdAt: number;
  readonly members: Map<string, RoomMember> = new Map();
  /** Set when soft-closed. Cleared on re-join or hard-close. */
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Closed flag — set on hard close, prevents further activity. */
  closed = false;

  constructor(id: string, gameKind: 'poker' | 'blackjack', seatCount: number) {
    this.id = id;
    this.gameKind = gameKind;
    this.seatCount = seatCount;
    this.createdAt = Date.now();
  }

  /**
   * Add or re-attach a member. If the pubkey already exists (rejoin
   * within grace), update its socket and mark active. Otherwise insert
   * a new member.
   */
  attachMember(member: Omit<RoomMember, 'active'>): void {
    if (this.closed) throw new Error('room closed');
    const existing = this.members.get(member.pubkey);
    if (existing) {
      existing.socketId = member.socketId;
      existing.send = member.send;
      existing.active = true;
      log.info({ roomId: this.id, pubkey: member.pubkey }, 'member re-attached');
    } else {
      this.members.set(member.pubkey, { ...member, active: true });
      log.info({ roomId: this.id, pubkey: member.pubkey, seat: member.seat }, 'member attached');
    }
    // Re-attach cancels any pending grace timer.
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    this.persistMemberUpsert(member.pubkey, member.seat);
  }

  /**
   * Mark a member as inactive (their socket dropped). If no active members
   * remain, start the grace timer to hard-close after `ROOM_GRACE_MS`.
   */
  detachMember(pubkey: string, onHardClose: () => void): void {
    const m = this.members.get(pubkey);
    if (!m) return;
    m.active = false;
    log.info({ roomId: this.id, pubkey }, 'member detached');

    const anyActive = Array.from(this.members.values()).some(x => x.active);
    if (!anyActive && !this.graceTimer) {
      log.info({ roomId: this.id, graceMs: config.roomGraceMs }, 'soft-close — grace started');
      this.graceTimer = setTimeout(() => {
        this.hardClose();
        onHardClose();
      }, config.roomGraceMs);
    }
  }

  /**
   * Relay a `game` frame to every other active member, persisting the
   * inner Message to SQLite first. Throws if the sender isn't a member
   * or the room is closed.
   */
  relayGameFrame(senderPubkey: string, env: SignedEnvelope): void {
    if (this.closed) throw new Error('room closed');
    const sender = this.members.get(senderPubkey);
    if (!sender || !sender.active) {
      throw new Error('sender not in room');
    }
    if (!isMessage(env.payload)) {
      throw new Error('invalid envelope payload');
    }
    // Persist FIRST — durability before fan-out. If this throws, no peer
    // ever saw the message; the sender will resend on reconnect.
    persistRelayed(this.id, senderPubkey, env.seq, env.payload);

    const frame: WsFrame = { kind: 'game', roomId: this.id, env };
    for (const m of this.members.values()) {
      if (m.pubkey === senderPubkey) continue;
      if (!m.active) continue;
      try { m.send(frame); }
      catch (err) { log.warn({ pubkey: m.pubkey, err }, 'fan-out send failed'); }
    }
  }

  /**
   * Snapshot the active member list for the `joined` ctrl frame and
   * for tests.
   */
  snapshotMembers(): Array<{ pubkey: string; displayName: string; seat: number }> {
    return Array.from(this.members.values())
      .map(m => ({ pubkey: m.pubkey, displayName: '', seat: m.seat }))
      .sort((a, b) => a.seat - b.seat);
  }

  /** Mark hard-closed, persist `closed_at`, drop from registry caller. */
  hardClose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; }
    const db = openDb(config.dbPath);
    const q = getQueries(db);
    const now = Date.now();
    q.closeRoom.run(now, this.id);
    for (const m of this.members.values()) {
      q.markMemberLeft.run(now, this.id, m.pubkey);
    }
    log.info({ roomId: this.id }, 'hard-closed');
  }

  // ── private ─────────────────────────────────────────────────────────

  private persistMemberUpsert(pubkey: string, seat: number): void {
    const db = openDb(config.dbPath);
    const q = getQueries(db);
    const now = Date.now();
    q.insertRoomMember.run(this.id, pubkey, seat, now);
  }
}

/** Convenience: insert the room row + its initial members in one shot. */
export function persistNewRoom(
  roomId: string,
  gameKind: 'poker' | 'blackjack',
  seatCount: number,
  members: Array<{ pubkey: string; seat: number }>,
): void {
  const db = openDb(config.dbPath);
  const q = getQueries(db);
  const now = Date.now();
  q.insertRoom.run(roomId, gameKind, seatCount, now);
  for (const m of members) {
    q.insertRoomMember.run(roomId, m.pubkey, m.seat, now);
  }
}
