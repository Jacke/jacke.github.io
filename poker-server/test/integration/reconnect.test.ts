/**
 * Reconnect + replay integration test.
 *
 * Exercises the Step 7 reconnect protocol end-to-end:
 *   1. Two clients matchmake and join a room.
 *   2. Alice sends a handful of signed game messages (chat + a fake hand
 *      action). Bob receives them live.
 *   3. Bob hard-drops his socket, then reconnects with a new socket.
 *   4. After auth, Bob's `authed` frame carries `resumableRoomId`.
 *   5. Bob re-sends `join-room` with `lastChatId=0, lastHandId=0` and
 *      receives `replay-start`, every missed message, then `replay-end`.
 *   6. Bob sends a fresh chat; Alice still receives it (room is alive).
 *
 * This is the safety net that makes the grace window trustworthy — if
 * any link in the chain breaks (resumable id, rehydration, replay
 * bracketing) this test fails.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { type Server as HttpServer } from 'node:http';
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
import { resetQueries } from '../../src/db/queries.js';
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

  tmpDir = mkdtempSync(join(tmpdir(), 'iamjacke-reconnect-'));
  config.dbPath = join(tmpDir, 'test.db');
  config.port = 0;
  config.authNonceTtlMs = 60_000;
  // Long grace so the room survives the dis/reconnect cycle.
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

interface TestClient {
  ws: WebSocket;
  inbox: any[];
  signing: SigningSession;
  pubkey: string;
  secretKey: Uint8Array;
  send(frame: any): void;
  waitFor(predicate: (msg: any) => boolean, timeoutMs?: number): Promise<any>;
  close(): void;
}

async function openSocket(): Promise<{ ws: WebSocket; inbox: any[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox: any[] = [];
  ws.on('message', (raw: Buffer) => {
    inbox.push(JSON.parse(raw.toString()));
  });
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  return { ws, inbox };
}

function makeClient(
  ws: WebSocket,
  inbox: any[],
  sk: Uint8Array,
  pk: Uint8Array,
): TestClient {
  const pubHex = bytesToHex(pk);
  const signing = new SigningSession({ secretKey: sk, publicKey: pk });
  const send = (frame: any) => ws.send(JSON.stringify(frame));
  const waitFor = (predicate: (msg: any) => boolean, timeoutMs = 1500) =>
    new Promise<any>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const found = inbox.find(predicate);
        if (found) return resolve(found);
        if (Date.now() - start > timeoutMs) {
          console.error('[test] inbox at timeout:', JSON.stringify(inbox, null, 2));
          return reject(new Error('timeout waiting for message'));
        }
        setTimeout(tick, 10);
      };
      tick();
    });
  return { ws, inbox, signing, pubkey: pubHex, secretKey: sk, send, waitFor, close: () => ws.close() };
}

async function authClient(client: TestClient, name: string): Promise<any> {
  const welcome = await client.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'welcome');
  const nonce = welcome.msg.nonce;
  const sig = ed.sign(new TextEncoder().encode(nonce), client.secretKey);
  client.send({
    kind: 'ctrl',
    msg: { type: 'auth', pubkey: client.pubkey, nonce, sig: bytesToHex(sig), name },
  });
  return client.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'authed');
}

async function connectNew(name: string): Promise<TestClient> {
  const { ws, inbox } = await openSocket();
  const sk = ed.utils.randomSecretKey();
  const pk = ed.getPublicKey(sk);
  const client = makeClient(ws, inbox, sk, pk);
  await authClient(client, name);
  return client;
}

describe('integration: reconnect + replay', () => {
  it('Bob drops mid-game, reconnects within grace, and replays history', async () => {
    const alice = await connectNew('Alice');
    const bob = await connectNew('Bob');

    alice.send({ kind: 'ctrl', msg: { type: 'matchmake', game: 'poker', seats: 2 } });
    bob.send({ kind: 'ctrl', msg: { type: 'matchmake', game: 'poker', seats: 2 } });

    const aliceMatched = await alice.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'matched', 2000);
    await bob.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'matched', 2000);
    const roomId = aliceMatched.msg.roomId;

    alice.send({ kind: 'ctrl', msg: { type: 'join-room', roomId } });
    bob.send({ kind: 'ctrl', msg: { type: 'join-room', roomId } });
    await alice.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'joined');
    await bob.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'joined');

    // Alice sends two chat messages + a fake hand action.
    for (const text of ['hey bob', 'ready?']) {
      const env = alice.signing.wrap({ type: 'chat', from: 'Alice', text, ts: Date.now() });
      alice.send({ kind: 'game', roomId, env });
    }
    const handEnv = alice.signing.wrap({
      type: 'action',
      player: 0,
      action: 'raise',
      amount: 40,
    });
    alice.send({ kind: 'game', roomId, env: handEnv });

    // Bob should see all three live.
    await bob.waitFor(
      m => m.kind === 'game' && m.env?.payload?.type === 'chat' && m.env?.payload?.text === 'ready?',
      1500,
    );
    await bob.waitFor(
      m => m.kind === 'game' && m.env?.payload?.type === 'action',
      1500,
    );

    // Bob hard-drops. Keep his keys so he can re-auth as the same pubkey.
    const bobSk = bob.secretKey;
    const bobPk = ed.getPublicKey(bobSk);
    bob.ws.close();
    await new Promise<void>((resolve) => {
      bob.ws.on('close', () => resolve());
      setTimeout(resolve, 200);
    });

    // Short wait so the server processes the 'close' event before re-auth.
    await new Promise(r => setTimeout(r, 50));

    // Bob reconnects on a fresh socket but reuses the same keypair.
    const { ws: ws2, inbox: inbox2 } = await openSocket();
    const bob2 = makeClient(ws2, inbox2, bobSk, bobPk);
    const authed2 = await authClient(bob2, 'Bob');

    // Server should advertise the room as resumable.
    expect(authed2.msg.resumableRoomId).toBe(roomId);

    // Bob rejoins from scratch (lastChatId=0, lastHandId=0 — wants full history).
    bob2.send({ kind: 'ctrl', msg: { type: 'join-room', roomId, lastChatId: 0, lastHandId: 0 } });
    await bob2.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'joined');

    // Replay bracket: start → 2 chat + 1 hand → end.
    await bob2.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'replay-start');
    const replayChat = bob2.inbox.filter(m => m.kind === 'ctrl' && m.msg?.type === 'replay-chat');
    const replayHands = bob2.inbox.filter(m => m.kind === 'ctrl' && m.msg?.type === 'replay-hand');
    expect(replayChat).toHaveLength(2);
    expect(replayChat.map(x => x.msg.text)).toEqual(['hey bob', 'ready?']);
    expect(replayHands).toHaveLength(1);
    await bob2.waitFor(m => m.kind === 'ctrl' && m.msg?.type === 'replay-end');

    // Room is still alive — Bob sends a fresh chat and Alice sees it live.
    const env3 = bob2.signing.wrap({ type: 'chat', from: 'Bob', text: 'back!', ts: Date.now() });
    bob2.send({ kind: 'game', roomId, env: env3 });
    const aliceSaw = await alice.waitFor(
      m => m.kind === 'game' && m.env?.payload?.type === 'chat' && m.env?.payload?.text === 'back!',
      1500,
    );
    expect(aliceSaw.env.payload.text).toBe('back!');

    alice.close();
    bob2.close();
  });
});
