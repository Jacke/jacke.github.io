/**
 * WebSocketTransport — speaks the iamjacke-poker-server control protocol.
 *
 * Unlike BroadcastChannel and PeerJS, this transport has an explicit
 * matchmaking handshake before the game transport is "open":
 *
 *   1. ws.open → server sends `welcome { nonce }`.
 *   2. Client signs the nonce with its persistent Ed25519 key and sends
 *      `auth { pubkey, nonce, sig, name }`.
 *   3. Server replies `authed { pubkey, displayName, resumableRoomId }`.
 *   4. Client sends `matchmake { game, seats }` (or `join-room` to
 *      resume an existing room).
 *   5. Server pairs two clients → each receives `matched { roomId, seat, opponents }`.
 *   6. Both send `join-room { roomId }` → each receives `joined`.
 *   7. From this point game frames use the same `SignedEnvelope` shape
 *      the P2P transports use, wrapped in `{ kind: 'game', roomId, env }`.
 *
 * Transport events:
 *   - `status('connecting', 'Finding an opponent…')` while queued
 *   - `open` on `joined` (replay catch-up flushes before `open` fires
 *     so the UI sees historical messages as normal inbound frames)
 *   - `message` for every inbound game payload (live OR replayed)
 *   - `close` on socket close or explicit `close()`
 */

import { Emitter, type Transport, type TransportStatus } from '../protocol/transport.js';
import { type Message, isMessage } from '../protocol/messages.js';
import { SigningSession, bytesToHex } from '../protocol/crypto.js';
import { loadIdentity } from '../identity.js';
import { clientConfig } from '../config.js';
import * as ed from '@noble/ed25519';

export type GameKind = 'poker' | 'blackjack';

export interface WebSocketTransportOptions {
  game: GameKind;
  seats: 2 | 3 | 6;
  displayName: string;
  /** Override the default URL; mainly for tests. */
  url?: string;
  /** If set, attempts to rejoin this room instead of entering the queue. */
  resumeRoomId?: string;
  /** If set, client-side last-seen watermark so the server only streams
   *  messages this client hasn't persisted locally yet. */
  lastChatId?: number;
  lastHandId?: number;
  /** Fires when the server advertises a resumable room during the auth
   *  handshake but BEFORE the client decides to enter matchmaking. The UI
   *  can use this to prompt "resume previous match?". */
  onResumable?: (roomId: string) => void;
  /** Fires once during the auth phase with the confirmed pubkey +
   *  display name. */
  onAuthed?: (info: { pubkey: string; displayName: string }) => void;
  /** Called once matchmaking has placed the player in a room. */
  onMatched?: (info: { roomId: string; seat: number; opponents: Array<{ pubkey: string; displayName: string; seat: number }> }) => void;
}

type WsFrame =
  | { kind: 'ctrl'; msg: any }
  | { kind: 'game'; roomId: string; env: unknown };

export class WebSocketTransport extends Emitter implements Transport {
  private ws: WebSocket | null = null;
  private _status: TransportStatus = 'connecting';
  private roomId: string | null = null;
  private signing: SigningSession;
  private opts: WebSocketTransportOptions;
  private authed = false;
  private inReplay = false;
  private closed = false;

  constructor(opts: WebSocketTransportOptions) {
    super();
    this.opts = opts;
    // Server-side verification uses the same pubkey for both ctrl `auth`
    // AND every signed game envelope, so we MUST reuse the persistent
    // identity here — `new SigningSession()` would generate a throwaway.
    this.signing = new SigningSession(loadIdentity());
    this.connect(opts.url ?? clientConfig.serverUrl);
  }

  private connect(url: string): void {
    this.setStatus('connecting', 'Connecting to server…');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.fail((err as Error).message || 'Failed to open WebSocket');
      return;
    }
    this.ws = ws;

    ws.addEventListener('message', (ev) => this.onRaw(ev.data));
    ws.addEventListener('error', (ev) => {
      console.warn('[poker][ws] error', ev);
      this.emit('error', new Error('WebSocket error'));
    });
    ws.addEventListener('close', () => {
      if (this.closed) return;
      this.setStatus('closed');
      this.emit('close');
    });
    // ws.open is implicit — the server sends `welcome` immediately, and
    // we drive the auth handshake from the message handler. No need to
    // wait for the open event here.
  }

  private async onRaw(raw: unknown): Promise<void> {
    let text: string;
    if (typeof raw === 'string') text = raw;
    else if (raw instanceof ArrayBuffer) text = new TextDecoder().decode(raw);
    else text = String(raw);

    let frame: WsFrame;
    try { frame = JSON.parse(text); }
    catch { console.warn('[poker][ws] bad json'); return; }

    if (frame.kind === 'ctrl') {
      await this.handleCtrl(frame.msg);
      return;
    }
    if (frame.kind === 'game') {
      this.handleGame(frame);
      return;
    }
  }

  private async handleCtrl(msg: any): Promise<void> {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'welcome': {
        // Sign the nonce with our persistent identity and send auth.
        const sk = this.signing.local.secretKey;
        const pk = this.signing.local.publicKey;
        const sig = ed.sign(new TextEncoder().encode(msg.nonce), sk);
        this.sendCtrl({
          type: 'auth',
          pubkey: bytesToHex(pk),
          nonce: msg.nonce,
          sig: bytesToHex(sig),
          name: this.opts.displayName,
        });
        return;
      }

      case 'authed': {
        this.authed = true;
        this.opts.onAuthed?.({ pubkey: msg.pubkey, displayName: msg.displayName });
        if (msg.resumableRoomId) {
          this.opts.onResumable?.(msg.resumableRoomId);
        }
        if (this.opts.resumeRoomId) {
          this.sendCtrl({
            type: 'join-room',
            roomId: this.opts.resumeRoomId,
            lastChatId: this.opts.lastChatId ?? 0,
            lastHandId: this.opts.lastHandId ?? 0,
          });
          return;
        }
        this.setStatus('connecting', 'Finding an opponent…');
        this.sendCtrl({ type: 'matchmake', game: this.opts.game, seats: this.opts.seats });
        return;
      }

      case 'queued':
        this.setStatus('connecting', `In queue (position ${msg.position})`);
        return;

      case 'matched': {
        this.roomId = msg.roomId;
        this.opts.onMatched?.({
          roomId: msg.roomId,
          seat: msg.seat,
          opponents: msg.opponents ?? [],
        });
        this.setStatus('connecting', 'Joining room…');
        this.sendCtrl({
          type: 'join-room',
          roomId: msg.roomId,
          lastChatId: this.opts.lastChatId ?? 0,
          lastHandId: this.opts.lastHandId ?? 0,
        });
        return;
      }

      case 'joined':
        if (!this.roomId) this.roomId = msg.roomId;
        this.setStatus('open', 'Connected');
        this.emit('open');
        return;

      case 'replay-start':
        this.inReplay = true;
        return;

      case 'replay-chat': {
        if (!this.inReplay) return;
        const payload: Message = {
          type: 'chat',
          from: msg.pubkey.slice(0, 8),
          text: msg.text,
          ts: msg.ts,
        };
        this.emit('message', payload);
        return;
      }

      case 'replay-hand': {
        if (!this.inReplay) return;
        // Replayed payloads have already been validated on the way in
        // (they were persisted via persistRelayed). Treat invalid shapes
        // as a bug on our side and skip.
        if (isMessage(msg.payload)) {
          this.emit('message', msg.payload as Message);
        } else {
          console.warn('[poker][ws] replay-hand with invalid payload', msg.payload);
        }
        return;
      }

      case 'replay-end':
        this.inReplay = false;
        return;

      case 'left':
        // Opponent dropped — surface as an error so the UI can fall back
        // to the "waiting for reconnect" state.
        this.emit('error', new Error(`peer ${msg.pubkey.slice(0, 8)} left`));
        return;

      case 'error':
        this.fail(`${msg.code}${msg.detail ? `: ${msg.detail}` : ''}`);
        return;

      case 'pong':
        return;

      default:
        console.warn('[poker][ws] unknown ctrl', msg.type);
    }
  }

  private handleGame(frame: { roomId: string; env: unknown }): void {
    if (frame.roomId !== this.roomId) return;
    try {
      const msg = this.signing.verifyAndUnwrap(frame.env);
      this.emit('message', msg);
    } catch (err) {
      console.warn('[poker][ws] rejected game frame:', (err as Error).message);
    }
  }

  private sendCtrl(msg: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ kind: 'ctrl', msg }));
  }

  private fail(reason: string): void {
    console.warn('[poker][ws] fail:', reason);
    this.setStatus('error', reason);
    this.emit('error', new Error(reason));
  }

  private setStatus(s: TransportStatus, label?: string): void {
    this._status = s;
    this.emit('status', s, label);
  }

  // ── Transport interface ───────────────────────────────────────────────

  send(msg: Message): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket transport not open');
    }
    if (!this.roomId) throw new Error('not yet in a room');
    const env = this.signing.wrap(msg);
    this.ws.send(JSON.stringify({ kind: 'game', roomId: this.roomId, env }));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.setStatus('closed');
    this.emit('close');
  }

  status(): TransportStatus {
    return this._status;
  }

  /** Whether this transport finished the ctrl handshake. */
  isAuthed(): boolean {
    return this.authed;
  }

  /** The room id assigned by the matchmaker (or null if not matched yet). */
  getRoomId(): string | null {
    return this.roomId;
  }
}
