/**
 * FIFO queue with O(1) cancel — doubly-linked list + reverse map.
 *
 * Why DLL instead of an array: cancel happens when a player disconnects
 * mid-queue, which is common. Splicing an array is O(n); a DLL with a
 * reverse pubkey→node map removes in O(1). Pairs are taken from the head
 * (oldest waiter first), so pure FIFO ordering is preserved.
 */

export interface QueueEntry<T> {
  pubkey: string;
  payload: T;
  enqueuedAt: number;
}

interface Node<T> {
  entry: QueueEntry<T>;
  prev: Node<T> | null;
  next: Node<T> | null;
}

export class FifoQueue<T> {
  private head: Node<T> | null = null;
  private tail: Node<T> | null = null;
  private byPubkey = new Map<string, Node<T>>();
  private _size = 0;

  get size(): number {
    return this._size;
  }

  /** Add to tail. If pubkey already present, no-op (returns false). */
  enqueue(entry: QueueEntry<T>): boolean {
    if (this.byPubkey.has(entry.pubkey)) return false;
    const node: Node<T> = { entry, prev: this.tail, next: null };
    if (this.tail) this.tail.next = node;
    else this.head = node;
    this.tail = node;
    this.byPubkey.set(entry.pubkey, node);
    this._size++;
    return true;
  }

  /** Add to head — used to re-enqueue a survivor after grace timeout. */
  enqueueFront(entry: QueueEntry<T>): boolean {
    if (this.byPubkey.has(entry.pubkey)) return false;
    const node: Node<T> = { entry, prev: null, next: this.head };
    if (this.head) this.head.prev = node;
    else this.tail = node;
    this.head = node;
    this.byPubkey.set(entry.pubkey, node);
    this._size++;
    return true;
  }

  /** Take N entries from the head. Returns fewer if the queue is shorter. */
  shift(n: number): QueueEntry<T>[] {
    const out: QueueEntry<T>[] = [];
    while (out.length < n && this.head) {
      const node = this.head;
      out.push(node.entry);
      this.byPubkey.delete(node.entry.pubkey);
      this.head = node.next;
      if (this.head) this.head.prev = null;
      else this.tail = null;
      this._size--;
    }
    return out;
  }

  /** O(1) removal by pubkey. */
  cancel(pubkey: string): boolean {
    const node = this.byPubkey.get(pubkey);
    if (!node) return false;
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    this.byPubkey.delete(pubkey);
    this._size--;
    return true;
  }

  has(pubkey: string): boolean {
    return this.byPubkey.has(pubkey);
  }

  /** Snapshot copy, head → tail order. For tests + telemetry. */
  toArray(): QueueEntry<T>[] {
    const out: QueueEntry<T>[] = [];
    let node = this.head;
    while (node) {
      out.push(node.entry);
      node = node.next;
    }
    return out;
  }

  clear(): void {
    this.head = null;
    this.tail = null;
    this.byPubkey.clear();
    this._size = 0;
  }
}
