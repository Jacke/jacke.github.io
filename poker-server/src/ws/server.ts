/**
 * WebSocket server bootstrap.
 *
 * Attaches a `ws.Server` to the existing HTTP server (so port 3001 hosts
 * both HTTP and WS, distinguished by the Upgrade header). On every new
 * upgrade we validate the Origin and hand the socket off to
 * `handleConnection` which runs the per-socket lifecycle.
 */

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from '../config.js';
import { scoped } from '../log.js';
import { handleConnection } from './connection.js';

const log = scoped('ws');

export function attachWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' && req.url !== '/ws/') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (config.originAllowed.length > 0 && origin && !config.originAllowed.includes(origin)) {
      log.warn({ origin }, 'rejected ws upgrade — origin not allowed');
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws);
    });
  });

  log.info('ws upgrade handler attached at /ws');
  return wss;
}
