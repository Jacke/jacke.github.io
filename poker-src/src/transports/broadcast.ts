import { Emitter, type Transport, type TransportStatus } from '../protocol/transport.js';
import { type Message } from '../protocol/messages.js';
import { SigningSession } from '../protocol/crypto.js';

/**
 * BroadcastChannel transport — same-origin / same-browser only.
 *
 * Keyed by roomId. Every send is tagged with a per-instance senderId so
 * postMessage echoes are filtered out.
 *
 * Discovery protocol:
 *  - On construct, start spamming `hello` messages at a regular cadence
 *    (NO hard stop — the spam runs until the transport is closed). This
 *    fixes the "late tab" bug where the later tab never received hellos
 *    from a tab that had already stopped spamming.
 *  - On first incoming message, fire `open` and also immediately send one
 *    more hello (so the other side knows we exist even if they just joined
 *    and our spam hadn't reached them yet).
 */
export class BroadcastTransport extends Emitter implements Transport {
  private channel: BroadcastChannel | null;
  private senderId: string;
  private _status: TransportStatus = 'connecting';
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private localName: string;
  private helloCount = 0;
  private signing = new SigningSession();

  constructor(roomId: string, localName: string) {
    super();
    this.localName = localName;
    this.senderId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (typeof BroadcastChannel === 'undefined') {
      this.channel = null;
      this._status = 'error';
      console.warn('[poker][bc] BroadcastChannel not supported in this browser');
      setTimeout(() => this.emit('error', new Error('BroadcastChannel unsupported')), 0);
      return;
    }
    console.log('[poker][bc] channel open for room', roomId, 'as', this.senderId);
    this.channel = new BroadcastChannel(`iamjacke-poker-${roomId}`);
    this.channel.onmessage = (e) => this.handleIncoming(e.data);
    this.setStatus('connecting', 'Waiting for peer');
    this.startHelloSpam();
  }

  private handleIncoming(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    const wrapped = data as { from?: string; payload?: unknown };
    if (wrapped.from === this.senderId) return; // ignore echoes of our own send
    let msg: Message;
    try {
      msg = this.signing.verifyAndUnwrap(wrapped.payload);
    } catch (e) {
      console.warn('[poker][bc] rejected payload:', (e as Error).message, wrapped.payload);
      return;
    }

    // First incoming message = peer discovered → open.
    if (this._status === 'connecting') {
      console.log('[poker][bc] peer discovered, opening');
      this.setStatus('open', 'Connected');
      this.emit('open');
      // Echo a hello back immediately so the other side definitely sees us,
      // even if they just joined after our periodic spam.
      try {
        this.postRaw({ type: 'hello', name: this.localName });
      } catch { /* ignore */ }
    }
    this.emit('message', msg);
  }

  private postRaw(payload: Message): void {
    if (!this.channel) return;
    const envelope = this.signing.wrap(payload);
    this.channel.postMessage({ from: this.senderId, payload: envelope });
  }

  private startHelloSpam(): void {
    if (!this.channel) return;
    const sendOnce = () => {
      if (!this.channel) return;
      try {
        this.postRaw({ type: 'hello', name: this.localName });
        this.helloCount++;
        if (this.helloCount <= 3) {
          console.log('[poker][bc] sent hello #' + this.helloCount, 'as', this.localName);
        }
      } catch (e) {
        console.error('[poker][bc] postMessage error', e);
      }
    };
    sendOnce();
    // Indefinite cadence — cheap, fixes late-tab race. Stops on close().
    this.helloTimer = setInterval(sendOnce, 800);
  }

  private setStatus(s: TransportStatus, label?: string): void {
    this._status = s;
    this.emit('status', s, label);
  }

  send(msg: Message): void {
    if (!this.channel) throw new Error('BroadcastChannel not available');
    this.postRaw(msg);
  }

  close(): void {
    if (this.helloTimer) { clearInterval(this.helloTimer); this.helloTimer = null; }
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
