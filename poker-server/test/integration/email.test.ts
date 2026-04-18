/**
 * Email magic-link integration test.
 *
 * We don't talk to a real SMTP server — `config.smtp.host` is empty so
 * the dev stdout transport is used. For the verify leg we grab the
 * issued code directly from the `email_challenges` DB row, which
 * simulates "the user read it from their inbox" without the actual
 * network round-trip.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { type Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createHttpServer, resetRoutes } from '../../src/rest/app.js';
import { registerHealthRoutes } from '../../src/rest/routes/health.js';
import { registerEmailRoutes } from '../../src/rest/routes/email.js';
import { openDb, closeDb } from '../../src/db/sqlite.js';
import { getQueries, resetQueries } from '../../src/db/queries.js';
import { resetEmailTransport } from '../../src/email/smtp.js';
import { resetLimiters } from '../../src/ratelimit/index.js';
import { config } from '../../src/config.js';

let httpServer: HttpServer;
let port: number;
let tmpDir: string;

const PUBKEY = 'a'.repeat(64);

async function httpPost(path: string, body: any): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* keep string */ }
  return { status: res.status, body: parsed };
}

beforeEach(async () => {
  resetRoutes();
  resetQueries();
  resetEmailTransport();
  resetLimiters();
  // Force dev (stdout) transport by blanking SMTP host.
  config.smtp.host = '';

  tmpDir = mkdtempSync(join(tmpdir(), 'iamjacke-email-'));
  config.dbPath = join(tmpDir, 'test.db');
  config.port = 0;

  const db = openDb(config.dbPath);
  const q = getQueries(db);
  q.upsertUser.run({ pubkey: PUBKEY, display_name: 'Alice', now: Date.now() });

  registerHealthRoutes();
  registerEmailRoutes();

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

describe('email magic-link: request + verify happy path', () => {
  it('issues a code, stores it, and verifies it into email_links', async () => {
    const req = await httpPost('/api/email/request', {
      pubkey: PUBKEY,
      email: 'alice@example.com',
    });
    expect(req.status).toBe(200);
    expect(req.body.delivered).toBe('stdout');

    // Grab the code the service stored (user would get this in their inbox).
    const db = openDb(config.dbPath);
    const row = db.prepare('SELECT * FROM email_challenges WHERE pubkey = ?').get(PUBKEY) as
      | { code: string; email: string; expires_at: number }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.email).toBe('alice@example.com');
    expect(row!.code).toMatch(/^\d{6}$/);

    const verify = await httpPost('/api/email/verify', {
      pubkey: PUBKEY,
      code: row!.code,
    });
    expect(verify.status).toBe(200);
    expect(verify.body.email).toBe('alice@example.com');

    // Link row exists.
    const link = db.prepare('SELECT * FROM email_links WHERE pubkey = ?').get(PUBKEY) as
      | { email: string }
      | undefined;
    expect(link).toBeDefined();
    expect(link!.email).toBe('alice@example.com');

    // Challenge row was consumed (single-use).
    const leftover = db.prepare('SELECT COUNT(*) AS n FROM email_challenges WHERE pubkey = ?').get(PUBKEY) as { n: number };
    expect(leftover.n).toBe(0);
  });
});

describe('email magic-link: failure modes', () => {
  it('rejects a wrong code with not-found', async () => {
    await httpPost('/api/email/request', {
      pubkey: PUBKEY,
      email: 'alice@example.com',
    });
    const verify = await httpPost('/api/email/verify', {
      pubkey: PUBKEY,
      code: '000000',
    });
    expect(verify.status).toBe(400);
    expect(verify.body.error).toBe('not-found');
  });

  it('rejects a code used for the wrong pubkey', async () => {
    await httpPost('/api/email/request', {
      pubkey: PUBKEY,
      email: 'alice@example.com',
    });
    const db = openDb(config.dbPath);
    const row = db.prepare('SELECT code FROM email_challenges WHERE pubkey = ?').get(PUBKEY) as { code: string };

    const verify = await httpPost('/api/email/verify', {
      pubkey: 'b'.repeat(64),
      code: row.code,
    });
    expect(verify.status).toBe(400);
    expect(verify.body.error).toBe('pubkey-mismatch');
  });

  it('rejects a malformed email address', async () => {
    const r = await httpPost('/api/email/request', {
      pubkey: PUBKEY,
      email: 'not-an-email',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad-email');
  });

  it('rate-limits after 3 requests from the same pubkey', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await httpPost('/api/email/request', {
        pubkey: PUBKEY,
        email: 'alice@example.com',
      });
      expect(r.status).toBe(200);
    }
    // 4th should 429.
    const over = await httpPost('/api/email/request', {
      pubkey: PUBKEY,
      email: 'alice@example.com',
    });
    expect(over.status).toBe(429);
  });
});
