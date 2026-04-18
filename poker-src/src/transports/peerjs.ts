import { Peer, type DataConnection } from 'peerjs';
import { Emitter, type Transport, type TransportStatus } from '../protocol/transport.js';
import { type Message } from '../protocol/messages.js';
import { SigningSession } from '../protocol/crypto.js';

const PEER_CONFIG = {
  debug: 2,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ],
    iceCandidatePoolSize: 10,
  },
};

const HOST_ID_PREFIX = 'iamjacke-poker-';
const OPEN_TIMEOUT_MS = 15000;

export type Role = 'host' | 'guest';

export interface PeerJSOptions {
  roomId: string;
  role: Role;
  /** Called if the initial role fails (e.g., host id taken → fall back to guest). */
  onRoleChange?: (newRole: Role) => void;
}

/**
 * PeerJS-backed transport. Supports host / guest roles.
 *  - host: creates a Peer with a well-known ID (`iamjacke-poker-<room>`)
 *  - guest: creates an anonymous Peer and dials the host ID
 *
 * If a host discovers its ID is already in use, it falls back to guest mode
 * automatically (and notifies via onRoleChange).
 */
export class PeerJSTransport extends Emitter implements Transport {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private _status: TransportStatus = 'connecting';
  private openTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private role: Role;
  private readonly roomId: string;
  private readonly options: PeerJSOptions;
  private signing = new SigningSession();

  constructor(options: PeerJSOptions) {
    super();
    this.options = options;
    this.roomId = options.roomId;
    this.role = options.role;
    this.setStatus('connecting', this.role === 'host' ? 'Starting…' : 'Joining…');
    if (this.role === 'host') this.startHost();
    else this.startGuest();
  }

  private startHost(): void {
    const id = HOST_ID_PREFIX + this.roomId;
    const peer = new Peer(id, PEER_CONFIG);
    this.peer = peer;

    peer.on('open', (peerId) => {
      console.log('[poker] host peer open as', peerId);
      this.setStatus('connecting', 'Waiting for opponent…');
    });
    peer.on('connection', (c) => {
      console.log('[poker] host got incoming connection');
      this.conn = c;
      this.attachConn(c);
    });
    peer.on('error', (err: { type?: string; message?: string }) => {
      console.warn('[poker] host peer error:', err.type, err.message);
      if (err.type === 'unavailable-id') {
        // Room already exists — become a guest.
        try { peer.destroy(); } catch { /* ignore */ }
        this.peer = null;
        this.role = 'guest';
        this.options.onRoleChange?.('guest');
        this.startGuest();
      } else {
        this.fail(err.message ?? 'Peer error');
      }
    });
  }

  private startGuest(): void {
    // PeerJS generates a random ID when no id is passed. We use an empty
    // string (the documented way in PeerJS 1.5+) since the type disallows undefined.
    const peer = new Peer(PEER_CONFIG);
    this.peer = peer;

    peer.on('open', (peerId) => {
      console.log('[poker] guest peer open as', peerId);
      const hostId = HOST_ID_PREFIX + this.roomId;
      this.setStatus('connecting', 'Connecting to host…');
      const c = peer.connect(hostId, { reliable: true, serialization: 'json' });
      this.conn = c;
      this.attachConn(c);
    });
    peer.on('error', (err: { type?: string; message?: string }) => {
      console.warn('[poker] guest peer error:', err.type, err.message);
      if (err.type === 'peer-unavailable') {
        this.fail('Room not found. The host may have left or the code is wrong.');
      } else {
        this.fail(err.message ?? 'Peer error');
      }
    });
  }

  private attachConn(c: DataConnection): void {
    console.log('[poker] setupConn — already open?', c.open);
    c.on('open', () => {
      console.log('[poker] conn open event');
      this.handleOpen();
    });
    c.on('data', (data) => this.handleData(data));
    c.on('close', () => {
      console.log('[poker] conn closed');
      this.setStatus('closed');
      this.emit('close');
    });
    c.on('error', (e) => {
      console.error('[poker] conn error', e);
      this.emit('error', e);
    });

    // Diagnostics on the underlying RTCPeerConnection. PeerJS attaches this
    // asynchronously, so we poll briefly until it's available.
    let pcAttached = false;
    const attach = () => {
      if (pcAttached) return;
      const pc = c.peerConnection as RTCPeerConnection | undefined;
      if (!pc) return;
      pcAttached = true;
      console.log('[poker] PC ready — state:', pc.connectionState, '/ ICE:', pc.iceConnectionState);
      pc.addEventListener('iceconnectionstatechange', () => {
        console.log('[poker] ICE →', pc.iceConnectionState);
      });
      pc.addEventListener('connectionstatechange', () => {
        console.log('[poker] PC →', pc.connectionState);
        if (pc.connectionState === 'failed') {
          this.fail('WebRTC connection failed (firewall or NAT?)');
        }
      });
    };
    attach();
    let tries = 0;
    const iv = setInterval(() => {
      attach();
      tries++;
      if (pcAttached || tries >= 20) clearInterval(iv);
    }, 50);

    // Defensive: if the data channel was already open before the listener
    // was attached, fire open manually on next tick.
    if (c.open) setTimeout(() => this.handleOpen(), 0);

    // Hard timeout: if nothing opens within 15s, raise an error.
    this.openTimeoutTimer = setTimeout(() => {
      if (this._status !== 'open') {
        const pc = c.peerConnection as RTCPeerConnection | undefined;
        const diag = pc ? `ICE=${pc.iceConnectionState} PC=${pc.connectionState}` : 'no peerConnection';
        this.fail(`Connection timed out (${diag})`);
      }
    }, OPEN_TIMEOUT_MS);
  }

  private handleOpen(): void {
    if (this.closed) return;
    if (this._status === 'open') return; // idempotent
    if (this.openTimeoutTimer) { clearTimeout(this.openTimeoutTimer); this.openTimeoutTimer = null; }
    this.setStatus('open', 'Connected');
    this.emit('open');
  }

  private handleData(data: unknown): void {
    try {
      // PeerJS delivers objects directly with json serialization; strings in fallback.
      const raw: unknown = typeof data === 'string' ? JSON.parse(data) : data;
      const msg = this.signing.verifyAndUnwrap(raw);
      this.emit('message', msg);
    } catch (e) {
      console.warn('[poker] rejected message:', (e as Error).message);
    }
  }

  private fail(reason: string): void {
    this.setStatus('error', reason);
    this.emit('error', new Error(reason));
  }

  private setStatus(s: TransportStatus, label?: string): void {
    this._status = s;
    this.emit('status', s, label);
  }

  send(msg: Message): void {
    if (!this.conn || !this.conn.open) {
      throw new Error('PeerJS transport not open');
    }
    const envelope = this.signing.wrap(msg);
    this.conn.send(JSON.stringify(envelope));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.openTimeoutTimer) { clearTimeout(this.openTimeoutTimer); this.openTimeoutTimer = null; }
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conn = null;
    this.peer = null;
    this.setStatus('closed');
    this.emit('close');
  }

  status(): TransportStatus {
    return this._status;
  }

  getRole(): Role {
    return this.role;
  }
}
