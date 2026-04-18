import { describe, it, expect } from 'vitest';
import {
  canonicalHand,
  inOpenRange,
  isLatePosition,
  getPosition,
  OPEN_RANGES,
} from './nlhe-6max.js';

describe('canonicalHand', () => {
  it('encodes pairs without suit marker', () => {
    expect(canonicalHand('As', 'Ac')).toBe('AA');
    expect(canonicalHand('2d', '2h')).toBe('22');
  });

  it('encodes suited hands with s', () => {
    expect(canonicalHand('As', 'Ks')).toBe('AKs');
    expect(canonicalHand('Ks', 'As')).toBe('AKs');
    expect(canonicalHand('7h', '5h')).toBe('75s');
  });

  it('encodes offsuit hands with o', () => {
    expect(canonicalHand('As', 'Kd')).toBe('AKo');
    expect(canonicalHand('2c', '7d')).toBe('72o');
  });

  it('always orders high card first', () => {
    expect(canonicalHand('2s', 'As')).toBe('A2s');
    expect(canonicalHand('9d', 'Ts')).toBe('T9o');
  });
});

describe('OPEN_RANGES', () => {
  it('UTG opens AA', () => {
    expect(inOpenRange('AA', 'UTG')).toBe(true);
  });
  it('UTG does not open 72o', () => {
    expect(inOpenRange('72o', 'UTG')).toBe(false);
  });
  it('BTN opens much wider than UTG', () => {
    expect(OPEN_RANGES.BTN.size).toBeGreaterThan(OPEN_RANGES.UTG.size);
  });
  it('BB never opens', () => {
    expect(OPEN_RANGES.BB.size).toBe(0);
    expect(inOpenRange('AA', 'BB')).toBe(false);
  });
  it('CO opens KJs', () => {
    expect(inOpenRange('KJs', 'CO')).toBe(true);
  });
  it('opens are consistent: AKs in every non-BB position', () => {
    for (const pos of ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const) {
      expect(inOpenRange('AKs', pos)).toBe(true);
    }
  });
});

describe('isLatePosition', () => {
  it('returns true for CO/BTN/SB', () => {
    expect(isLatePosition('CO')).toBe(true);
    expect(isLatePosition('BTN')).toBe(true);
    expect(isLatePosition('SB')).toBe(true);
  });
  it('returns false for UTG/MP/BB', () => {
    expect(isLatePosition('UTG')).toBe(false);
    expect(isLatePosition('MP')).toBe(false);
    expect(isLatePosition('BB')).toBe(false);
  });
});

describe('getPosition', () => {
  it('heads-up: button = SB, other = BB', () => {
    expect(getPosition({ buttonIndex: 0, numPlayers: 2 }, 0)).toBe('SB');
    expect(getPosition({ buttonIndex: 0, numPlayers: 2 }, 1)).toBe('BB');
  });
  it('3-max: BTN, SB, BB around the circle', () => {
    const st = { buttonIndex: 0, numPlayers: 3 };
    expect(getPosition(st, 0)).toBe('BTN');
    expect(getPosition(st, 1)).toBe('SB');
    expect(getPosition(st, 2)).toBe('BB');
  });
  it('6-max: BTN, SB, BB, UTG, MP, CO', () => {
    const st = { buttonIndex: 0, numPlayers: 6 };
    expect(getPosition(st, 0)).toBe('BTN');
    expect(getPosition(st, 1)).toBe('SB');
    expect(getPosition(st, 2)).toBe('BB');
    expect(getPosition(st, 3)).toBe('UTG');
    expect(getPosition(st, 4)).toBe('MP');
    expect(getPosition(st, 5)).toBe('CO');
  });
  it('6-max with button at seat 3', () => {
    const st = { buttonIndex: 3, numPlayers: 6 };
    expect(getPosition(st, 3)).toBe('BTN');
    expect(getPosition(st, 4)).toBe('SB');
    expect(getPosition(st, 5)).toBe('BB');
    expect(getPosition(st, 0)).toBe('UTG');
  });
});
