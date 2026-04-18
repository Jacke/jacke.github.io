/**
 * REST history endpoints — read-only views over users + rooms.
 *
 * These routes are the HTTP face of the same append-only tables the WS
 * replay path reads. The tests seed the DB directly (skipping the WS
 * layer) to keep the assertions focused on routing, parameter parsing,
 * pagination, and payload shape.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { type Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createHttpServer, resetRoutes } from '../../src/rest/app.js';
import { registerHealthRoutes } from '../../src/rest/routes/health.js';
import { registerUserRoutes } from '../../src/rest/routes/users.js';
import { registerRoomRoutes } from '../../src/rest/routes/rooms.js';
import { openDb, closeDb } from '../../src/db/sqlite.js';
import { getQueries, resetQueries } from '../../src/db/queries.js';
import { config } from '../../src/config.js';

let httpServer: HttpServer;
let port: number;
let tmpDir: string;

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const ROOM_ID = 'mm-test-room-1';

async function httpGet(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body };
}

beforeEach(async () => {
  resetRoutes();
  resetQueries();
  tmpDir = mkdtempSync(join(tmpdir(), 'iamjacke-rest-'));
  config.dbPath = join(tmpDir, 'test.db');
  config.port = 0;

  const db = openDb(config.dbPath);
  const q = getQueries(db);

  const now = Date.now();
  // Seed users.
  q.upsertUser.run({ pubkey: ALICE, display_name: 'Alice', now });
  q.upsertUser.run({ pubkey: BOB, display_name: 'Bob', now });
  // Give Alice some stats so the stats endpoint has data to return.
  db.prepare(`UPDATE users SET lifetime_pl = ?, hands_played = ?, wins = ? WHERE pubkey = ?`)
    .run(1250, 8, 3, ALICE);

  // Seed a room both players belong to.
  q.insertRoom.run(ROOM_ID, 'poker', 2, now);
  q.insertRoomMember.run(ROOM_ID, ALICE, 0, now);
  q.insertRoomMember.run(ROOM_ID, BOB, 1, now);

  // Seed 3 chat messages + 2 hand actions.
  q.insertChat.run(ROOM_ID, ALICE, 1, 'hello', now);
  q.insertChat.run(ROOM_ID, BOB, 1, 'hi', now + 1);
  q.insertChat.run(ROOM_ID, ALICE, 2, 'gl', now + 2);
  q.insertHand.run(
    ROOM_ID, 1, 'action', ALICE, 3,
    JSON.stringify({ type: 'action', player: 0, action: 'raise', amount: 40 }),
    now + 10,
  );
  q.insertHand.run(
    ROOM_ID, 1, 'action', BOB, 1,
    JSON.stringify({ type: 'action', player: 1, action: 'fold' }),
    now + 11,
  );

  registerHealthRoutes();
  registerUserRoutes();
  registerRoomRoutes();

  httpServer = createHttpServer();
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      if (addr && typeof addr === 'object') port = addr.port;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('REST: /api/users/:pubkey/stats', () => {
  it('returns the user row for a known pubkey', async () => {
    const r = await httpGet(`/api/users/${ALICE}/stats`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      pubkey: ALICE,
      displayName: 'Alice',
      lifetimePl: 1250,
      handsPlayed: 8,
      wins: 3,
    });
  });

  it('404 on unknown pubkey', async () => {
    const r = await httpGet(`/api/users/${'c'.repeat(64)}/stats`);
    expect(r.status).toBe(404);
  });

  it('400 on malformed pubkey', async () => {
    const r = await httpGet(`/api/users/not-hex/stats`);
    expect(r.status).toBe(400);
  });
});

describe('REST: /api/users/:pubkey/history', () => {
  it('lists rooms the user belonged to', async () => {
    const r = await httpGet(`/api/users/${ALICE}/history`);
    expect(r.status).toBe(200);
    expect(r.body.rooms).toHaveLength(1);
    expect(r.body.rooms[0]).toMatchObject({
      id: ROOM_ID,
      gameKind: 'poker',
      seatCount: 2,
    });
  });
});

describe('REST: /api/rooms/:id/chat', () => {
  it('returns all chat rows for a room', async () => {
    const r = await httpGet(`/api/rooms/${ROOM_ID}/chat`);
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(3);
    expect(r.body.messages.map((m: any) => m.text)).toEqual(['hello', 'hi', 'gl']);
  });

  it('paginates via ?since', async () => {
    const r = await httpGet(`/api/rooms/${ROOM_ID}/chat?since=1`);
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(2);
    expect(r.body.messages[0].text).toBe('hi');
  });

  it('respects ?limit and reports hasMore', async () => {
    const r = await httpGet(`/api/rooms/${ROOM_ID}/chat?limit=2`);
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(2);
    expect(r.body.hasMore).toBe(true);
  });

  it('404 on unknown room', async () => {
    const r = await httpGet(`/api/rooms/nope/chat`);
    expect(r.status).toBe(404);
  });
});

describe('REST: /api/rooms/:id/hands', () => {
  it('returns parsed hand payloads', async () => {
    const r = await httpGet(`/api/rooms/${ROOM_ID}/hands`);
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(2);
    expect(r.body.hands[0].payload).toMatchObject({ type: 'action', player: 0, action: 'raise' });
    expect(r.body.hands[1].payload).toMatchObject({ type: 'action', player: 1, action: 'fold' });
  });
});
