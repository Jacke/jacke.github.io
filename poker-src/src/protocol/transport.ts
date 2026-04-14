import type { Message } from './messages.js';

export type TransportStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface TransportEvents {
  open: () => void;
  close: (reason?: string) => void;
  error: (err: unknown) => void;
  message: (msg: Message) => void;
  status: (status: TransportStatus, label?: string) => void;
}

/**
 * Minimal transport interface the app uses to talk to the remote peer.
 * Implementations: BroadcastChannel (same-browser), PeerJS WebRTC (remote).
 */
export interface Transport {
  /** Send a message to the other side. May throw or no-op if not yet open. */
  send(msg: Message): void;
  /** Close the transport and release resources. */
  close(): void;
  /** Current status, mainly for UI. */
  status(): TransportStatus;
  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): () => void;
}

/** Simple typed EventEmitter used inside transport implementations. */
export class Emitter implements Pick<Transport, 'on'> {
  private handlers: Map<keyof TransportEvents, Set<(...args: unknown[]) => void>> = new Map();

  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): () => void {
    let set = this.handlers.get(event);
    if (!set) { set = new Set(); this.handlers.set(event, set); }
    const wrapped = handler as unknown as (...args: unknown[]) => void;
    set.add(wrapped);
    return () => set!.delete(wrapped);
  }

  emit<K extends keyof TransportEvents>(
    event: K,
    ...args: Parameters<TransportEvents[K]>
  ): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) {
      try { h(...args); }
      catch (e) { console.error('[transport] handler threw', e); }
    }
  }
}
