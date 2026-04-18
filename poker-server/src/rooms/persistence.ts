/**
 * Game-message persistence hook.
 *
 * Called from `Room.handleFrame` for every relayed `game` envelope. The
 * handler sniffs the inner `Message.type`, picks the right table, and
 * writes through SYNCHRONOUSLY before the relay fan-out — so by the time
 * the receiving peer gets the message, it's already in the DB. That's
 * the durability contract: an acked relay implies persisted history.
 *
 * `chat` → chat_messages table
 * `deal`/`action`/`next_hand`/`bj-*` → hands table
 * `hello`/`ready` → not persisted (control plane noise)
 */

import type { Message } from '../protocol/envelope.js';
import { openDb } from '../db/sqlite.js';
import { getQueries } from '../db/queries.js';
import { config } from '../config.js';
import { scoped } from '../log.js';

const log = scoped('persist');

const HAND_KINDS = new Set([
  'deal',
  'action',
  'next_hand',
  'bj-start',
  'bj-bet',
  'bj-deal',
  'bj-action',
  'bj-insurance',
]);

/** Persist a single relayed envelope payload to the right table. */
export function persistRelayed(
  roomId: string,
  pubkey: string,
  seq: number,
  payload: Message,
): void {
  const db = openDb(config.dbPath);
  const q = getQueries(db);
  const now = Date.now();

  if (payload.type === 'chat') {
    q.insertChat.run(roomId, pubkey, seq, payload.text, now);
    return;
  }
  if (HAND_KINDS.has(payload.type)) {
    const handNum = extractHandNum(payload);
    q.insertHand.run(
      roomId,
      handNum,
      payload.type,
      pubkey,
      seq,
      JSON.stringify(payload),
      now,
    );
    return;
  }
  // hello / ready / others — noise, skip.
  log.trace({ type: payload.type }, 'skip persist (control plane)');
}

function extractHandNum(payload: Message): number {
  // Message types that carry a hand number in their fields.
  if ('handNum' in payload && typeof payload.handNum === 'number') {
    return payload.handNum;
  }
  if (payload.type === 'bj-deal' && typeof payload.round === 'number') {
    return payload.round;
  }
  return 0;
}
