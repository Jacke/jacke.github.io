import { describe, it, expect } from 'vitest';
import { csvEscape, matchHistoryToCsv, lifetimeSummaryToCsv } from './stats-export.js';
import type { MatchRecord } from './bank.js';

const sampleHistory: MatchRecord[] = [
  {
    timestamp: 1_700_000_000_000,
    numPlayers: 2,
    difficulty: 'medium',
    startChips: 1000,
    endChips: 1450,
    delta: 450,
    won: true,
    hands: 24,
  },
  {
    timestamp: 1_700_000_100_000,
    numPlayers: 6,
    difficulty: 'hard',
    startChips: 1000,
    endChips: 0,
    delta: -1000,
    won: false,
    hands: 41,
  },
  {
    timestamp: 1_700_000_200_000,
    numPlayers: 2,
    difficulty: 'hard',
    startChips: 1000,
    endChips: 1800,
    delta: 800,
    won: true,
    hands: 33,
  },
];

describe('csvEscape', () => {
  it('passes plain strings through', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape(true)).toBe('true');
  });

  it('quotes values with commas', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  it('doubles internal quotes', () => {
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('quotes newlines', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('matchHistoryToCsv', () => {
  it('emits a header row', () => {
    const csv = matchHistoryToCsv(sampleHistory);
    const first = csv.split('\r\n')[0]!;
    expect(first).toContain('timestamp');
    expect(first).toContain('difficulty');
    expect(first).toContain('won');
  });

  it('emits one row per match', () => {
    const csv = matchHistoryToCsv(sampleHistory);
    const rows = csv.trim().split('\r\n');
    expect(rows).toHaveLength(1 + sampleHistory.length);
  });

  it('includes ISO date column', () => {
    const csv = matchHistoryToCsv(sampleHistory);
    expect(csv).toMatch(/2023-1[10]-/); // timestamps above resolve to Nov 2023
  });

  it('emits won as 0/1', () => {
    const csv = matchHistoryToCsv(sampleHistory);
    // Last value in each row is the won flag.
    const rows = csv.trim().split('\r\n').slice(1);
    expect(rows[0]!.endsWith(',1')).toBe(true);
    expect(rows[1]!.endsWith(',0')).toBe(true);
  });

  it('handles empty history', () => {
    const csv = matchHistoryToCsv([]);
    const rows = csv.trim().split('\r\n');
    expect(rows).toHaveLength(1); // just the header
  });
});

describe('lifetimeSummaryToCsv', () => {
  it('computes total_delta as sum of match deltas', () => {
    const csv = lifetimeSummaryToCsv(sampleHistory);
    expect(csv).toMatch(/total_delta,250/); // 450 - 1000 + 800 = 250
  });

  it('computes win_rate as wins / matches', () => {
    const csv = lifetimeSummaryToCsv(sampleHistory);
    expect(csv).toMatch(/win_rate,0\.666[67]/); // 2/3
  });

  it('breaks stats out by difficulty', () => {
    const csv = lifetimeSummaryToCsv(sampleHistory);
    expect(csv).toMatch(/matches_medium,1/);
    expect(csv).toMatch(/matches_hard,2/);
  });

  it('is empty-history-safe', () => {
    const csv = lifetimeSummaryToCsv([]);
    expect(csv).toMatch(/total_matches,0/);
    expect(csv).toMatch(/win_rate,0/);
  });
});
