/**
 * Matchmaker singleton — single Pairer instance shared across the
 * connection layer + health endpoint.
 */

import { Pairer, type MatchedRoom } from './pairer.js';

let instance: Pairer | null = null;

/**
 * Lazy init with a placeholder events handler. The real handler is
 * installed by the server bootstrap (`bindMatchmakerEvents`) once the
 * room registry + connection layer are wired together. This avoids a
 * circular dependency at module load time.
 */
export function getMatchmaker(): Pairer {
  if (!instance) {
    instance = new Pairer({
      onMatched: () => { /* installed later */ },
      onGraceTimeout: () => { /* installed later */ },
    });
  }
  return instance;
}

export function bindMatchmakerEvents(handlers: {
  onMatched: (room: MatchedRoom) => void;
  onGraceTimeout: (roomId: string, missing: string[]) => void;
}): void {
  // Replace the placeholder by reaching into the instance's internal state.
  // Cast to any to mutate the private `events` field — kept narrow.
  const mm = getMatchmaker() as unknown as { events: typeof handlers };
  mm.events = handlers;
}

export function resetMatchmaker(): void {
  if (instance) instance.reset();
  instance = null;
}

export type { MatchedRoom } from './pairer.js';
export { MATCH_GRACE_MS } from './pairer.js';
