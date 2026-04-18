/**
 * Structured logger — thin wrapper around pino.
 *
 * Logs JSON lines to stdout. In Docker this gets picked up by the
 * logging driver; in systemd by journald. No log files on disk.
 *
 * Use `log.child({ scope: 'ws' })` in modules to get a scoped logger
 * that auto-prefixes every line with the module name.
 */

import pino from 'pino';
import { config } from './config.js';

export const log = pino({
  level: config.logLevel,
  base: { app: 'iamjacke-poker-server' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Shortcut for getting a module-scoped child logger. */
export function scoped(scope: string): pino.Logger {
  return log.child({ scope });
}
