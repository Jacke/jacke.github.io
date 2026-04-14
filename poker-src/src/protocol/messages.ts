import type { ActionKind, Card } from '../core/types.js';

/**
 * Wire protocol — every message sent over Transport must match one of these shapes.
 * Kept intentionally flat (no nesting) so JSON serialization is trivial and
 * validators can be dumb equality checks.
 */
export type Message =
  | HelloMessage
  | ReadyMessage
  | DealMessage
  | ActionMessage
  | NextHandMessage;

export interface HelloMessage {
  type: 'hello';
  name: string;
}

export interface ReadyMessage {
  type: 'ready';
}

export interface DealMessage {
  type: 'deal';
  deck: Card[];
  button: 0 | 1;
  handNum: number;
}

export interface ActionMessage {
  type: 'action';
  player: 0 | 1;
  action: ActionKind;
  amount?: number;
}

export interface NextHandMessage {
  type: 'next_hand';
}

// ═══════════════════════════════════════════════════════════════════════
// Runtime validators — defensive parsing for transport inputs.
// ═══════════════════════════════════════════════════════════════════════

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isMessage(v: unknown): v is Message {
  if (!isObject(v) || typeof v['type'] !== 'string') return false;
  switch (v['type']) {
    case 'hello':
      return typeof v['name'] === 'string';
    case 'ready':
    case 'next_hand':
      return true;
    case 'deal':
      return Array.isArray(v['deck'])
        && v['deck'].length === 52
        && v['deck'].every(c => typeof c === 'string' && c.length === 2)
        && (v['button'] === 0 || v['button'] === 1)
        && typeof v['handNum'] === 'number';
    case 'action':
      return (v['player'] === 0 || v['player'] === 1)
        && typeof v['action'] === 'string'
        && ['fold', 'check', 'call', 'raise'].includes(v['action'])
        && (v['amount'] === undefined || typeof v['amount'] === 'number');
    default:
      return false;
  }
}

/** Parse an unknown wire value (string or object) into a validated Message. Throws on invalid. */
export function parseMessage(raw: unknown): Message {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); }
    catch { throw new Error(`parseMessage: invalid JSON`); }
  }
  if (!isMessage(obj)) throw new Error(`parseMessage: invalid message shape`);
  return obj;
}

/** Serialize a message for transports that require a string. */
export function serializeMessage(msg: Message): string {
  return JSON.stringify(msg);
}
