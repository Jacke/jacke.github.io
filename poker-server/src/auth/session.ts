/**
 * Per-WebSocket session state.
 *
 * Tracks: connection id, authed pubkey, current room (if in one),
 * matchmaker membership, and the SocketSession queue position. One
 * instance lives in `SessionRegistry` keyed by socket id; we look it up
 * on every inbound message and on socket close.
 */

import type { WebSocket } from 'ws';

export type SessionState =
  | 'unauthed'
  | 'authed'
  | 'queued'
  | 'pending-room'  // matched, waiting for join-room
  | 'in-room';

export interface SocketSession {
  id: string;
  socket: WebSocket;
  state: SessionState;
  pubkey: string | null;
  displayName: string;
  roomId: string | null;
  /** Last sequence we sent the client (replay frames included). */
  outboundSeq: number;
  /** Last live game-message id we observed delivering to this client per room. */
  lastChatIdSeen: number;
  lastHandIdSeen: number;
  connectedAt: number;
}

class SessionRegistry {
  private byId = new Map<string, SocketSession>();
  private byPubkey = new Map<string, SocketSession>();
  private nextId = 1;

  create(socket: WebSocket): SocketSession {
    const id = `s${this.nextId++}-${Date.now().toString(36)}`;
    const session: SocketSession = {
      id,
      socket,
      state: 'unauthed',
      pubkey: null,
      displayName: '',
      roomId: null,
      outboundSeq: 0,
      lastChatIdSeen: 0,
      lastHandIdSeen: 0,
      connectedAt: Date.now(),
    };
    this.byId.set(id, session);
    return session;
  }

  bindPubkey(session: SocketSession, pubkey: string): void {
    // If the same pubkey was on another live socket, kick the old one.
    const existing = this.byPubkey.get(pubkey);
    if (existing && existing.id !== session.id) {
      try { existing.socket.close(4001, 'replaced by new connection'); } catch { /* ignore */ }
      this.byId.delete(existing.id);
      this.byPubkey.delete(pubkey);
    }
    session.pubkey = pubkey;
    this.byPubkey.set(pubkey, session);
  }

  get(id: string): SocketSession | undefined {
    return this.byId.get(id);
  }

  getByPubkey(pubkey: string): SocketSession | undefined {
    return this.byPubkey.get(pubkey);
  }

  remove(session: SocketSession): void {
    this.byId.delete(session.id);
    if (session.pubkey) this.byPubkey.delete(session.pubkey);
  }

  size(): number {
    return this.byId.size;
  }

  all(): SocketSession[] {
    return Array.from(this.byId.values());
  }
}

let instance: SessionRegistry | null = null;
export function getSessions(): SessionRegistry {
  if (!instance) instance = new SessionRegistry();
  return instance;
}
export function resetSessions(): void {
  instance = null;
}
