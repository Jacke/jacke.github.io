import { describe, it, expect } from 'vitest';
import { FifoQueue } from '../../src/matchmaker/queue.js';

interface P { name: string }

function entry(pubkey: string, name: string, t = Date.now()) {
  return { pubkey, payload: { name }, enqueuedAt: t };
}

describe('FifoQueue', () => {
  it('preserves FIFO order on enqueue + shift', () => {
    const q = new FifoQueue<P>();
    q.enqueue(entry('a', 'A'));
    q.enqueue(entry('b', 'B'));
    q.enqueue(entry('c', 'C'));
    const out = q.shift(2);
    expect(out.map(e => e.pubkey)).toEqual(['a', 'b']);
    expect(q.size).toBe(1);
    expect(q.toArray()[0]!.pubkey).toBe('c');
  });

  it('rejects duplicate pubkey enqueue', () => {
    const q = new FifoQueue<P>();
    expect(q.enqueue(entry('a', 'A'))).toBe(true);
    expect(q.enqueue(entry('a', 'B'))).toBe(false);
    expect(q.size).toBe(1);
  });

  it('cancels at head', () => {
    const q = new FifoQueue<P>();
    q.enqueue(entry('a', 'A'));
    q.enqueue(entry('b', 'B'));
    q.enqueue(entry('c', 'C'));
    expect(q.cancel('a')).toBe(true);
    expect(q.toArray().map(e => e.pubkey)).toEqual(['b', 'c']);
  });

  it('cancels in middle', () => {
    const q = new FifoQueue<P>();
    q.enqueue(entry('a', 'A'));
    q.enqueue(entry('b', 'B'));
    q.enqueue(entry('c', 'C'));
    expect(q.cancel('b')).toBe(true);
    expect(q.toArray().map(e => e.pubkey)).toEqual(['a', 'c']);
  });

  it('cancels at tail', () => {
    const q = new FifoQueue<P>();
    q.enqueue(entry('a', 'A'));
    q.enqueue(entry('b', 'B'));
    q.enqueue(entry('c', 'C'));
    expect(q.cancel('c')).toBe(true);
    expect(q.toArray().map(e => e.pubkey)).toEqual(['a', 'b']);
  });

  it('cancel of unknown pubkey returns false', () => {
    const q = new FifoQueue<P>();
    q.enqueue(entry('a', 'A'));
    expect(q.cancel('nope')).toBe(false);
    expect(q.size).toBe(1);
  });

  it('enqueueFront keeps seniority', () => {
    const q = new FifoQueue<P>();
    q.enqueue(entry('a', 'A'));
    q.enqueueFront(entry('z', 'Z'));
    expect(q.toArray().map(e => e.pubkey)).toEqual(['z', 'a']);
  });

  it('shift more than size drains all', () => {
    const q = new FifoQueue<P>();
    q.enqueue(entry('a', 'A'));
    q.enqueue(entry('b', 'B'));
    const out = q.shift(5);
    expect(out).toHaveLength(2);
    expect(q.size).toBe(0);
  });
});
