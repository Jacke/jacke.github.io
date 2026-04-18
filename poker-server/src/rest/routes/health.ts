/**
 * Health endpoint — used by Docker healthcheck and monitoring.
 *
 * Reports uptime + counts of in-memory primitives so a single curl
 * gives a fast sanity snapshot without hitting the DB.
 */

import { route, sendJson } from '../app.js';
import { getRoomRegistry } from '../../rooms/registry.js';
import { getMatchmaker } from '../../matchmaker/index.js';

const startedAt = Date.now();

export function registerHealthRoutes(): void {
  route('GET', '/healthz', (_req, res) => {
    const registry = getRoomRegistry();
    const mm = getMatchmaker();
    sendJson(res, 200, {
      status: 'ok',
      uptime: Date.now() - startedAt,
      activeRooms: registry.size(),
      queuedPlayers: mm.totalQueued(),
      version: '0.1.0',
    });
  });

  route('GET', '/', (_req, res) => {
    sendJson(res, 200, {
      name: 'iamjacke-poker-server',
      endpoints: ['/healthz', '/ws', '/api/users/:pk/stats', '/api/rooms/:id/chat'],
    });
  });
}
