/**
 * Shared diff renderer for any row of playing cards — used by both the
 * poker table (src/ui/render.ts) and the blackjack table
 * (src/ui/blackjack-view.ts).
 *
 * The key guarantee: existing card DOM elements are preserved across
 * re-renders as long as their `dataset.cardStr` and `dataset.faceUp`
 * match the new target. This is what stops cards re-playing their
 * deal animation on every state change.
 *
 * New cards are created via `makeCardEl` with staggered `dealDelay` so
 * the CSS keyframe animation looks like a progressive deal. Callers can
 * specify a `dealOriginId` so the fly-from animation originates from a
 * different DOM element (e.g. blackjack's shoe instead of poker's deck).
 */

import type { Card } from '../core/types.js';
import { makeCardEl } from './cards-view.js';

export interface SyncCardRowOptions {
  /** Stagger between newly-appended cards, in milliseconds. */
  dealStepMs?: number;
  /** Number of `.card-placeholder` elements to keep after real cards. */
  placeholderCount?: number;
  /**
   * DOM id of the element cards should appear to fly FROM. Defaults to
   * `'deck-pile'` (poker's deck graphic). Blackjack passes `'bj-shoe'`.
   */
  dealOriginId?: string;
}

export function syncCardRow(
  container: HTMLElement,
  cards: readonly Card[] | null,
  faceUp: boolean,
  opts: SyncCardRowOptions = {},
): void {
  const desired = cards ?? [];
  const dealStepMs = opts.dealStepMs ?? 80;
  const placeholderCount = opts.placeholderCount ?? 0;
  const originId = opts.dealOriginId ?? 'deck-pile';

  // Wipe any placeholder slots first — they'll be re-added at the end.
  for (const ph of Array.from(container.querySelectorAll('.card-placeholder'))) {
    ph.remove();
  }

  const existing = Array.from(container.children) as HTMLElement[];

  // Prefix-match existing cards against the desired list. As soon as an
  // element mismatches, all subsequent ones are considered stale.
  let matched = 0;
  while (matched < existing.length && matched < desired.length) {
    const el = existing[matched]!;
    if (
      el.dataset['cardStr'] === desired[matched] &&
      el.dataset['faceUp'] === (faceUp ? '1' : '0')
    ) {
      matched++;
    } else {
      break;
    }
  }

  // Drop the stale tail (in reverse to avoid live-NodeList re-indexing).
  for (let i = existing.length - 1; i >= matched; i--) {
    existing[i]!.remove();
  }

  // Append the new cards with staggered deal animation.
  for (let i = matched; i < desired.length; i++) {
    container.appendChild(
      makeCardEl(desired[i]!, faceUp, (i - matched) * dealStepMs, container, originId),
    );
  }

  // Finally pad with placeholders if the caller wants a fixed-length row.
  for (let i = desired.length; i < placeholderCount; i++) {
    const ph = document.createElement('div');
    ph.className = 'card-placeholder';
    container.appendChild(ph);
  }
}
