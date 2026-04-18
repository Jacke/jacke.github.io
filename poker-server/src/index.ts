/**
 * Server entry point.
 *
 * Boot order:
 *   1. Load env + open DB (migrations run here)
 *   2. Register REST routes
 *   3. Start HTTP server
 *   4. Install signal handlers for graceful shutdown
 *   5. (later steps) Attach WebSocket to same server, start matchmaker
 */

import { config } from './config.js';
import { log } from './log.js';
import { openDb, closeDb } from './db/sqlite.js';
import { createHttpServer } from './rest/app.js';
import { registerHealthRoutes } from './rest/routes/health.js';
import { registerUserRoutes } from './rest/routes/users.js';
import { registerRoomRoutes } from './rest/routes/rooms.js';
import { registerEmailRoutes } from './rest/routes/email.js';
import { installSignalHandlers, registerShutdown } from './util/shutdown.js';
import { attachWebSocketServer } from './ws/server.js';

function main(): void {
  log.info(
    { port: config.port, dbPath: config.dbPath, logLevel: config.logLevel },
    'iamjacke poker server starting',
  );

  openDb(config.dbPath);
  registerShutdown('sqlite', () => closeDb());

  registerHealthRoutes();
  registerUserRoutes();
  registerRoomRoutes();
  registerEmailRoutes();

  const server = createHttpServer();
  attachWebSocketServer(server);

  server.listen(config.port, '0.0.0.0', () => {
    log.info({ port: config.port }, 'http + ws listening');
  });

  registerShutdown('http', () => new Promise<void>((resolve) => {
    server.close(() => resolve());
  }));

  installSignalHandlers();
}

main();
