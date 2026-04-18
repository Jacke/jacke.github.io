/**
 * Graceful-shutdown coordinator.
 *
 * Register cleanup callbacks in the order they should run; on SIGTERM /
 * SIGINT they're invoked in REVERSE registration order (LIFO), giving
 * top-level callers first crack at closing resources they opened last.
 *
 * Each callback gets up to `hardTimeoutMs` to complete; after that the
 * process is force-exited so a hung DB flush doesn't block systemd.
 */

import { log } from '../log.js';

type Task = { name: string; run: () => void | Promise<void> };

const tasks: Task[] = [];
let running = false;

export function registerShutdown(name: string, run: () => void | Promise<void>): void {
  tasks.push({ name, run });
}

export function installSignalHandlers(hardTimeoutMs = 10_000): void {
  const go = (signal: string) => {
    if (running) return;
    running = true;
    log.info({ signal, count: tasks.length }, 'shutdown starting');

    const deadline = setTimeout(() => {
      log.error({ hardTimeoutMs }, 'shutdown hard timeout — forcing exit');
      process.exit(1);
    }, hardTimeoutMs);
    // Don't let the deadline keep the loop alive — exit when clean.
    deadline.unref();

    (async () => {
      for (let i = tasks.length - 1; i >= 0; i--) {
        const task = tasks[i]!;
        try {
          await task.run();
          log.debug({ task: task.name }, 'shutdown task ok');
        } catch (err) {
          log.error({ task: task.name, err }, 'shutdown task failed');
        }
      }
      log.info('shutdown complete');
      clearTimeout(deadline);
      process.exit(0);
    })();
  };

  process.on('SIGTERM', () => go('SIGTERM'));
  process.on('SIGINT', () => go('SIGINT'));
}
