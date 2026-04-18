/**
 * Bare-Node HTTP router — no framework.
 *
 * Registers handlers keyed by `METHOD PATH-PATTERN`. Patterns support
 * `:param` captures (e.g. `/api/users/:pubkey/stats`). The matcher runs
 * linear scan, O(routes); with ~10 routes this is fine and saves a dep.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { scoped } from '../log.js';
import { config } from '../config.js';

const log = scoped('rest');

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  body: unknown,
) => Promise<void> | void;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];

/** Test helper — drop every registered route so the next beforeEach can
 *  register a fresh set without duplicate matches leaking across tests. */
export function resetRoutes(): void {
  routes.length = 0;
}

export function route(method: string, pattern: string, handler: RouteHandler): void {
  const paramNames: string[] = [];
  // Convert /api/users/:pubkey/stats → ^/api/users/([^/]+)/stats$
  const regexStr =
    '^' +
    pattern.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => {
      paramNames.push(name);
      return '([^/]+)';
    }) +
    '$';
  routes.push({ method: method.toUpperCase(), pattern: new RegExp(regexStr), paramNames, handler });
}

/** Create an http server bound to the registered routes. */
export function createHttpServer() {
  return createServer(async (req, res) => {
    const start = Date.now();
    try {
      await handle(req, res);
    } catch (err) {
      log.error({ err, url: req.url }, 'handler threw');
      sendJson(res, 500, { error: 'internal' });
    } finally {
      log.debug(
        { method: req.method, url: req.url, status: res.statusCode, dur: Date.now() - start },
        'request',
      );
    }
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: 'bad request' });
    return;
  }

  // CORS preflight.
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(req, res);
    res.statusCode = 204;
    res.end();
    return;
  }
  applyCorsHeaders(req, res);

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = r.pattern.exec(url.pathname);
    if (!match) continue;

    const params: Record<string, string> = {};
    r.paramNames.forEach((name, i) => {
      const v = match[i + 1];
      if (v !== undefined) params[name] = decodeURIComponent(v);
    });

    const body = await readBody(req);
    await r.handler(req, res, params, body);
    return;
  }

  sendJson(res, 404, { error: 'not found', path: url.pathname });
}

function applyCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  const allowed = config.originAllowed;
  if (allowed.length === 0 || (origin && allowed.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return null;
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      // Hard cap 256 KB on body size.
      if (buf.length > 262_144) {
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => {
      if (!buf) return resolve(null);
      try { resolve(JSON.parse(buf)); }
      catch { resolve(null); }
    });
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function sendText(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}
