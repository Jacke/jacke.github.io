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
  | NextHandMessage
  | ChatMessage
  | BjStartMessage
  | BjBetMessage
  | BjDealMessage
  | BjActionMessage
  | BjInsuranceMessage;

export interface HelloMessage {
  type: 'hello';
  name: string;
  /** Opaque game-kind hint so one transport can drive both poker and BJ. */
  game?: 'poker' | 'blackjack';
}

export interface ReadyMessage {
  type: 'ready';
}

export interface DealMessage {
  type: 'deal';
  deck: Card[];
  button: number;
  handNum: number;
}

export interface ActionMessage {
  type: 'action';
  player: number;
  action: ActionKind;
  amount?: number;
}

export interface NextHandMessage {
  type: 'next_hand';
}

// ═══════════════════════════════════════════════════════════════════════
// Chat — free-form text message between P2P peers. Transports already
// sign these with Ed25519, so the text is tamper-proof in transit.
// ═══════════════════════════════════════════════════════════════════════

export interface ChatMessage {
  type: 'chat';
  from: string;   // sender's display name (informational — pubkey is authoritative)
  text: string;   // plain text, clamped to 500 chars by validator
  ts: number;     // sender-side timestamp (informational)
}

// ═══════════════════════════════════════════════════════════════════════
// Blackjack P2P — host-authoritative shared-dealer model.
// The host picks a deterministic shoe seed in the first hello, both sides
// rebuild the identical shoe. Each round the host emits `bj-deal` with the
// per-player bets; both sides apply the same engine mutation.
// ═══════════════════════════════════════════════════════════════════════

export interface BjStartMessage {
  type: 'bj-start';
  /** Deterministic shoe seed. Both sides build the same 6-deck shoe. */
  seed: number;
  /** Initial chip stack per player — matches at host-configured table stakes. */
  startingChips: number;
}

export interface BjBetMessage {
  type: 'bj-bet';
  /** Player index in the shared player list — 0 = host, 1 = guest. */
  player: number;
  amount: number;
}

export interface BjDealMessage {
  type: 'bj-deal';
  /** Round number in this session (1-indexed). */
  round: number;
  /** Bets per player, parallel to the player list. */
  bets: number[];
}

export interface BjActionMessage {
  type: 'bj-action';
  player: number;
  /** Subset of actions valid during the player's turn. */
  action: 'hit' | 'stand' | 'double' | 'split' | 'surrender';
}

export interface BjInsuranceMessage {
  type: 'bj-insurance';
  player: number;
  accept: boolean;
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
        && (v['deck'].length === 52 || v['deck'].length === 36 || v['deck'].length === 53)
        && v['deck'].every(c => typeof c === 'string' && c.length === 2)
        && typeof v['button'] === 'number'
        && typeof v['handNum'] === 'number';
    case 'action':
      return typeof v['player'] === 'number'
        && typeof v['action'] === 'string'
        && ['fold', 'check', 'call', 'raise', 'discard'].includes(v['action'])
        && (v['amount'] === undefined || typeof v['amount'] === 'number');
    case 'chat':
      return typeof v['from'] === 'string'
        && typeof v['text'] === 'string'
        && v['text'].length > 0
        && v['text'].length <= 500
        && typeof v['ts'] === 'number';
    case 'bj-start':
      return typeof v['seed'] === 'number'
        && typeof v['startingChips'] === 'number'
        && v['startingChips'] > 0;
    case 'bj-bet':
      return typeof v['player'] === 'number'
        && typeof v['amount'] === 'number'
        && v['amount'] >= 0;
    case 'bj-deal':
      return typeof v['round'] === 'number'
        && Array.isArray(v['bets'])
        && v['bets'].every(b => typeof b === 'number' && b >= 0);
    case 'bj-action':
      return typeof v['player'] === 'number'
        && typeof v['action'] === 'string'
        && ['hit', 'stand', 'double', 'split', 'surrender'].includes(v['action']);
    case 'bj-insurance':
      return typeof v['player'] === 'number'
        && typeof v['accept'] === 'boolean';
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
