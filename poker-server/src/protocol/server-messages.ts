/**
 * Control-plane frame types for the WebSocket protocol.
 *
 * Kept separate from the signed `Message` union in
 * `../../../poker-src/src/protocol/messages.ts` because:
 *   1. Signed-envelope canonicalization hashes the Message JSON — adding
 *      control-plane types there would force every existing PeerJS peer
 *      to re-sign, breaking old clients.
 *   2. Control messages are cheap (no crypto on the hot path) because
 *      they're framed as `{ kind: 'ctrl', msg }` and routed before
 *      signature verification.
 *
 * Every ctrl frame has a unique `type`. Validators below are used by the
 * WS router to reject malformed input before it can crash the server.
 */

import type { SignedEnvelope } from './envelope.js';

// ═══════════════════════════════════════════════════════════════════════
// Outer frame — every WS message is either control or game
// ═══════════════════════════════════════════════════════════════════════

export type WsFrame =
  | { kind: 'ctrl'; msg: CtrlClientMsg | CtrlServerMsg }
  | { kind: 'game'; roomId: string; env: SignedEnvelope };

// ═══════════════════════════════════════════════════════════════════════
// Client → server
// ═══════════════════════════════════════════════════════════════════════

export type CtrlClientMsg =
  | { type: 'auth'; pubkey: string; nonce: string; sig: string; name?: string }
  | { type: 'matchmake'; game: 'poker' | 'blackjack'; seats: number }
  | { type: 'cancel-matchmake' }
  | { type: 'join-room'; roomId: string; lastChatId?: number; lastHandId?: number }
  | { type: 'leave-room' }
  | { type: 'link-email-request'; email: string }
  | { type: 'link-email-verify'; code: string }
  | { type: 'ping' };

// ═══════════════════════════════════════════════════════════════════════
// Server → client
// ═══════════════════════════════════════════════════════════════════════

export type CtrlServerMsg =
  | { type: 'welcome'; nonce: string; serverTime: number; version: string }
  | { type: 'authed'; pubkey: string; displayName: string; resumableRoomId: string | null }
  | { type: 'queued'; position: number; game: string; seats: number }
  | { type: 'matched'; roomId: string; seat: number; opponents: Array<{ pubkey: string; displayName: string; seat: number }> }
  | { type: 'joined'; roomId: string; members: Array<{ pubkey: string; displayName: string; seat: number }>; gameKind: 'poker' | 'blackjack' }
  | { type: 'left'; pubkey: string }
  | { type: 'replay-start'; roomId: string }
  | { type: 'replay-chat'; id: number; pubkey: string; text: string; ts: number }
  | { type: 'replay-hand'; id: number; pubkey: string; payload: unknown; ts: number }
  | { type: 'replay-end' }
  | { type: 'error'; code: string; detail?: string }
  | { type: 'pong' };

// ═══════════════════════════════════════════════════════════════════════
// Validators
// ═══════════════════════════════════════════════════════════════════════

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isWsFrame(v: unknown): v is WsFrame {
  if (!isObject(v) || typeof v['kind'] !== 'string') return false;
  if (v['kind'] === 'ctrl') {
    return isObject(v['msg']) && typeof (v['msg'] as Record<string, unknown>)['type'] === 'string';
  }
  if (v['kind'] === 'game') {
    return typeof v['roomId'] === 'string' && isObject(v['env']);
  }
  return false;
}

export function isCtrlClientMsg(v: unknown): v is CtrlClientMsg {
  if (!isObject(v) || typeof v['type'] !== 'string') return false;
  switch (v['type']) {
    case 'auth':
      return typeof v['pubkey'] === 'string'
        && typeof v['nonce'] === 'string'
        && typeof v['sig'] === 'string'
        && (v['name'] === undefined || typeof v['name'] === 'string');
    case 'matchmake':
      return (v['game'] === 'poker' || v['game'] === 'blackjack')
        && typeof v['seats'] === 'number'
        && [2, 3, 6].includes(v['seats']);
    case 'cancel-matchmake':
    case 'leave-room':
    case 'ping':
      return true;
    case 'join-room':
      return typeof v['roomId'] === 'string'
        && (v['lastChatId'] === undefined || typeof v['lastChatId'] === 'number')
        && (v['lastHandId'] === undefined || typeof v['lastHandId'] === 'number');
    case 'link-email-request':
      return typeof v['email'] === 'string' && /.+@.+\..+/.test(v['email'] as string);
    case 'link-email-verify':
      return typeof v['code'] === 'string' && (v['code'] as string).length > 0;
    default:
      return false;
  }
}

/** Convenience builder for error frames on the server side. */
export function errorFrame(code: string, detail?: string): WsFrame {
  const msg: CtrlServerMsg = detail !== undefined
    ? { type: 'error', code, detail }
    : { type: 'error', code };
  return { kind: 'ctrl', msg };
}
