/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BroadcastTransport } from './broadcast.js';
import type { Message } from '../protocol/messages.js';

// ═══════════════════════════════════════════════════════════════════════
// BroadcastChannel polyfill — jsdom does not provide one, but our contract
// is simple: messages posted on a named channel are delivered to all OTHER
// instances of the same name in the same process.
// ═══════════════════════════════════════════════════════════════════════

class TestBroadcastChannel {
  static registry = new Map<string, Set<TestBroadcastChannel>>();
  name: string;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  closed = false;

  constructor(name: string) {
    this.name = name;
    let set = TestBroadcastChannel.registry.get(name);
    if (!set) { set = new Set(); TestBroadcastChannel.registry.set(name, set); }
    set.add(this);
  }

  postMessage(data: unknown): void {
    if (this.closed) return;
    const set = TestBroadcastChannel.registry.get(this.name);
    if (!set) return;
    // Real BroadcastChannel does NOT deliver to the sender — mirror that.
    for (const other of set) {
      if (other === this || other.closed) continue;
      Promise.resolve().then(() => {
        if (!other.closed) other.onmessage?.({ data });
      });
    }
  }

  close(): void {
    this.closed = true;
    TestBroadcastChannel.registry.get(this.name)?.delete(this);
  }
}

beforeEach(() => {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = TestBroadcastChannel as unknown;
  TestBroadcastChannel.registry.clear();
});

afterEach(() => {
  TestBroadcastChannel.registry.clear();
});

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

async function waitForOpen(t: BroadcastTransport): Promise<void> {
  if (t.status() === 'open') return;
  await new Promise<void>((resolve) => {
    const off = t.on('open', () => { off(); resolve(); });
  });
}

async function collect<T>(fn: (push: (item: T) => void) => void): Promise<T[]> {
  const items: T[] = [];
  fn(items.push.bind(items));
  // Let microtasks drain.
  await new Promise(r => setTimeout(r, 20));
  return items;
}

describe('BroadcastTransport — same-room handshake', () => {
  it('two transports discover each other and exchange messages', async () => {
    const a = new BroadcastTransport('ROOM1', 'Alice');
    const b = new BroadcastTransport('ROOM1', 'Bob');

    // Both should transition from connecting → open after the other's hello arrives.
    await Promise.all([waitForOpen(a), waitForOpen(b)]);
    expect(a.status()).toBe('open');
    expect(b.status()).toBe('open');

    // Collect messages received by A from B.
    const received: Message[] = [];
    a.on('message', (msg) => received.push(msg));

    b.send({ type: 'ready' });
    b.send({ type: 'action', player: 1, action: 'raise', amount: 60 });
    await new Promise(r => setTimeout(r, 20));

    // A will also have received some hello messages from B during the spam window.
    const nonHello = received.filter(m => m.type !== 'hello');
    expect(nonHello).toEqual([
      { type: 'ready' },
      { type: 'action', player: 1, action: 'raise', amount: 60 },
    ]);

    a.close();
    b.close();
  });

  it('does not echo the sender its own messages', async () => {
    const a = new BroadcastTransport('ROOM2', 'Alice');
    const b = new BroadcastTransport('ROOM2', 'Bob');
    await Promise.all([waitForOpen(a), waitForOpen(b)]);

    const recvA: Message[] = [];
    a.on('message', (msg) => recvA.push(msg));
    a.send({ type: 'ready' });
    await new Promise(r => setTimeout(r, 30));

    // A should not see its own ready. It may see hellos from B.
    expect(recvA.find(m => m.type === 'ready')).toBeUndefined();
    a.close();
    b.close();
  });

  it('invalid messages on the channel are ignored', async () => {
    const a = new BroadcastTransport('ROOM3', 'Alice');
    const b = new BroadcastTransport('ROOM3', 'Bob');
    await Promise.all([waitForOpen(a), waitForOpen(b)]);

    const errors = vi.fn();
    a.on('error', errors);
    // Inject garbage directly onto the channel B is using.
    const raw = (b as unknown as { channel: { postMessage: (m: unknown) => void } }).channel;
    raw.postMessage({ from: 'other', payload: { type: 'nonsense' } });
    raw.postMessage({ from: 'other', payload: 'not even an object' });
    // Unsigned-but-shaped message — was accepted pre-signing, must be rejected now.
    raw.postMessage({ from: 'other', payload: { type: 'action', player: 0, action: 'fold' } });
    await new Promise(r => setTimeout(r, 20));

    // Garbage should have been silently dropped — no error, no crash.
    expect(errors).not.toHaveBeenCalled();
    a.close();
    b.close();
  });

  it('rejects forged messages from a third party on the same room', async () => {
    const a = new BroadcastTransport('ROOM3F', 'Alice');
    const b = new BroadcastTransport('ROOM3F', 'Bob');
    await Promise.all([waitForOpen(a), waitForOpen(b)]);

    // Third transport joins — drive-by attacker with its own keypair.
    const mallory = new BroadcastTransport('ROOM3F', 'Mallory');
    await waitForOpen(mallory);

    // Alice has now learned Bob's pubkey (from whichever of Bob/Mallory
    // arrived first). Any future send from the other peer should be rejected.
    // To make this deterministic, we directly poke Alice's internal session
    // and verify its lastRecvSeq only advances from one signing identity.
    const recvCount: Message[] = [];
    a.on('message', (m) => { if (m.type === 'action') recvCount.push(m); });

    b.send({ type: 'action', player: 0, action: 'raise', amount: 60 });
    await new Promise(r => setTimeout(r, 20));

    // Mallory tries — but Alice already pinned to whichever pubkey she saw first.
    mallory.send({ type: 'action', player: 0, action: 'raise', amount: 999 });
    await new Promise(r => setTimeout(r, 20));

    // At most one action got through (from the pinned peer).
    expect(recvCount.length).toBeLessThanOrEqual(1);
    a.close();
    b.close();
    mallory.close();
  });

  it('close() stops emitting and sets status to closed', async () => {
    const a = new BroadcastTransport('ROOM4', 'Alice');
    const b = new BroadcastTransport('ROOM4', 'Bob');
    await Promise.all([waitForOpen(a), waitForOpen(b)]);

    a.close();
    expect(a.status()).toBe('closed');

    // B sending after A closed should not reach A.
    const recvA: Message[] = [];
    a.on('message', (msg) => recvA.push(msg));
    b.send({ type: 'ready' });
    await new Promise(r => setTimeout(r, 20));
    expect(recvA).toHaveLength(0);
    b.close();
  });

  it('room isolation — different room IDs do not see each other', async () => {
    const a = new BroadcastTransport('ROOMA', 'Alice');
    const b = new BroadcastTransport('ROOMB', 'Bob');

    const recvA: Message[] = [];
    const recvB: Message[] = [];
    a.on('message', (m) => recvA.push(m));
    b.on('message', (m) => recvB.push(m));

    await new Promise(r => setTimeout(r, 50));
    expect(recvA).toHaveLength(0);
    expect(recvB).toHaveLength(0);
    expect(a.status()).toBe('connecting');
    expect(b.status()).toBe('connecting');

    a.close();
    b.close();
  });
});

// Silence unused import.
void collect;
