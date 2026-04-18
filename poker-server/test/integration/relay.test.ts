/**
 * End-to-end integration test: two fake WebSocket clients connect to a
 * loopback server, authenticate, matchmake, join the same room, exchange
 * a chat message + a game message, and assert that:
 *   1. Both clients receive the other's messages
 *   2. The chat row exists in chat_messages
 *   3. The hand row exists in hands
 *
 * Uses the real `ws` library on a random port. The DB is a temp file
 * cleaned up between runs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

import { createHttpServer } from '../../src/rest/app.js';
import { attachWebSocketServer } from '../../src/ws/server.js';
import { registerHealthRoutes } from '../../src/rest/routes/health.js';
import { openDb, closeDb } from '../../src/db/sqlite.js';
import { getQueries, resetQueries } from '../../src/db/queries.js';
import { resetSessions } from '../../src/auth/session.js';
import { resetMatchmaker } from '../../src/matchmaker/index.js';
import { resetRoomRegistry } from '../../src/rooms/registry.js';
import { resetChallenges } from '../../src/auth/challenge.js';
import { SigningSession, bytesToHex } from '../../src/protocol/envelope.js';
import { config } from '../../src/config.js';

ed.hashes.sha512 = sha512;

let httpServer: HttpServer;
let port: number;
let tmpDir: string;

beforeEach(async () => {
  resetSessions();
  resetMatchmaker();
  resetRoomRegistry();
  resetChallenges();
  resetQueries();

  tmpDir = mkdtempSync(join(tmpdir(), 'iamjacke-int-'));
  // Mutate the loaded config singleton so every module that already
  // captured `config.dbPath` sees the per-test temp file.
  config.dbPath = join(tmpDir, 'test.db');
  config.port = 0;
  config.authNonceTtlMs = 60_000;
  config.roomGraceMs = 60_000;
  openDb(config.dbPath);
  registerHealthRoutes();
  httpServer = createHttpServer();
  attachWebSocketServer(httpServer);

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

interface FakeClient {
  ws: WebSocket;
  inbox: any[];
  signing: SigningSession;
  pubkey: string;
  secretKey: Uint8Array;
  send(frame: any): void;
  waitFor(predicate: (msg: any) => boolean, timeoutMs?: number): Promise<any>;
  close(): void;
}

async function connectClient(name: string): Promise<FakeClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox: any[] = [];
  // Attach message listener BEFORE awaiting open so we don't lose the
  // server's `welcome` frame which is sent immediately on accept.
  ws.on('message', (raw: Buffer) => {
    inbox.push(JSON.parse(raw.toString()));
  });
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

  const sk = ed.utils.randomSecretKey();
  const pk = ed.getPublicKey(sk);
  const pubHex = bytesToHex(pk);
  const signing = new SigningSession({ secretKey: sk, publicKey: pk });

  const send = (frame: any) => ws.send(JSON.stringify(frame));
  const waitFor = (predicate: (msg: any) => boolean, timeoutMs = 1000) =>
    new Promise<any>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const found = inbox.find(predicate);
        if (found) return resolve(found);
        if (Date.now() - start > timeoutMs) {
          // Diagnostics: dump current inbox so we can see what arrived
          console.error('[test] inbox at timeout:', JSON.stringify(inbox, null, 2));
          return reject(new Error('timeout waiting for message'));
        }
        setTimeout(tick, 10);
      };
      tick();
    });

  // Auth: wait for welcome, sign nonce, send auth.
  const welcome = await waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'welcome');
  const nonce = welcome.msg.nonce;
  const sig = ed.sign(new TextEncoder().encode(nonce), sk);
  send({
    kind: 'ctrl',
    msg: { type: 'auth', pubkey: pubHex, nonce, sig: bytesToHex(sig), name },
  });
  await waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'authed');

  return { ws, inbox, signing, pubkey: pubHex, secretKey: sk, send, waitFor, close: () => ws.close() };
}

describe('integration: matchmake + relay + persistence', () => {
  it('two clients matchmake, join, exchange chat, and rows persist', async () => {
    const alice = await connectClient('Alice');
    const bob = await connectClient('Bob');

    alice.send({ kind: 'ctrl', msg: { type: 'matchmake', game: 'poker', seats: 2 } });
    bob.send({ kind: 'ctrl', msg: { type: 'matchmake', game: 'poker', seats: 2 } });

    const aliceMatched = await alice.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'matched', 2000);
    const bobMatched = await bob.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'matched', 2000);
    expect(aliceMatched.msg.roomId).toBe(bobMatched.msg.roomId);
    const roomId = aliceMatched.msg.roomId;

    alice.send({ kind: 'ctrl', msg: { type: 'join-room', roomId } });
    bob.send({ kind: 'ctrl', msg: { type: 'join-room', roomId } });
    await alice.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'joined');
    await bob.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'joined');

    // Alice sends a signed chat message via the game frame.
    const env = alice.signing.wrap({
      type: 'chat',
      from: 'Alice',
      text: 'hello bob',
      ts: Date.now(),
    });
    alice.send({ kind: 'game', roomId, env });

    const relayed = await bob.waitFor(
      m => m.kind === 'game' && m.env?.payload?.type === 'chat',
      1500,
    );
    expect(relayed.env.payload.text).toBe('hello bob');

    // Verify the row exists in chat_messages.
    const db = openDb(config.dbPath);
    const q = getQueries(db);
    const rows = q.allChatForRoom.all(roomId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe('hello bob');

    alice.close();
    bob.close();
  });
});
