/**
 * Prepared-statement cache for the hot query paths.
 *
 * `better-sqlite3` prepared statements are ~30% faster than ad-hoc exec,
 * and since we hit them many times per second (chat relay, hand persist,
 * matchmaker sync) it's worth caching them once on open.
 *
 * All functions here are side-effecting but idempotent where noted.
 * Rows never change once written — `chat_messages` and `hands` are
 * append-only; `users` / `rooms` / `room_members` / `matchmaking_queue`
 * are updated via explicit UPDATE statements.
 */

import type { DB } from './sqlite.js';

// ═══════════════════════════════════════════════════════════════════════
// Row types
// ═══════════════════════════════════════════════════════════════════════

export interface UserRow {
  pubkey: string;
  display_name: string;
  created_at: number;
  last_seen: number;
  lifetime_pl: number;
  hands_played: number;
  wins: number;
}

export interface RoomRow {
  id: string;
  game_kind: 'poker' | 'blackjack';
  seat_count: number;
  created_at: number;
  closed_at: number | null;
}

export interface RoomMemberRow {
  room_id: string;
  pubkey: string;
  seat: number;
  joined_at: number;
  left_at: number | null;
}

export interface ChatRow {
  id: number;
  room_id: string;
  pubkey: string;
  seq: number;
  text: string;
  ts_server: number;
}

export interface HandRow {
  id: number;
  room_id: string;
  hand_num: number;
  kind: string;
  pubkey: string;
  seq: number;
  payload: string;
  ts_server: number;
}

export interface QueueRow {
  pubkey: string;
  game_kind: string;
  seat_count: number;
  enqueued_at: number;
}

export interface EmailLinkRow {
  pubkey: string;
  email: string;
  verified_at: number;
}

export interface EmailChallengeRow {
  code: string;
  pubkey: string;
  email: string;
  expires_at: number;
  created_at: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Prepared statements
// ═══════════════════════════════════════════════════════════════════════

export class Queries {
  readonly upsertUser;
  readonly findUser;
  readonly updateUserLastSeen;
  readonly updateUserDisplayName;
  readonly updateUserStats;

  readonly insertRoom;
  readonly findRoom;
  readonly closeRoom;

  readonly insertRoomMember;
  readonly markMemberLeft;
  readonly findActiveMembers;
  readonly findRoomsForPubkey;

  readonly insertChat;
  readonly chatSinceId;
  readonly allChatForRoom;

  readonly insertHand;
  readonly handsSinceId;
  readonly allHandsForRoom;

  readonly enqueueMatch;
  readonly dequeueMatch;
  readonly countQueuedFor;

  readonly insertEmailChallenge;
  readonly consumeEmailChallenge;
  readonly deleteExpiredEmailChallenges;
  readonly insertEmailLink;
  readonly findEmailLinkForPubkey;
  readonly findEmailLinkForEmail;

  constructor(db: DB) {
    this.upsertUser = db.prepare(`
      INSERT INTO users(pubkey, display_name, created_at, last_seen)
      VALUES (@pubkey, @display_name, @now, @now)
      ON CONFLICT(pubkey) DO UPDATE SET
        last_seen = @now,
        display_name = CASE
          WHEN users.display_name = '' THEN excluded.display_name
          ELSE users.display_name
        END
    `);

    this.findUser = db.prepare<[string], UserRow>(
      'SELECT * FROM users WHERE pubkey = ?',
    );

    this.updateUserLastSeen = db.prepare<[number, string]>(
      'UPDATE users SET last_seen = ? WHERE pubkey = ?',
    );

    this.updateUserDisplayName = db.prepare<[string, string]>(
      'UPDATE users SET display_name = ? WHERE pubkey = ?',
    );

    this.updateUserStats = db.prepare(`
      UPDATE users
      SET lifetime_pl = lifetime_pl + @delta,
          hands_played = hands_played + @hands,
          wins = wins + @wins
      WHERE pubkey = @pubkey
    `);

    this.insertRoom = db.prepare(`
      INSERT INTO rooms(id, game_kind, seat_count, created_at)
      VALUES (?, ?, ?, ?)
    `);

    this.findRoom = db.prepare<[string], RoomRow>(
      'SELECT * FROM rooms WHERE id = ?',
    );

    this.closeRoom = db.prepare<[number, string]>(
      'UPDATE rooms SET closed_at = ? WHERE id = ?',
    );

    this.insertRoomMember = db.prepare(`
      INSERT INTO room_members(room_id, pubkey, seat, joined_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(room_id, pubkey) DO UPDATE SET left_at = NULL
    `);

    this.markMemberLeft = db.prepare<[number, string, string]>(
      'UPDATE room_members SET left_at = ? WHERE room_id = ? AND pubkey = ?',
    );

    this.findActiveMembers = db.prepare<[string], RoomMemberRow>(
      'SELECT * FROM room_members WHERE room_id = ? AND left_at IS NULL ORDER BY seat',
    );

    this.findRoomsForPubkey = db.prepare<[string], RoomRow>(`
      SELECT r.* FROM rooms r
      JOIN room_members m ON m.room_id = r.id
      WHERE m.pubkey = ?
      ORDER BY r.created_at DESC
      LIMIT 100
    `);

    this.insertChat = db.prepare(`
      INSERT INTO chat_messages(room_id, pubkey, seq, text, ts_server)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.chatSinceId = db.prepare<[string, number], ChatRow>(
      'SELECT * FROM chat_messages WHERE room_id = ? AND id > ? ORDER BY id',
    );

    this.allChatForRoom = db.prepare<[string], ChatRow>(
      'SELECT * FROM chat_messages WHERE room_id = ? ORDER BY id',
    );

    this.insertHand = db.prepare(`
      INSERT INTO hands(room_id, hand_num, kind, pubkey, seq, payload, ts_server)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.handsSinceId = db.prepare<[string, number], HandRow>(
      'SELECT * FROM hands WHERE room_id = ? AND id > ? ORDER BY id',
    );

    this.allHandsForRoom = db.prepare<[string], HandRow>(
      'SELECT * FROM hands WHERE room_id = ? ORDER BY id',
    );

    this.enqueueMatch = db.prepare(`
      INSERT INTO matchmaking_queue(pubkey, game_kind, seat_count, enqueued_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(pubkey) DO UPDATE SET
        game_kind = excluded.game_kind,
        seat_count = excluded.seat_count,
        enqueued_at = excluded.enqueued_at
    `);

    this.dequeueMatch = db.prepare<[string]>(
      'DELETE FROM matchmaking_queue WHERE pubkey = ?',
    );

    this.countQueuedFor = db.prepare<[string, number], { n: number }>(
      'SELECT COUNT(*) AS n FROM matchmaking_queue WHERE game_kind = ? AND seat_count = ?',
    );

    this.insertEmailChallenge = db.prepare(`
      INSERT INTO email_challenges(code, pubkey, email, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.consumeEmailChallenge = db.prepare<[string], EmailChallengeRow>(
      'SELECT * FROM email_challenges WHERE code = ?',
    );

    this.deleteExpiredEmailChallenges = db.prepare<[number]>(
      'DELETE FROM email_challenges WHERE expires_at < ?',
    );

    this.insertEmailLink = db.prepare(`
      INSERT INTO email_links(pubkey, email, verified_at) VALUES (?, ?, ?)
      ON CONFLICT(pubkey) DO UPDATE SET email = excluded.email, verified_at = excluded.verified_at
    `);

    this.findEmailLinkForPubkey = db.prepare<[string], EmailLinkRow>(
      'SELECT * FROM email_links WHERE pubkey = ?',
    );

    this.findEmailLinkForEmail = db.prepare<[string], EmailLinkRow>(
      'SELECT * FROM email_links WHERE email = ?',
    );
  }
}

// Lazily constructed so the DB handle exists before we prepare statements.
let queriesInstance: Queries | null = null;

export function getQueries(db: DB): Queries {
  if (!queriesInstance) queriesInstance = new Queries(db);
  return queriesInstance;
}

/** Test helper — reset the singleton so each test gets a fresh Queries. */
export function resetQueries(): void {
  queriesInstance = null;
}
