/**
 * Email-link orchestration — issue + verify 6-digit codes.
 *
 * Request flow:
 *   1. Caller passes (pubkey, email). We generate a 6-digit code, store
 *      it in `email_challenges` with a 10-minute expiry, then send via
 *      `smtp.sendMagicLink`.
 *   2. Caller passes (pubkey, code). We look up the challenge, verify
 *      the pubkey matches (prevents a stolen code from binding to the
 *      wrong account), verify not expired, then upsert an `email_links`
 *      row and delete the challenge.
 *
 * Codes are single-use: on successful verify we delete the row. Expired
 * rows are garbage-collected opportunistically on every request.
 */

import { openDb } from '../db/sqlite.js';
import { getQueries } from '../db/queries.js';
import { config } from '../config.js';
import { scoped } from '../log.js';
import { generateCode, sendMagicLink } from './smtp.js';

const log = scoped('email-link');

/** How long a magic-link code is valid — 10 minutes is the common default. */
export const CODE_TTL_MS = 10 * 60_000;

export async function requestEmailLink(
  pubkey: string,
  email: string,
): Promise<{ ok: true; delivered: 'smtp' | 'stdout' } | { ok: false; reason: string }> {
  if (!pubkey || pubkey.length !== 64) return { ok: false, reason: 'bad-pubkey' };
  if (!/.+@.+\..+/.test(email)) return { ok: false, reason: 'bad-email' };

  const db = openDb(config.dbPath);
  const q = getQueries(db);
  // Opportunistic GC of expired challenges.
  q.deleteExpiredEmailChallenges.run(Date.now());

  const code = generateCode();
  const now = Date.now();
  q.insertEmailChallenge.run(code, pubkey, email, now + CODE_TTL_MS, now);

  try {
    const res = await sendMagicLink({ to: email, code, pubkey });
    log.info({ pubkey: pubkey.slice(0, 12) + '…', email, delivered: res.delivered }, 'code issued');
    return { ok: true, delivered: res.delivered };
  } catch (err) {
    log.error({ err, email }, 'failed to send magic-link email');
    return { ok: false, reason: 'smtp-failed' };
  }
}

export function verifyEmailLink(
  pubkey: string,
  code: string,
): { ok: true; email: string } | { ok: false; reason: string } {
  if (!pubkey || pubkey.length !== 64) return { ok: false, reason: 'bad-pubkey' };
  if (!code || code.length !== 6) return { ok: false, reason: 'bad-code' };

  const db = openDb(config.dbPath);
  const q = getQueries(db);
  const row = q.consumeEmailChallenge.get(code);
  if (!row) return { ok: false, reason: 'not-found' };
  if (row.pubkey !== pubkey) return { ok: false, reason: 'pubkey-mismatch' };
  if (row.expires_at < Date.now()) return { ok: false, reason: 'expired' };

  const now = Date.now();
  q.insertEmailLink.run(pubkey, row.email, now);
  // Single-use — delete by the PK.
  db.prepare('DELETE FROM email_challenges WHERE code = ?').run(code);
  log.info({ pubkey: pubkey.slice(0, 12) + '…', email: row.email }, 'email linked');
  return { ok: true, email: row.email };
}
