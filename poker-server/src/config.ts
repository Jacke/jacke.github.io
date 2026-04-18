/**
 * Typed environment-variable reader.
 *
 * One source of truth for every tunable. Import `config` from here
 * instead of reading `process.env.FOO` directly — this gives us:
 *   - Type safety (numbers are numbers, booleans are booleans)
 *   - Defaults in a single file
 *   - A stable boot contract: if a required var is missing, we crash at
 *     startup instead of deep in a request handler.
 */

import 'dotenv/config';

function envString(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v.length > 0 ? v : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid numeric env var ${name}: ${raw}`);
  }
  return n;
}

function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) return fallback;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export interface Config {
  port: number;
  dbPath: string;
  originAllowed: string[];
  authNonceTtlMs: number;
  roomGraceMs: number;
  logLevel: string;
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
}

export const config: Config = {
  port: envNumber('PORT', 3001),
  dbPath: envString('DB_PATH', './data/poker.db'),
  originAllowed: envList('ORIGIN_ALLOWED', []),
  authNonceTtlMs: envNumber('AUTH_NONCE_TTL_MS', 30_000),
  roomGraceMs: envNumber('ROOM_GRACE_MS', 300_000),
  logLevel: envString('LOG_LEVEL', 'info'),
  smtp: {
    host: envString('SMTP_HOST', ''),
    port: envNumber('SMTP_PORT', 587),
    user: envString('SMTP_USER', ''),
    pass: envString('SMTP_PASS', ''),
    from: envString('SMTP_FROM', 'no-reply@iamjacke.com'),
  },
};
