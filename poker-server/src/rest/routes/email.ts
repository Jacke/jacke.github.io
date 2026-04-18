/**
 * Email magic-link endpoints — unauth'd request + verify.
 *
 * Both routes take JSON bodies. They're rate-limited at the REST layer
 * by pubkey (same `email` token bucket the WS path uses), so a client
 * that spams request/verify on HTTP hits the same ceiling as one
 * spamming the WS control plane. A single bucket prevents transport
 * switching as an evasion strategy.
 *
 *   POST /api/email/request { pubkey, email }
 *   POST /api/email/verify  { pubkey, code }
 */

import { route, sendJson } from '../app.js';
import { requestEmailLink, verifyEmailLink } from '../../email/link.js';
import { tryTake } from '../../ratelimit/index.js';

const HEX64 = /^[0-9a-f]{64}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function registerEmailRoutes(): void {
  route('POST', '/api/email/request', async (_req, res, _params, body) => {
    if (!isObject(body)) {
      sendJson(res, 400, { error: 'bad-body' });
      return;
    }
    const pubkey = String(body.pubkey ?? '');
    const email = String(body.email ?? '');
    if (!HEX64.test(pubkey)) {
      sendJson(res, 400, { error: 'bad-pubkey' });
      return;
    }
    if (!tryTake('email', pubkey)) {
      sendJson(res, 429, { error: 'rate-limited' });
      return;
    }
    const r = await requestEmailLink(pubkey, email);
    if (!r.ok) {
      sendJson(res, 400, { error: r.reason });
      return;
    }
    sendJson(res, 200, { ok: true, delivered: r.delivered });
  });

  route('POST', '/api/email/verify', (_req, res, _params, body) => {
    if (!isObject(body)) {
      sendJson(res, 400, { error: 'bad-body' });
      return;
    }
    const pubkey = String(body.pubkey ?? '');
    const code = String(body.code ?? '');
    if (!HEX64.test(pubkey)) {
      sendJson(res, 400, { error: 'bad-pubkey' });
      return;
    }
    const r = verifyEmailLink(pubkey, code);
    if (!r.ok) {
      sendJson(res, 400, { error: r.reason });
      return;
    }
    sendJson(res, 200, { ok: true, email: r.email });
  });
}
