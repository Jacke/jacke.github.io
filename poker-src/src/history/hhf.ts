/**
 * PokerStars Hand History Format exporter.
 *
 * Input: a completed `Match` (one or more `RecordedHand`s), each holding the
 * deck and the action sequence.
 *
 * Output: standard PokerStars HHF text — the de-facto format for poker
 * hand histories, readable by HoldemManager 3, PokerTracker 4, Poker HUD
 * tools, and most poker analysis software. This is what legitimizes us as
 * an actual poker engine (PRD §P0.4).
 *
 * The format this module produces is a best-effort PokerStars clone with:
 *  - Correct blind/button rotation per hand
 *  - Street-by-street action log
 *  - Final board + summary section
 *  - Per-seat outcomes (folded / showed / collected)
 *
 * It does NOT currently emit rakeless "tournament" headers (that's P1.3).
 */

import type { Card } from '../core/types.js';
import type { Match, RecordedHand, RecordedAction } from '../ui/match-recorder.js';
import { SB_AMOUNT, BB_AMOUNT, STARTING_STACK } from '../core/rules.js';
import { bestHand } from '../core/hands.js';

const SUIT_DISPLAY: Record<string, string> = { s: 's', h: 'h', d: 'd', c: 'c' };

/** Format a card for HHF: "As", "Ts", "2c" (T stays as T, not 10). */
function formatCard(c: Card): string {
  const r = c[0] ?? '?';
  const s = SUIT_DISPLAY[c[1] ?? ''] ?? '?';
  return r + s;
}

function formatCards(cards: Card[]): string {
  return cards.map(formatCard).join(' ');
}

/** ISO-ish timestamp for the header. PokerStars uses "2026/04/14 22:50:00 ET". */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ET`;
}

/**
 * Replay one hand and emit PokerStars HHF text. Reconstructs street-by-street
 * state from the recorded deck + actions so we don't need the full engine.
 */
export function handToHHF(
  match: Match,
  hand: RecordedHand,
  handId: number,
): string {
  const n = match.numPlayers;
  const names = match.names;
  const tableName = `iamjacke-${match.timestamp.toString(36).slice(-6).toUpperCase()}`;
  const isHeadsUp = n === 2;

  // Figure out positions.
  const button = hand.button;
  const sb = isHeadsUp ? button : (button + 1) % n;
  const bb = isHeadsUp ? (button + 1) % n : (button + 2) % n;

  // Starting stacks per player. In cash games we assume everyone started the
  // match at STARTING_STACK and the recorder does not track mid-match stacks,
  // so emit the same value for all — good enough for HHF validity.
  const startStacks = new Array(n).fill(STARTING_STACK);

  const out: string[] = [];

  // ─── Header
  out.push(
    `PokerStars Hand #${handId}: Hold'em No Limit ($${SB_AMOUNT}/$${BB_AMOUNT} USD) - ${formatTimestamp(match.timestamp)}`,
  );
  out.push(
    `Table '${tableName}' ${n}-max Seat #${button + 1} is the button`,
  );

  // ─── Seat listing
  for (let i = 0; i < n; i++) {
    out.push(`Seat ${i + 1}: ${names[i] ?? `Player ${i + 1}`} ($${startStacks[i]} in chips)`);
  }

  // ─── Blinds
  out.push(`${names[sb]}: posts small blind $${SB_AMOUNT}`);
  out.push(`${names[bb]}: posts big blind $${BB_AMOUNT}`);

  // ─── Hole cards (deck slots alternate from SB)
  out.push(`*** HOLE CARDS ***`);
  const holes: Card[][] = Array.from({ length: n }, () => []);
  let deckIdx = 0;
  for (let round = 0; round < 2; round++) {
    for (let step = 0; step < n; step++) {
      const p = (sb + step) % n;
      holes[p]!.push(hand.deck[deckIdx++]!);
    }
  }
  // PokerStars only shows hole cards for the hero — we don't know which seat
  // is the "hero" in the HHF output sense (a match may have multiple humans),
  // so dump cards for every seat as a comment block. Real HoldemManager will
  // still parse the betting action.
  for (let i = 0; i < n; i++) {
    out.push(`Dealt to ${names[i]} [${formatCards(holes[i]!)}]`);
  }

  // ─── Actions stream, segmented by street
  // Board indices: flop starts at deck[2n], turn at [2n+3], river at [2n+4].
  const flop = hand.deck.slice(2 * n, 2 * n + 3);
  const turn = hand.deck[2 * n + 3]!;
  const river = hand.deck[2 * n + 4]!;

  // Track per-player running stack + folded flag so we can compute
  // "Uncalled bet" and SUMMARY correctly.
  const stacks = startStacks.slice();
  const folded = new Array(n).fill(false);
  const committed = new Array(n).fill(0);
  committed[sb] = SB_AMOUNT; stacks[sb] -= SB_AMOUNT;
  committed[bb] = BB_AMOUNT; stacks[bb] -= BB_AMOUNT;

  // For raise tracking — "raises $X to $Y" requires prev top bet.
  let currentBets = new Array(n).fill(0);
  currentBets[sb] = SB_AMOUNT;
  currentBets[bb] = BB_AMOUNT;
  let topBet = BB_AMOUNT;

  // Walk actions until we cross a street boundary. Since RecordedAction doesn't
  // carry a "street" marker, we infer streets by counting "check-around closed"
  // or "call-closes-round" — but actually the RecordedHand doesn't segment
  // either. Simpler: emit *** STREET *** markers whenever we detect a round
  // closes (all non-folded players have matched the top bet AND we've advanced
  // past blinds). This is a heuristic that works for standard flows.
  let street: 'preflop' | 'flop' | 'turn' | 'river' = 'preflop';
  let actionCountThisStreet = 0;

  const emitStreet = (name: string, cards: Card[]) => {
    const prevBoard = street === 'preflop' ? [] :
      street === 'flop' ? flop :
      street === 'turn' ? [...flop, turn] :
      [...flop, turn, river];
    if (prevBoard.length === 0) {
      out.push(`*** ${name} *** [${formatCards(cards)}]`);
    } else {
      out.push(`*** ${name} *** [${formatCards(prevBoard)}] [${formatCards(cards)}]`);
    }
    // Reset bets on street change.
    currentBets = new Array(n).fill(0);
    topBet = 0;
    actionCountThisStreet = 0;
  };

  const aliveCount = () => folded.filter(f => !f).length;
  const activeBetsMatched = () => {
    const maxBet = Math.max(...currentBets);
    for (let i = 0; i < n; i++) {
      if (folded[i]) continue;
      if (currentBets[i] !== maxBet) return false;
    }
    return true;
  };

  // Emit a synthetic "hand ended on <street>" so we can tag SUMMARY lines.
  let handEndStreet: string = 'Pre-flop';

  for (const a of hand.actions) {
    emitAction(a);
    actionCountThisStreet++;

    // Street transition heuristic — matches our engine's close-round logic.
    const minActions = street === 'preflop' ? 2 : 2;
    if (
      aliveCount() > 1 &&
      actionCountThisStreet >= minActions &&
      activeBetsMatched()
    ) {
      if (street === 'preflop') {
        street = 'flop';
        emitStreet('FLOP', flop);
      } else if (street === 'flop') {
        street = 'turn';
        emitStreet('TURN', [turn]);
      } else if (street === 'turn') {
        street = 'river';
        emitStreet('RIVER', [river]);
      } else if (street === 'river') {
        break;
      }
    }

    if (aliveCount() <= 1) break;
  }

  function emitAction(a: RecordedAction): void {
    const name = names[a.player] ?? `Player ${a.player + 1}`;
    handEndStreet = street.charAt(0).toUpperCase() + street.slice(1);
    switch (a.kind) {
      case 'fold':
        folded[a.player] = true;
        out.push(`${name}: folds`);
        return;
      case 'check':
        out.push(`${name}: checks`);
        return;
      case 'call': {
        const toCall = topBet - currentBets[a.player]!;
        const paid = Math.min(toCall, stacks[a.player]!);
        stacks[a.player]! -= paid;
        currentBets[a.player]! += paid;
        committed[a.player]! += paid;
        out.push(`${name}: calls $${paid}`);
        return;
      }
      case 'raise': {
        const target = a.amount ?? topBet + BB_AMOUNT;
        const extra = target - currentBets[a.player]!;
        const paid = Math.min(extra, stacks[a.player]!);
        stacks[a.player]! -= paid;
        currentBets[a.player]! += paid;
        committed[a.player]! += paid;
        topBet = Math.max(topBet, currentBets[a.player]!);
        out.push(`${name}: raises $${paid} to $${currentBets[a.player]}`);
        return;
      }
      case 'discard':
        // Not a standard PokerStars street — skip silently.
        return;
    }
  }

  // ─── Showdown / finalization
  const winners = hand.result.winners;
  const totalPot = committed.reduce((a, b) => a + b, 0);

  if (hand.result.reason === 'showdown' && aliveCount() > 1) {
    out.push(`*** SHOW DOWN ***`);
    for (let i = 0; i < n; i++) {
      if (folded[i]) continue;
      const board = [...flop, turn, river];
      const best = bestHand([...holes[i]!, ...board]);
      out.push(`${names[i]}: shows [${formatCards(holes[i]!)}] (${best.name})`);
    }
  }

  for (const w of winners) {
    const share = Math.floor(totalPot / winners.length);
    out.push(`${names[w]} collected $${share} from pot`);
  }

  // ─── Summary
  out.push(`*** SUMMARY ***`);
  out.push(`Total pot $${totalPot} | Rake $0`);
  const boardSoFar = street === 'preflop' ? [] :
    street === 'flop' ? flop :
    street === 'turn' ? [...flop, turn] :
    [...flop, turn, river];
  if (boardSoFar.length > 0) {
    out.push(`Board [${formatCards(boardSoFar)}]`);
  }
  for (let i = 0; i < n; i++) {
    const seatNum = i + 1;
    const seatLabel = i === button ? '(button)' : i === sb ? '(small blind)' : i === bb ? '(big blind)' : '';
    const nm = names[i];
    if (folded[i]) {
      out.push(`Seat ${seatNum}: ${nm} ${seatLabel} folded on the ${handEndStreet}`.trim());
    } else if (winners.includes(i)) {
      out.push(`Seat ${seatNum}: ${nm} ${seatLabel} collected`.trim());
    } else {
      out.push(`Seat ${seatNum}: ${nm} ${seatLabel} mucked`.trim());
    }
  }

  return out.join('\n');
}

/** Convert an entire match into HHF text (multiple hands, blank-line separated). */
export function matchToHHF(match: Match): string {
  const blocks: string[] = [];
  // Use a deterministic hand ID derived from the match timestamp so exports
  // are stable.
  const baseId = match.timestamp;
  match.hands.forEach((h, i) => {
    blocks.push(handToHHF(match, h, baseId + i));
  });
  return blocks.join('\n\n\n');
}

/**
 * Trigger a browser download of the given text as `poker-hand-history-<ts>.txt`.
 * Safe no-op in non-browser environments.
 */
export function downloadHHF(text: string, filenameHint: string = 'poker-hand-history'): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = `${filenameHint}-${ts}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
