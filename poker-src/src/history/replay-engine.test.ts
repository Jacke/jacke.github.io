import { describe, it, expect } from 'vitest';
import { buildTimeline, snapshotAt, totalFrames } from './replay-engine.js';
import type { Match, RecordedHand } from '../ui/match-recorder.js';
import { makeDeck, shuffle, mulberry32 } from '../core/cards.js';

function hu(button: number, actions: RecordedHand['actions'], result: RecordedHand['result']): RecordedHand {
  return {
    handNum: 1,
    button,
    deck: shuffle(makeDeck(), mulberry32(42)),
    actions,
    result,
  };
}

function twoHandMatch(): Match {
  return {
    mode: 'bot',
    numPlayers: 2,
    names: ['Stan', 'Bot1'],
    timestamp: 1_700_000_000_000,
    hands: [
      // Hand 1: SB raises, BB folds
      {
        handNum: 1,
        button: 0,
        deck: shuffle(makeDeck(), mulberry32(1)),
        actions: [
          { player: 0, kind: 'raise', amount: 60 },
          { player: 1, kind: 'fold' },
        ],
        result: { reason: 'fold', winners: [0] },
      },
      // Hand 2: BB raises, SB calls, check-check-check-check to showdown
      {
        handNum: 2,
        button: 1,
        deck: shuffle(makeDeck(), mulberry32(2)),
        actions: [
          { player: 0, kind: 'call' },
          { player: 1, kind: 'check' },
          // flop
          { player: 1, kind: 'check' },
          { player: 0, kind: 'check' },
          // turn
          { player: 1, kind: 'check' },
          { player: 0, kind: 'check' },
          // river
          { player: 1, kind: 'check' },
          { player: 0, kind: 'check' },
        ],
        result: { reason: 'showdown', winners: [0] },
      },
    ],
  };
}

describe('buildTimeline', () => {
  it('produces deal + one per action + end for each hand', () => {
    const t = buildTimeline(twoHandMatch());
    const expected = 1 + 2 + 1 + 1 + 8 + 1; // H1: deal+2+end. H2: deal+8+end
    expect(totalFrames(t)).toBe(expected);
  });

  it('action labels include player name and action', () => {
    const t = buildTimeline(twoHandMatch());
    const raiseFrame = t.frames.find(f => f.kind === 'action' && f.actionIdx === 0)!;
    expect(raiseFrame.label).toContain('Stan');
    expect(raiseFrame.label).toContain('raises');
    expect(raiseFrame.label).toContain('$60');
  });

  it('marks deal and end frames with kind', () => {
    const t = buildTimeline(twoHandMatch());
    expect(t.frames[0]!.kind).toBe('deal');
    expect(t.frames[t.frames.length - 1]!.kind).toBe('end');
  });
});

describe('snapshotAt', () => {
  it('frame 0 = initial deal with blinds posted', () => {
    const t = buildTimeline(twoHandMatch());
    const s = snapshotAt(t, 0);
    // HU: button is SB, both blinds posted.
    expect(s.handNum).toBe(1);
    expect(s.pot).toBeGreaterThanOrEqual(30); // SB 10 + BB 20
    expect(s.phase).toBe('preflop');
  });

  it('after SB raise in H1, pot reflects the raise', () => {
    const t = buildTimeline(twoHandMatch());
    const s = snapshotAt(t, 1); // deal + first action
    expect(s.pot).toBeGreaterThanOrEqual(60); // SB raised to 60 = +50 on top of SB post
  });

  it('end-of-hand frame in H1 credits the winner', () => {
    const t = buildTimeline(twoHandMatch());
    // Find the 'end' frame for hand 1.
    const endIdx = t.frames.findIndex((f, i) => f.kind === 'end' && f.handIdx === 0);
    const s = snapshotAt(t, endIdx);
    // Seat 0 (Stan) won the fold → chips above starting 1000.
    expect(s.chips[0]!).toBeGreaterThan(1000);
    expect(s.chips[1]!).toBeLessThan(1000);
  });

  it('scrubbing into H2 deal shows handNum=2', () => {
    const t = buildTimeline(twoHandMatch());
    const h2DealIdx = t.frames.findIndex(f => f.handIdx === 1 && f.kind === 'deal');
    const s = snapshotAt(t, h2DealIdx);
    expect(s.handNum).toBe(2);
  });

  it('clamps negative step index to frame 0', () => {
    const t = buildTimeline(twoHandMatch());
    const s = snapshotAt(t, -5);
    expect(s.phase).toBe('preflop');
  });

  it('clamps too-large step index to final frame', () => {
    const t = buildTimeline(twoHandMatch());
    const s = snapshotAt(t, 9999);
    // Final frame = end of H2 showdown
    expect(s.handNum).toBe(2);
  });

  it('repeated snapshotAt calls are idempotent (no shared mutable state)', () => {
    const t = buildTimeline(twoHandMatch());
    const a = snapshotAt(t, 3);
    const b = snapshotAt(t, 3);
    expect(a.pot).toBe(b.pot);
    expect(a.handNum).toBe(b.handNum);
  });

  it('scrubbing backward gives an earlier state', () => {
    const t = buildTimeline(twoHandMatch());
    const late = snapshotAt(t, 3);
    const early = snapshotAt(t, 1);
    expect(early.handNum).toBeLessThanOrEqual(late.handNum);
  });
});
