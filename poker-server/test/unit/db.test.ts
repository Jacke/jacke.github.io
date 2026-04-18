import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb, closeDb } from '../../src/db/sqlite.js';
import { getQueries, resetQueries } from '../../src/db/queries.js';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'iamjacke-db-test-'));
  dbPath = join(tmpDir, 'test.db');
  resetQueries();
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('db/sqlite', () => {
  it('opens a fresh db and runs migrations', () => {
    const db = openDb(dbPath);
    // Schema exists: __migrations + users + rooms at minimum
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('__migrations');
    expect(names).toContain('users');
    expect(names).toContain('rooms');
    expect(names).toContain('chat_messages');
    expect(names).toContain('hands');
    expect(names).toContain('matchmaking_queue');
    expect(names).toContain('email_links');
  });

  it('re-opening the same path is idempotent (no duplicate migrations)', () => {
    openDb(dbPath);
    closeDb();
    const db2 = openDb(dbPath);
    const count = db2.prepare('SELECT COUNT(*) AS n FROM __migrations').get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('queries', () => {
  it('upsertUser creates a new row and updates last_seen on re-upsert', () => {
    const db = openDb(dbPath);
    const q = getQueries(db);
    const now = 1_700_000_000_000;

    q.upsertUser.run({ pubkey: 'abc', display_name: 'Stan', now });
    const row = q.findUser.get('abc');
    expect(row?.display_name).toBe('Stan');
    expect(row?.last_seen).toBe(now);

    const later = now + 1000;
    q.upsertUser.run({ pubkey: 'abc', display_name: 'Other', now: later });
    const again = q.findUser.get('abc');
    // Display name not overwritten (guarded in SQL)
    expect(again?.display_name).toBe('Stan');
    expect(again?.last_seen).toBe(later);
  });

  it('chat roundtrip: insert + chatSinceId returns new rows', () => {
    const db = openDb(dbPath);
    const q = getQueries(db);
    const now = Date.now();
    q.upsertUser.run({ pubkey: 'u1', display_name: '', now });
    q.insertRoom.run('r1', 'poker', 2, now);

    q.insertChat.run('r1', 'u1', 1, 'hello', now);
    q.insertChat.run('r1', 'u1', 2, 'world', now + 1);
    const rows = q.chatSinceId.all('r1', 0);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text).toBe('hello');
    expect(rows[1]!.text).toBe('world');

    const since1 = q.chatSinceId.all('r1', rows[0]!.id);
    expect(since1).toHaveLength(1);
    expect(since1[0]!.text).toBe('world');
  });

  it('hand roundtrip: insert with JSON payload, handsSinceId retrieves in order', () => {
    const db = openDb(dbPath);
    const q = getQueries(db);
    const now = Date.now();
    q.upsertUser.run({ pubkey: 'u1', display_name: '', now });
    q.insertRoom.run('r1', 'blackjack', 2, now);

    const payload = JSON.stringify({ type: 'bj-action', player: 0, action: 'hit' });
    q.insertHand.run('r1', 1, 'bj-action', 'u1', 1, payload, now);
    const rows = q.handsSinceId.all('r1', 0);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.payload)).toMatchObject({ type: 'bj-action', action: 'hit' });
  });

  it('enqueueMatch + dequeueMatch manage the queue', () => {
    const db = openDb(dbPath);
    const q = getQueries(db);
    const now = Date.now();
    q.upsertUser.run({ pubkey: 'u1', display_name: '', now });

    q.enqueueMatch.run('u1', 'poker', 2, now);
    const count = q.countQueuedFor.get('poker', 2);
    expect(count?.n).toBe(1);

    q.dequeueMatch.run('u1');
    const after = q.countQueuedFor.get('poker', 2);
    expect(after?.n).toBe(0);
  });

  it('email challenge / link flow', () => {
    const db = openDb(dbPath);
    const q = getQueries(db);
    const now = Date.now();
    q.upsertUser.run({ pubkey: 'u1', display_name: '', now });

    q.insertEmailChallenge.run('ABC123', 'u1', 'foo@example.com', now + 600_000, now);
    const chal = q.consumeEmailChallenge.get('ABC123');
    expect(chal?.pubkey).toBe('u1');

    q.insertEmailLink.run('u1', 'foo@example.com', now);
    const link = q.findEmailLinkForPubkey.get('u1');
    expect(link?.email).toBe('foo@example.com');
    const byEmail = q.findEmailLinkForEmail.get('foo@example.com');
    expect(byEmail?.pubkey).toBe('u1');
  });
});
