/**
 * Per-WebSocket connection lifecycle.
 *
 * Steps:
 *   1. On open, create a SocketSession + send `welcome { nonce }`
 *   2. On message, parse outer frame; route ctrl vs game
 *   3. ctrl `auth` → verify signature → upsert user → bind pubkey
 *   4. ctrl handlers run with `state === 'authed'` minimum
 *   5. game frames are forwarded to the room relay (Step 6)
 *   6. On close, run cleanup (leave queue, leave room, drop session)
 *
 * The router branches by `frame.kind` and `msg.type`. Anything that can't
 * be parsed gets a structured error frame back to the client.
 */

import type { WebSocket } from 'ws';
import { scoped } from '../log.js';
import { config } from '../config.js';
import { openDb } from '../db/sqlite.js';
import { getQueries } from '../db/queries.js';
import { getSessions, type SocketSession } from '../auth/session.js';
import { issueChallenge, verifyAuth } from '../auth/challenge.js';
import { getMatchmaker, bindMatchmakerEvents, type MatchedRoom } from '../matchmaker/index.js';
import { getRoomRegistry } from '../rooms/registry.js';
import { tryTake } from '../ratelimit/index.js';
import { requestEmailLink, verifyEmailLink } from '../email/link.js';
import { isMessage, isSignedEnvelope } from '../protocol/envelope.js';
import {
  isWsFrame, isCtrlClientMsg, errorFrame,
  type WsFrame, type CtrlServerMsg, type CtrlClientMsg,
} from '../protocol/server-messages.js';

// Wire matchmaker events → room registry + ctrl messages, once per process.
let eventsBound = false;
function ensureMatchmakerWired(): void {
  if (eventsBound) return;
  eventsBound = true;
  bindMatchmakerEvents({
    onMatched: (room: MatchedRoom) => {
      // Pre-create the room so when both peers send join-room they find it.
      getRoomRegistry().create(
        room.roomId,
        room.gameKind,
        room.seatCount,
        room.players.map(p => ({ pubkey: p.pubkey, seat: p.seat })),
      );
      // Notify each player.
      const sessions = getSessions();
      for (const player of room.players) {
        const session = sessions.get(player.socketId);
        if (!session) continue;
        session.state = 'pending-room';
        session.roomId = room.roomId;
        sendCtrl(session, {
          type: 'matched',
          roomId: room.roomId,
          seat: player.seat,
          opponents: room.players
            .filter(p => p.pubkey !== player.pubkey)
            .map(p => ({ pubkey: p.pubkey, displayName: p.displayName, seat: p.seat })),
        });
      }
    },
    onGraceTimeout: (roomId, missing) => {
      // Hard-close the never-fully-joined room.
      getRoomRegistry().delete(roomId);
      // Drop the missing players' session.roomId pointers.
      const sessions = getSessions();
      for (const pubkey of missing) {
        const s = sessions.getByPubkey(pubkey);
        if (s && s.roomId === roomId) {
          s.roomId = null;
          if (s.state === 'pending-room') s.state = 'authed';
        }
      }
    },
  });
}

const log = scoped('ws-conn');

export function handleConnection(ws: WebSocket): void {
  ensureMatchmakerWired();
  const sessions = getSessions();
  const session = sessions.create(ws);

  log.info({ sid: session.id }, 'connection open');

  // Step 1 — send welcome with challenge nonce.
  const challenge = issueChallenge();
  sendCtrl(session, {
    type: 'welcome',
    nonce: challenge.nonce,
    serverTime: Date.now(),
    version: '0.1.0',
  });

  ws.on('message', async (raw: Buffer) => {
    let frame: unknown;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      sendFrame(session, errorFrame('bad-json'));
      return;
    }
    if (!isWsFrame(frame)) {
      sendFrame(session, errorFrame('bad-frame'));
      return;
    }
    try {
      await routeFrame(session, frame);
    } catch (err) {
      log.error({ sid: session.id, err }, 'route handler threw');
      sendFrame(session, errorFrame('server-error'));
    }
  });

  ws.on('close', (code, reason) => {
    log.info({ sid: session.id, code, reason: reason.toString() }, 'connection closed');
    cleanup(session);
  });

  ws.on('error', (err) => {
    log.warn({ sid: session.id, err }, 'socket error');
  });
}

async function routeFrame(session: SocketSession, frame: WsFrame): Promise<void> {
  if (frame.kind === 'ctrl') {
    const msg = frame.msg;
    if (!isCtrlClientMsg(msg)) {
      sendFrame(session, errorFrame('bad-ctrl-msg'));
      return;
    }
    await handleCtrl(session, msg);
    return;
  }
  // Game frame — relay to room peers via Room.relayGameFrame.
  if (session.state !== 'in-room' || !session.pubkey) {
    sendFrame(session, errorFrame('not-in-room'));
    return;
  }
  if (frame.roomId !== session.roomId) {
    sendFrame(session, errorFrame('wrong-room'));
    return;
  }
  if (!isSignedEnvelope(frame.env)) {
    sendFrame(session, errorFrame('bad-envelope'));
    return;
  }
  const room = getRoomRegistry().get(frame.roomId);
  if (!room) {
    sendFrame(session, errorFrame('room-not-found'));
    return;
  }
  // Per-pubkey chat budget — cheap check before touching the DB or peers.
  const payload = frame.env.payload as { type?: string } | undefined;
  if (payload?.type === 'chat' && !tryTake('chat', session.pubkey)) {
    sendFrame(session, errorFrame('rate-limited', 'chat'));
    return;
  }
  try {
    room.relayGameFrame(session.pubkey, frame.env);
  } catch (err) {
    log.warn({ sid: session.id, err }, 'relay failed');
    sendFrame(session, errorFrame('relay-failed'));
  }
}

async function handleCtrl(session: SocketSession, msg: CtrlClientMsg): Promise<void> {
  switch (msg.type) {
    case 'ping':
      sendCtrl(session, { type: 'pong' });
      return;

    case 'auth': {
      const ok = await verifyAuth(msg.nonce, msg.pubkey, msg.sig);
      if (!ok) {
        sendFrame(session, errorFrame('bad-auth'));
        return;
      }
      // Upsert user row.
      const db = openDb(config.dbPath);
      const q = getQueries(db);
      const now = Date.now();
      q.upsertUser.run({
        pubkey: msg.pubkey,
        display_name: msg.name ?? '',
        now,
      });
      const user = q.findUser.get(msg.pubkey);
      const displayName = user?.display_name ?? msg.name ?? '';

      session.state = 'authed';
      session.displayName = displayName;
      getSessions().bindPubkey(session, msg.pubkey);

      // Step 7 — resumable room: the most recent open room the player is
      // still a member of (grace window not yet expired). Live registry
      // first (in-memory Room with matching pubkey), then fall back to DB
      // (still-open room the pubkey has a NULL left_at for).
      let resumableRoomId: string | null = null;
      const live = getRoomRegistry().findRoomByMember(msg.pubkey);
      if (live && !live.closed) {
        resumableRoomId = live.id;
      } else {
        const rooms = q.findRoomsForPubkey.all(msg.pubkey);
        const openRoom = rooms.find(r => r.closed_at === null);
        if (openRoom) resumableRoomId = openRoom.id;
      }

      sendCtrl(session, {
        type: 'authed',
        pubkey: msg.pubkey,
        displayName,
        resumableRoomId,
      });
      return;
    }

    case 'matchmake': {
      if (session.state === 'unauthed' || !session.pubkey) {
        sendFrame(session, errorFrame('not-authed'));
        return;
      }
      if (!tryTake('matchmake', session.pubkey)) {
        sendFrame(session, errorFrame('rate-limited', 'matchmake'));
        return;
      }
      const mm = getMatchmaker();
      const result = mm.enqueue({
        pubkey: session.pubkey,
        gameKind: msg.game,
        seats: msg.seats,
        socketId: session.id,
        displayName: session.displayName,
      });
      if (!result.queued) {
        sendFrame(session, errorFrame('queue-rejected', result.reason));
        return;
      }
      session.state = 'queued';
      sendCtrl(session, {
        type: 'queued',
        position: mm.bucketSnapshot(msg.game, msg.seats).length,
        game: msg.game,
        seats: msg.seats,
      });
      return;
    }

    case 'cancel-matchmake': {
      if (session.state !== 'queued' || !session.pubkey) {
        sendFrame(session, errorFrame('not-queued'));
        return;
      }
      getMatchmaker().cancel(session.pubkey);
      session.state = 'authed';
      return;
    }

    case 'join-room': {
      if (session.state === 'unauthed' || !session.pubkey) {
        sendFrame(session, errorFrame('not-authed'));
        return;
      }
      let room = getRoomRegistry().get(msg.roomId);
      const dbh = openDb(config.dbPath);
      const qx = getQueries(dbh);

      // Rehydrate a room from the DB if it's not live in memory — this
      // path runs when the grace window has closed (hard-close) but the
      // player still wants to replay history, or when the server restarted.
      if (!room) {
        const roomRow = qx.findRoom.get(msg.roomId);
        if (!roomRow) {
          sendFrame(session, errorFrame('room-not-found'));
          return;
        }
        const members = qx.findActiveMembers.all(msg.roomId);
        const isMember = members.some(m => m.pubkey === session.pubkey);
        if (!isMember) {
          sendFrame(session, errorFrame('not-a-member'));
          return;
        }
        if (roomRow.closed_at !== null) {
          // Closed room: replay-only, no live attach.
          replayRoomHistory(session, msg.roomId, msg.lastChatId ?? 0, msg.lastHandId ?? 0);
          return;
        }
        // Still-open but orphaned (all members gone, server restarted):
        // resurrect an in-memory Room so the player can re-enter.
        getRoomRegistry().create(
          msg.roomId,
          roomRow.game_kind,
          roomRow.seat_count,
          members.map(m => ({ pubkey: m.pubkey, seat: m.seat })),
        );
        room = getRoomRegistry().get(msg.roomId);
      }

      if (!room || room.closed) {
        sendFrame(session, errorFrame('room-not-found'));
        return;
      }

      const member = room.members.get(session.pubkey);
      if (!member) {
        sendFrame(session, errorFrame('not-a-member'));
        return;
      }

      room.attachMember({
        pubkey: session.pubkey,
        socketId: session.id,
        seat: member.seat,
        send: (frame) => sendFrame(session, frame),
      });
      getMatchmaker().markJoined(session.pubkey, msg.roomId);
      session.state = 'in-room';
      session.roomId = msg.roomId;
      sendCtrl(session, {
        type: 'joined',
        roomId: msg.roomId,
        members: room.snapshotMembers(),
        gameKind: room.gameKind,
      });

      replayRoomHistory(session, msg.roomId, msg.lastChatId ?? 0, msg.lastHandId ?? 0);
      return;
    }

    case 'leave-room': {
      if (session.state !== 'in-room' || !session.pubkey || !session.roomId) {
        sendFrame(session, errorFrame('not-in-room'));
        return;
      }
      const room = getRoomRegistry().get(session.roomId);
      if (room) {
        room.detachMember(session.pubkey, () => {
          getRoomRegistry().delete(room.id);
        });
        // Notify other members.
        for (const m of room.members.values()) {
          if (m.pubkey === session.pubkey) continue;
          if (!m.active) continue;
          try {
            m.send({ kind: 'ctrl', msg: { type: 'left', pubkey: session.pubkey } });
          } catch { /* ignore */ }
        }
      }
      session.state = 'authed';
      session.roomId = null;
      return;
    }

    case 'link-email-request': {
      if (session.state === 'unauthed' || !session.pubkey) {
        sendFrame(session, errorFrame('not-authed'));
        return;
      }
      if (!tryTake('email', session.pubkey)) {
        sendFrame(session, errorFrame('rate-limited', 'email'));
        return;
      }
      const r = await requestEmailLink(session.pubkey, msg.email);
      if (!r.ok) {
        sendFrame(session, errorFrame('email-failed', r.reason));
        return;
      }
      // No dedicated ctrl type for "sent" — use pong as ack so the client
      // knows the request was accepted. The client's next event is the
      // user typing the code → link-email-verify.
      sendCtrl(session, { type: 'pong' });
      return;
    }

    case 'link-email-verify': {
      if (session.state === 'unauthed' || !session.pubkey) {
        sendFrame(session, errorFrame('not-authed'));
        return;
      }
      const r = verifyEmailLink(session.pubkey, msg.code);
      if (!r.ok) {
        sendFrame(session, errorFrame('email-failed', r.reason));
        return;
      }
      sendCtrl(session, { type: 'pong' });
      return;
    }
  }
}

function cleanup(session: SocketSession): void {
  // Drop from any matchmaker queue.
  if (session.pubkey) getMatchmaker().cancel(session.pubkey);
  // If in a room, detach (starts grace timer). Notify peers.
  if (session.pubkey && session.roomId) {
    const room = getRoomRegistry().get(session.roomId);
    if (room) {
      room.detachMember(session.pubkey, () => getRoomRegistry().delete(room.id));
      const myPubkey = session.pubkey;
      for (const m of room.members.values()) {
        if (m.pubkey === myPubkey) continue;
        if (!m.active) continue;
        try {
          m.send({ kind: 'ctrl', msg: { type: 'left', pubkey: myPubkey } });
        } catch { /* ignore */ }
      }
    }
  }
  getSessions().remove(session);
}

function sendCtrl(session: SocketSession, msg: CtrlServerMsg): void {
  sendFrame(session, { kind: 'ctrl', msg });
}

function sendFrame(session: SocketSession, frame: WsFrame): void {
  // ws library: 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED.
  if (session.socket.readyState !== 1) {
    log.warn({ sid: session.id, state: session.socket.readyState }, 'send skipped — socket not open');
    return;
  }
  try {
    session.socket.send(JSON.stringify(frame));
    session.outboundSeq++;
  } catch (err) {
    log.warn({ sid: session.id, err }, 'send failed');
  }
}

/**
 * Replay every chat + hand row after the client-reported watermark.
 *
 * Wraps the batch in `replay-start` / `replay-end` so the client can put
 * itself in "catch-up" mode and bypass animations, sound, and autoplay
 * during the burst. IDs are monotonically increasing rowids from the
 * append-only tables; the client persists its highest-seen id per room
 * and passes it as `lastChatId` / `lastHandId`.
 */
function replayRoomHistory(
  session: SocketSession,
  roomId: string,
  lastChatId: number,
  lastHandId: number,
): void {
  const db = openDb(config.dbPath);
  const q = getQueries(db);
  const chats = q.chatSinceId.all(roomId, lastChatId);
  const hands = q.handsSinceId.all(roomId, lastHandId);
  if (chats.length === 0 && hands.length === 0) return;

  sendCtrl(session, { type: 'replay-start', roomId });
  for (const c of chats) {
    sendCtrl(session, {
      type: 'replay-chat',
      id: c.id,
      pubkey: c.pubkey,
      text: c.text,
      ts: c.ts_server,
    });
    session.lastChatIdSeen = Math.max(session.lastChatIdSeen, c.id);
  }
  for (const h of hands) {
    let payload: unknown;
    try { payload = JSON.parse(h.payload); }
    catch { payload = { type: h.kind, raw: h.payload }; }
    sendCtrl(session, {
      type: 'replay-hand',
      id: h.id,
      pubkey: h.pubkey,
      payload,
      ts: h.ts_server,
    });
    session.lastHandIdSeen = Math.max(session.lastHandIdSeen, h.id);
  }
  sendCtrl(session, { type: 'replay-end' });
}

// Re-export helpers for other modules to send to a session.
export { sendCtrl, sendFrame };
