/**
 * Read-only room endpoints — chat log and hand log.
 *
 * These serve the same rows the WS replay path streams, but as paginated
 * HTTP JSON so the client can build a history viewer outside the live
 * game loop (e.g. a "previous matches" screen).
 *
 * Pagination: `?since=<id>&limit=<n>` — `since` is the last row id the
 * client already has, `limit` caps the response at N rows (default 200,
 * max 1000). Rows are always ordered by id ascending.
 *
 *   GET /api/rooms/:id/chat    — chat_messages
 *   GET /api/rooms/:id/hands   — hands
 */

import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import { route, sendJson } from '../app.js';
import { openDb } from '../../db/sqlite.js';
import { getQueries } from '../../db/queries.js';
import { config } from '../../config.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function parsePaging(req: IncomingMessage): { since: number; limit: number } {
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
  const sinceStr = url.searchParams.get('since');
  const limitStr = url.searchParams.get('limit');
  const since = sinceStr ? Math.max(0, Number(sinceStr) | 0) : 0;
  const limit = limitStr
    ? Math.max(1, Math.min(MAX_LIMIT, Number(limitStr) | 0))
    : DEFAULT_LIMIT;
  return { since, limit };
}

export function registerRoomRoutes(): void {
  route('GET', '/api/rooms/:id/chat', (req, res, params) => {
    const roomId = params.id ?? '';
    const { since, limit } = parsePaging(req);
    const db = openDb(config.dbPath);
    const q = getQueries(db);
    const room = q.findRoom.get(roomId);
    if (!room) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    const all = q.chatSinceId.all(roomId, since);
    const page = all.slice(0, limit);
    sendJson(res, 200, {
      roomId,
      count: page.length,
      nextSince: page.length > 0 ? page[page.length - 1]!.id : since,
      hasMore: all.length > limit,
      messages: page.map(c => ({
        id: c.id,
        pubkey: c.pubkey,
        seq: c.seq,
        text: c.text,
        ts: c.ts_server,
      })),
    });
  });

  route('GET', '/api/rooms/:id/hands', (req, res, params) => {
    const roomId = params.id ?? '';
    const { since, limit } = parsePaging(req);
    const db = openDb(config.dbPath);
    const q = getQueries(db);
    const room = q.findRoom.get(roomId);
    if (!room) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    const all = q.handsSinceId.all(roomId, since);
    const page = all.slice(0, limit);
    sendJson(res, 200, {
      roomId,
      count: page.length,
      nextSince: page.length > 0 ? page[page.length - 1]!.id : since,
      hasMore: all.length > limit,
      hands: page.map(h => ({
        id: h.id,
        pubkey: h.pubkey,
        handNum: h.hand_num,
        kind: h.kind,
        seq: h.seq,
        payload: safeParse(h.payload),
        ts: h.ts_server,
      })),
    });
  });
}

function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); }
  catch { return raw; }
}
