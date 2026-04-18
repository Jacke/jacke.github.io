/**
 * Replay engine — deterministic reconstruction of a match at any step.
 *
 * A `Match` is a flat sequence of "steps":
 *   step 0   = initial state, hand 0 dealt
 *   step 1   = after hand 0 action 0
 *   step 2   = after hand 0 action 1
 *   ...
 *   step k   = after hand 0 complete (rolls into hand 1 deal)
 *   ...
 *
 * Callers build a Timeline once via `buildTimeline(match)`, then ask for
 * any snapshot by step index with `snapshotAt(timeline, step)`. The
 * reconstruction is pure: it replays hands from the start every time,
 * which is fast enough (<1 ms/step at typical match lengths) and avoids
 * any caching pitfalls.
 */

import type { GameState } from '../core/types.js';
import { applyAction, createGameState, dealHand, finishToShowdown, nextStreet } from '../core/engine.js';
import { startNextHand } from '../core/engine.js';
import type { Match, RecordedHand, RecordedAction } from '../ui/match-recorder.js';

/**
 * Flattened timeline of every "frame" in a match:
 *  - 'deal'   — the hand-start frame, state fully set up but no actions yet
 *  - 'action' — immediately after applying `hand.actions[actionIdx]`
 *  - 'end'    — final frame of the hand, showdown settled
 */
export interface TimelineFrame {
  handIdx: number;
  handNum: number;
  /** 'deal' | 'action' | 'end'. */
  kind: 'deal' | 'action' | 'end';
  /** For 'action' frames, the index within hand.actions. */
  actionIdx: number | null;
  /** Label shown in the seek bar ("H3 · #5: Bot2 raises $60"). */
  label: string;
}

export interface Timeline {
  match: Match;
  frames: TimelineFrame[];
}

/** Build the frame list for a match — one 'deal', N 'action', one 'end' per hand. */
export function buildTimeline(match: Match): Timeline {
  const frames: TimelineFrame[] = [];
  match.hands.forEach((hand, hi) => {
    frames.push({
      handIdx: hi,
      handNum: hand.handNum,
      kind: 'deal',
      actionIdx: null,
      label: `H${hand.handNum} · deal`,
    });
    hand.actions.forEach((a, ai) => {
      frames.push({
        handIdx: hi,
        handNum: hand.handNum,
        kind: 'action',
        actionIdx: ai,
        label: `H${hand.handNum} · ${labelAction(match, a, ai + 1)}`,
      });
    });
    frames.push({
      handIdx: hi,
      handNum: hand.handNum,
      kind: 'end',
      actionIdx: null,
      label: `H${hand.handNum} · result`,
    });
  });
  return { match, frames };
}

function labelAction(match: Match, a: RecordedAction, n: number): string {
  const name = match.names[a.player] ?? `P${a.player + 1}`;
  switch (a.kind) {
    case 'fold':  return `#${n}: ${name} folds`;
    case 'check': return `#${n}: ${name} checks`;
    case 'call':  return `#${n}: ${name} calls`;
    case 'raise': return `#${n}: ${name} raises${a.amount !== undefined ? ` $${a.amount}` : ''}`;
    case 'discard': return `#${n}: ${name} discards`;
  }
}

/**
 * Reconstruct the game state at `frameIdx` by replaying every frame from
 * the start of the match up to and including it. Returns a fresh
 * `GameState` — callers don't share a mutable state across calls.
 */
export function snapshotAt(timeline: Timeline, frameIdx: number): GameState {
  const { match, frames } = timeline;
  const clamped = Math.max(0, Math.min(frameIdx, frames.length - 1));
  const state = createGameState(match.numPlayers, 0, match.names);

  let lastHandIdxApplied = -1;

  for (let f = 0; f <= clamped; f++) {
    const frame = frames[f]!;
    const hand = match.hands[frame.handIdx]!;

    if (frame.kind === 'deal') {
      if (lastHandIdxApplied !== -1 && lastHandIdxApplied !== frame.handIdx) {
        // Previous hand wrapped up — start the next.
        try { startNextHand(state); } catch { /* ignore */ }
      }
      state.buttonIndex = hand.button;
      try { dealHand(state, hand.deck); } catch { /* ignore */ }
      lastHandIdxApplied = frame.handIdx;
      continue;
    }

    if (frame.kind === 'action') {
      const rec = hand.actions[frame.actionIdx!]!;
      const action = rec.kind === 'raise'
        ? { kind: 'raise' as const, amount: rec.amount ?? 0 }
        : rec.kind === 'discard'
          ? { kind: 'discard' as const, discardIndices: [] }
          : { kind: rec.kind };
      try {
        const res = applyAction(state, rec.player, action);
        if (res.roundClosed && !res.handEnded) {
          const noMore = aliveActorCount(state) <= 1;
          if (noMore) {
            finishToShowdown(state);
          } else {
            nextStreet(state);
          }
        }
      } catch { /* ignore malformed frame — replay is best-effort */ }
      continue;
    }

    if (frame.kind === 'end') {
      if (state.phase !== 'showdown' && state.phase !== 'idle') {
        try { finishToShowdown(state); } catch { /* ignore */ }
      }
      continue;
    }
  }
  return state;
}

function aliveActorCount(state: GameState): number {
  let n = 0;
  for (let i = 0; i < state.numPlayers; i++) {
    if (!state.folded[i] && !state.allIn[i]) n++;
  }
  return n;
}

/** Total frame count — useful for scrub-bar max. */
export function totalFrames(timeline: Timeline): number {
  return timeline.frames.length;
}
