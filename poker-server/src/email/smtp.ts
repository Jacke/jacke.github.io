/**
 * Magic-link email sender.
 *
 * Two modes based on env config:
 *   - SMTP_HOST unset → "dev" transport: codes are logged to stdout
 *     (scoped as `email-dev`). Keeps local dev loop zero-config.
 *   - SMTP_HOST set   → nodemailer SMTP transport. The transporter is
 *     lazily constructed on the first send so a missing SMTP server
 *     during tests doesn't crash the boot path.
 *
 * The magic-link flow itself is a 6-digit one-time code tied to a
 * pubkey + email pair, with a short TTL (see config.authNonceTtlMs
 * reused, but defaulting longer — see request handler).
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { randomInt } from 'node:crypto';
import { config } from '../config.js';
import { scoped } from '../log.js';

const log = scoped('email');
const devLog = scoped('email-dev');

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!config.smtp.host) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user
      ? { user: config.smtp.user, pass: config.smtp.pass }
      : undefined,
  });
  return transporter;
}

/** Generate a cryptographically random 6-digit numeric code. */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export interface SendOpts {
  to: string;
  code: string;
  pubkey: string;
}

/**
 * Send the magic-link code. In dev mode (no SMTP configured) the code
 * is logged at info level — the developer copies it from server output.
 * In prod mode we hand it to nodemailer and await the callback; any
 * failure throws so the REST handler returns 500 rather than silently
 * swallowing a deliverability bug.
 */
export async function sendMagicLink(opts: SendOpts): Promise<{ delivered: 'smtp' | 'stdout' }> {
  const tx = getTransporter();
  if (!tx) {
    devLog.info(
      { to: opts.to, code: opts.code, pubkey: opts.pubkey.slice(0, 12) + '…' },
      'DEV: magic-link code (no SMTP configured, copy from this line)',
    );
    return { delivered: 'stdout' };
  }
  await tx.sendMail({
    from: config.smtp.from,
    to: opts.to,
    subject: 'Your iamjacke verification code',
    text: `Your 6-digit code: ${opts.code}\n\nThis code expires in 10 minutes.\n`,
    html: `<p>Your 6-digit code: <strong>${opts.code}</strong></p><p>This code expires in 10 minutes.</p>`,
  });
  log.info({ to: opts.to, pubkey: opts.pubkey.slice(0, 12) + '…' }, 'magic-link sent');
  return { delivered: 'smtp' };
}

/** Test hook — reset the cached transporter so per-test env swaps take effect. */
export function resetEmailTransport(): void {
  transporter = null;
}
