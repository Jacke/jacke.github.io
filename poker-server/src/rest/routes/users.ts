/**
 * Read-only user endpoints — stats and room history.
 *
 * No auth: pubkeys are public identifiers (they're on every signed
 * envelope), and the data surfaced here is already server-authoritative
 * game history that any peer in those rooms could reconstruct. Adding
 * auth here would complicate the client flow without protecting
 * anything that isn't already public.
 *
 *   GET /api/users/:pubkey/stats    — lifetime P/L, hands played, wins
 *   GET /api/users/:pubkey/history  — recent rooms this pubkey was in
 */

import { route, sendJson } from '../app.js';
import { openDb } from '../../db/sqlite.js';
import { getQueries } from '../../db/queries.js';
import { config } from '../../config.js';

const HEX64 = /^[0-9a-f]{64}$/;

export function registerUserRoutes(): void {
  route('GET', '/api/users/:pubkey/stats', (_req, res, params) => {
    const pubkey = params.pubkey ?? '';
    if (!HEX64.test(pubkey)) {
      sendJson(res, 400, { error: 'bad-pubkey' });
      return;
    }
    const db = openDb(config.dbPath);
    const q = getQueries(db);
    const row = q.findUser.get(pubkey);
    if (!row) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    sendJson(res, 200, {
      pubkey: row.pubkey,
      displayName: row.display_name,
      createdAt: row.created_at,
      lastSeen: row.last_seen,
      lifetimePl: row.lifetime_pl,
      handsPlayed: row.hands_played,
      wins: row.wins,
    });
  });

  route('GET', '/api/users/:pubkey/history', (_req, res, params) => {
    const pubkey = params.pubkey ?? '';
    if (!HEX64.test(pubkey)) {
      sendJson(res, 400, { error: 'bad-pubkey' });
      return;
    }
    const db = openDb(config.dbPath);
    const q = getQueries(db);
    const rooms = q.findRoomsForPubkey.all(pubkey);
    sendJson(res, 200, {
      pubkey,
      rooms: rooms.map(r => ({
        id: r.id,
        gameKind: r.game_kind,
        seatCount: r.seat_count,
        createdAt: r.created_at,
        closedAt: r.closed_at,
      })),
    });
  });
}
