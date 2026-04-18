-- ─── Initial schema for the iamjacke casino backend ──────────────────────
--
-- Every table is append-only or state-tracking — there's no UPDATE-then-
-- delete path that could lose history. `chat_messages` and `hands` are
-- the canonical source for match replay and are never rewritten.
--
-- Idempotent: all CREATE statements use IF NOT EXISTS, so the runner at
-- `db/sqlite.ts::runMigrations` can safely re-apply them on every boot.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  pubkey        TEXT PRIMARY KEY,             -- hex-encoded Ed25519 public key
  display_name  TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  lifetime_pl   INTEGER NOT NULL DEFAULT 0,   -- cumulative chip delta
  hands_played  INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  game_kind   TEXT NOT NULL CHECK(game_kind IN ('poker','blackjack')),
  seat_count  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER                          -- NULL = still open
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  pubkey     TEXT NOT NULL REFERENCES users(pubkey),
  seat       INTEGER NOT NULL,
  joined_at  INTEGER NOT NULL,
  left_at    INTEGER,                          -- NULL = still in room
  PRIMARY KEY (room_id, pubkey)
);
CREATE INDEX IF NOT EXISTS idx_room_members_pubkey ON room_members(pubkey);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  pubkey     TEXT NOT NULL,
  seq        INTEGER NOT NULL,                 -- envelope seq from sender
  text       TEXT NOT NULL,
  ts_server  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_room_id ON chat_messages(room_id, id);

CREATE TABLE IF NOT EXISTS hands (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  hand_num   INTEGER NOT NULL DEFAULT 0,
  kind       TEXT NOT NULL,                    -- 'deal' | 'action' | 'bj-deal' | ...
  pubkey     TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  payload    TEXT NOT NULL,                    -- JSON of the unwrapped Message
  ts_server  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hands_room_id ON hands(room_id, id);

CREATE TABLE IF NOT EXISTS matchmaking_queue (
  pubkey       TEXT PRIMARY KEY,
  game_kind    TEXT NOT NULL,
  seat_count   INTEGER NOT NULL,
  enqueued_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mm_queue_bucket ON matchmaking_queue(game_kind, seat_count, enqueued_at);

CREATE TABLE IF NOT EXISTS email_links (
  pubkey       TEXT PRIMARY KEY REFERENCES users(pubkey),
  email        TEXT NOT NULL UNIQUE,
  verified_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_links_email ON email_links(email);

CREATE TABLE IF NOT EXISTS email_challenges (
  code         TEXT PRIMARY KEY,
  pubkey       TEXT NOT NULL,
  email        TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_challenges_pubkey ON email_challenges(pubkey);
