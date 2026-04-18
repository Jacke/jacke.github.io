import { describe, it, expect } from 'vitest';
import { handToHHF, matchToHHF } from './hhf.js';
import type { Match, RecordedHand } from '../ui/match-recorder.js';
import { makeDeck, shuffle, mulberry32 } from '../core/cards.js';

function fakeMatch(): Match {
  const deck = shuffle(makeDeck(), mulberry32(42));
  const hand: RecordedHand = {
    handNum: 1,
    button: 0,
    deck,
    actions: [
      // HU — button is SB (acts first preflop), BB checks
      { player: 0, kind: 'raise', amount: 60 }, // SB opens to 60
      { player: 1, kind: 'call' },              // BB calls
      // Flop — BB first
      { player: 1, kind: 'check' },
      { player: 0, kind: 'raise', amount: 80 }, // SB cbets
      { player: 1, kind: 'call' },
      // Turn
      { player: 1, kind: 'check' },
      { player: 0, kind: 'check' },
      // River
      { player: 1, kind: 'check' },
      { player: 0, kind: 'raise', amount: 120 }, // SB value
      { player: 1, kind: 'fold' },
    ],
    result: { reason: 'fold', winners: [0] },
  };
  return {
    mode: 'bot',
    numPlayers: 2,
    names: ['Stan', 'Bot 1'],
    timestamp: 1_700_000_000_000,
    hands: [hand],
  };
}

describe('HHF exporter', () => {
  it('emits a PokerStars-style header', () => {
    const text = handToHHF(fakeMatch(), fakeMatch().hands[0]!, 1);
    expect(text).toContain("PokerStars Hand #1:");
    expect(text).toContain("Hold'em No Limit");
    expect(text).toContain('$10/$20 USD');
  });

  it('emits seat + button line', () => {
    const text = handToHHF(fakeMatch(), fakeMatch().hands[0]!, 1);
    expect(text).toMatch(/Table '.*' 2-max Seat #1 is the button/);
    expect(text).toContain('Seat 1: Stan ($1000 in chips)');
    expect(text).toContain('Seat 2: Bot 1 ($1000 in chips)');
  });

  it('emits blinds posted in correct order', () => {
    const text = handToHHF(fakeMatch(), fakeMatch().hands[0]!, 1);
    expect(text).toContain('Stan: posts small blind $10');
    expect(text).toContain('Bot 1: posts big blind $20');
  });

  it('emits *** HOLE CARDS *** section with dealt lines', () => {
    const text = handToHHF(fakeMatch(), fakeMatch().hands[0]!, 1);
    expect(text).toContain('*** HOLE CARDS ***');
    expect(text).toMatch(/Dealt to Stan \[\w\w \w\w\]/);
  });

  it('emits *** FLOP ***, *** TURN ***, *** RIVER *** as streets cross', () => {
    const text = handToHHF(fakeMatch(), fakeMatch().hands[0]!, 1);
    expect(text).toContain('*** FLOP ***');
    expect(text).toContain('*** TURN ***');
    expect(text).toContain('*** RIVER ***');
  });

  it('emits raises with correct delta + total', () => {
    const text = handToHHF(fakeMatch(), fakeMatch().hands[0]!, 1);
    // First raise: SB had $10 posted, raises to $60 = +$50 extra
    expect(text).toContain('Stan: raises $50 to $60');
  });

  it('emits collected + summary section', () => {
    const text = handToHHF(fakeMatch(), fakeMatch().hands[0]!, 1);
    expect(text).toContain('Stan collected $');
    expect(text).toContain('*** SUMMARY ***');
    expect(text).toContain('Total pot $');
    expect(text).toContain('Bot 1 (big blind) folded on the River');
  });

  it('matchToHHF concatenates multiple hands with separator', () => {
    const m = fakeMatch();
    // Dupe the hand so we have two
    m.hands.push(m.hands[0]!);
    const text = matchToHHF(m);
    const count = (text.match(/PokerStars Hand #/g) ?? []).length;
    expect(count).toBe(2);
  });
});
