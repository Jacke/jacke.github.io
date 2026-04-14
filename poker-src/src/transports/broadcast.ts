import { Emitter, type Transport, type TransportStatus } from '../protocol/transport.js';
import { type Message, isMessage } from '../protocol/messages.js';

/**
 * BroadcastChannel transport — same-origin / same-browser only.
 *
 * Uses a dedicated channel keyed by room ID. Messages are broadcast to all
 * listeners on the channel, including potentially the sender — we filter our
 * own messages by tagging each with a locally-unique sender ID.
 *
 * Semantics to mirror what the inline JS does:
 *  - Peer discovery: on open, spam `hello` messages for a short window so a
 *    late-joining tab will hear us immediately.
 *  - `open` fires the first time we RECEIVE a hello from another tab.
 */
export class BroadcastTransport extends Emitter implements Transport {
  private channel: BroadcastChannel | null;
  private senderId: string;
  private _status: TransportStatus = 'connecting';
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private helloStop: ReturnType<typeof setTimeout> | null = null;
  private localName: string;

  constructor(roomId: string, localName: string) {
    super();
    this.localName = localName;
    this.senderId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (typeof BroadcastChannel === 'undefined') {
      this.channel = null;
      this._status = 'error';
      setTimeout(() => this.emit('error', new Error('BroadcastChannel unsupported')), 0);
      return;
    }
    this.channel = new BroadcastChannel(`iamjacke-poker-${roomId}`);
    this.channel.onmessage = (e) => this.handleIncoming(e.data);
    this.setStatus('connecting', 'Waiting for peer');
    this.startHelloSpam();
  }

  private handleIncoming(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    const wrapped = data as { from?: string; payload?: unknown };
    if (wrapped.from === this.senderId) return; // ignore echoes of our own send
    if (!isMessage(wrapped.payload)) return;
    const msg = wrapped.payload;

    // First incoming message = peer discovered → open.
    if (this._status === 'connecting') {
      this.setStatus('open', 'Connected');
      this.emit('open');
    }
    this.emit('message', msg);
  }

  private startHelloSpam(): void {
    if (!this.channel) return;
    let count = 0;
    const send = () => {
      if (!this.channel) return;
      try {
        this.channel.postMessage({
          from: this.senderId,
          payload: { type: 'hello', name: this.localName },
        });
        count++;
      } catch {
        /* swallow */
      }
    };
    send();
    this.helloTimer = setInterval(send, 250);
    // Stop after ~3 seconds — by then either the peer has joined or they'll
    // re-announce when they themselves open.
    this.helloStop = setTimeout(() => {
      if (this.helloTimer) { clearInterval(this.helloTimer); this.helloTimer = null; }
      // Stop spamming but don't error out — peer may still connect later.
      void count;
    }, 3000);
  }

  private setStatus(s: TransportStatus, label?: string): void {
    this._status = s;
    this.emit('status', s, label);
  }

  send(msg: Message): void {
    if (!this.channel) throw new Error('BroadcastChannel not available');
    this.channel.postMessage({ from: this.senderId, payload: msg });
  }

  close(): void {
    if (this.helloTimer) { clearInterval(this.helloTimer); this.helloTimer = null; }
    if (this.helloStop) { clearTimeout(this.helloStop); this.helloStop = null; }
    if (this.channel) {
      try { this.channel.close(); } catch { /* ignore */ }
      this.channel = null;
    }
    this.setStatus('closed');
    this.emit('close');
  }

  status(): TransportStatus {
    return this._status;
  }
}
