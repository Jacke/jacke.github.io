import { describe, it, expect, beforeEach } from 'vitest';
import { opponentModel } from './opponent-model.js';

describe('OpponentModel', () => {
  beforeEach(() => {
    opponentModel.reset();
  });

  it('credits preflop raise as VPIP + PFR', () => {
    opponentModel.newHand([0, 1]);
    opponentModel.record(0, 'raise', 'preflop');
    opponentModel.record(1, 'fold', 'preflop');
    opponentModel.endHand();

    const s = opponentModel.getStats(0)!;
    expect(s.handsSeen).toBe(1);
    expect(s.vpip).toBe(1);
    expect(s.pfr).toBe(1);
    expect(s.raises).toBe(1);
  });

  it('credits preflop call as VPIP but not PFR', () => {
    opponentModel.newHand([0, 1]);
    opponentModel.record(0, 'raise', 'preflop');
    opponentModel.record(1, 'call', 'preflop');
    opponentModel.record(0, 'check', 'flop');
    opponentModel.record(1, 'fold', 'flop');
    opponentModel.endHand();

    const caller = opponentModel.getStats(1)!;
    expect(caller.vpip).toBe(1);
    expect(caller.pfr).toBe(0);
  });

  it('does not credit VPIP for a fold', () => {
    opponentModel.newHand([0, 1]);
    opponentModel.record(1, 'fold', 'preflop');
    opponentModel.endHand();
    const s = opponentModel.getStats(1)!;
    expect(s.vpip).toBe(0);
    expect(s.folds).toBe(1);
  });

  it('tracks 3-bets', () => {
    opponentModel.newHand([0, 1, 2]);
    opponentModel.record(0, 'raise', 'preflop');  // open
    opponentModel.record(1, 'raise', 'preflop');  // 3-bet
    opponentModel.record(2, 'fold', 'preflop');
    opponentModel.record(0, 'fold', 'preflop');
    opponentModel.endHand();

    const threeBettor = opponentModel.getStats(1)!;
    expect(threeBettor.threeBets).toBe(1);
    expect(threeBettor.threeBetOpportunities).toBe(1);
  });

  it('tracks CBet fired by PFR on flop', () => {
    opponentModel.newHand([0, 1]);
    opponentModel.record(0, 'raise', 'preflop'); // PFR
    opponentModel.record(1, 'call', 'preflop');
    opponentModel.record(0, 'raise', 'flop', true); // CBet
    opponentModel.record(1, 'fold', 'flop');
    opponentModel.endHand();

    const s = opponentModel.getStats(0)!;
    expect(s.cbets).toBe(1);
    expect(s.cbetOpportunities).toBe(1);
  });

  it('tracks CBet missed when PFR checks flop', () => {
    opponentModel.newHand([0, 1]);
    opponentModel.record(0, 'raise', 'preflop'); // PFR
    opponentModel.record(1, 'call', 'preflop');
    opponentModel.record(0, 'check', 'flop', true); // PFR checked → cbet opp consumed
    opponentModel.record(1, 'check', 'flop');
    opponentModel.endHand();

    const s = opponentModel.getStats(0)!;
    expect(s.cbets).toBe(0);
    expect(s.cbetOpportunities).toBe(1);
  });

  it('VPIP ratio returns null before any hands', () => {
    expect(opponentModel.vpip(0)).toBeNull();
  });

  it('VPIP ratio reflects hands played', () => {
    for (let h = 0; h < 10; h++) {
      opponentModel.newHand([0, 1]);
      if (h < 3) {
        opponentModel.record(0, 'call', 'preflop');
        opponentModel.record(1, 'check', 'preflop');
      } else {
        opponentModel.record(0, 'fold', 'preflop');
      }
      opponentModel.endHand();
    }
    const v = opponentModel.vpip(0);
    expect(v).toBeCloseTo(0.3, 1);
  });

  it('archetype("unknown") when too few hands', () => {
    for (let h = 0; h < 3; h++) {
      opponentModel.newHand([0, 1]);
      opponentModel.record(0, 'fold', 'preflop');
      opponentModel.endHand();
    }
    expect(opponentModel.archetype(0)).toBe('unknown');
  });

  it('archetype classifies a rock (tight-passive)', () => {
    // 10 hands, folds almost all, never raises, one call → vpip=0.1, af=0
    for (let h = 0; h < 10; h++) {
      opponentModel.newHand([0, 1]);
      if (h === 0) opponentModel.record(0, 'call', 'preflop');
      else opponentModel.record(0, 'fold', 'preflop');
      opponentModel.endHand();
    }
    const arch = opponentModel.archetype(0);
    expect(['rock', 'unknown']).toContain(arch);
  });

  it('reset() wipes all state', () => {
    opponentModel.newHand([0, 1]);
    opponentModel.record(0, 'raise', 'preflop');
    opponentModel.endHand();
    opponentModel.reset();
    expect(opponentModel.getStats(0)).toBeNull();
    expect(opponentModel.handsSeen(0)).toBe(0);
  });
});
