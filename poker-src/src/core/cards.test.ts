import { describe, it, expect } from 'vitest';
import {
  makeDeck, shuffle, mulberry32, rankOf, suitOf, rankChar, suitChar, genRoomId,
} from './cards.js';

describe('makeDeck', () => {
  it('returns 52 cards', () => {
    expect(makeDeck()).toHaveLength(52);
  });

  it('returns 52 unique cards', () => {
    const deck = makeDeck();
    expect(new Set(deck).size).toBe(52);
  });

  it('contains 13 of each suit', () => {
    const deck = makeDeck();
    for (const s of ['s', 'h', 'd', 'c']) {
      expect(deck.filter(c => c[1] === s)).toHaveLength(13);
    }
  });
});

describe('shuffle', () => {
  it('returns the same set of cards', () => {
    const deck = makeDeck();
    const shuffled = shuffle(deck, mulberry32(42));
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled)).toEqual(new Set(deck));
  });

  it('does not mutate the input', () => {
    const deck = makeDeck();
    const copy = deck.slice();
    shuffle(deck, mulberry32(1));
    expect(deck).toEqual(copy);
  });

  it('is deterministic when given a seeded RNG', () => {
    const a = shuffle(makeDeck(), mulberry32(12345));
    const b = shuffle(makeDeck(), mulberry32(12345));
    expect(a).toEqual(b);
  });

  it('produces a different order with a different seed', () => {
    const a = shuffle(makeDeck(), mulberry32(1));
    const b = shuffle(makeDeck(), mulberry32(2));
    expect(a).not.toEqual(b);
  });
});

describe('card parsers', () => {
  it('extracts rank and suit chars', () => {
    expect(rankChar('Ah')).toBe('A');
    expect(suitChar('Ah')).toBe('h');
    expect(rankChar('Ts')).toBe('T');
    expect(suitChar('2c')).toBe('c');
  });

  it('maps rank to numeric value with A=14', () => {
    expect(rankOf('2s')).toBe(2);
    expect(rankOf('Th')).toBe(10);
    expect(rankOf('Jd')).toBe(11);
    expect(rankOf('Ac')).toBe(14);
    expect(suitOf('Ac')).toBe('c');
  });
});

describe('genRoomId', () => {
  it('is 6 chars long', () => {
    expect(genRoomId(mulberry32(1))).toHaveLength(6);
  });

  it('is deterministic with a seeded RNG', () => {
    expect(genRoomId(mulberry32(7))).toBe(genRoomId(mulberry32(7)));
  });
});
