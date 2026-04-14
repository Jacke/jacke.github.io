import type { Card, GameState } from '../core/types.js';
import { IDS, maybe$ } from './dom.js';
import { makeCardEl } from './cards-view.js';
import { bumpPot } from './log.js';
import { chipStackHtml } from './chips.js';
import { callAmount, minRaiseAmount } from '../core/rules.js';
import { legalActions } from '../core/engine.js';

const PHASE_LABELS: Record<GameState['phase'], string> = {
  idle: '—',
  preflop: 'PRE-FLOP',
  flop: 'FLOP',
  turn: 'TURN',
  river: 'RIVER',
  showdown: 'SHOWDOWN',
};

/** Top-level render. Call after every state transition. */
export function renderTable(state: GameState, revealAll = false): void {
  renderSeats(state, revealAll);
  renderCommunity(state);
  renderPhaseLabel(state);
  renderPot(state);
}

// ═══════════════════════════════════════════════════════════════════════
// Seats — dynamic N-seat ring. Each seat has a single container built from
// a template when first seen, keyed by player index.
// ═══════════════════════════════════════════════════════════════════════

function seatsContainer(): HTMLElement | null {
  return maybe$('seats');
}

function seatEl(playerIdx: number): HTMLElement | null {
  return document.querySelector(`[data-seat="${playerIdx}"]`);
}

function ensureSeats(state: GameState): void {
  const container = seatsContainer();
  if (!container) return;
  const existing = container.querySelectorAll<HTMLElement>('[data-seat]');
  if (existing.length === state.numPlayers) return;

  container.innerHTML = '';
  for (let i = 0; i < state.numPlayers; i++) {
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.dataset['seat'] = String(i);
    seat.innerHTML = `
      <div class="seat-body">
        <div class="seat-header">
          <span class="seat-name" data-role="name"></span>
          <span class="seat-badge" data-role="badge"></span>
        </div>
        <div class="seat-cards" data-role="cards"></div>
        <div class="seat-meta">
          <span class="seat-chip-stack" data-role="chip-stack"></span>
          <span class="seat-chips" data-role="chips"></span>
        </div>
        <div class="seat-bet-area" data-role="bet"></div>
      </div>`;
    container.appendChild(seat);
  }
  layoutSeatsAroundTable(state);
}

/**
 * Place seats around the table. Seat i is angled based on its relative
 * position to the human player (myIndex). Human always sits at bottom (angle=0).
 */
function layoutSeatsAroundTable(state: GameState): void {
  const container = seatsContainer();
  if (!container) return;
  container.dataset['seatCount'] = String(state.numPlayers);
  for (let i = 0; i < state.numPlayers; i++) {
    const el = seatEl(i);
    if (!el) continue;
    // Relative position from the human's seat: 0 = self (bottom),
    // 1 = next clockwise, etc. In display order the human is at the south.
    const rel = (i - state.myIndex + state.numPlayers) % state.numPlayers;
    el.dataset['relpos'] = String(rel);
    el.dataset['seatOfTotal'] = `${rel}-${state.numPlayers}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Card row diff-rendering — preserves existing DOM, avoids animation replay
// ═══════════════════════════════════════════════════════════════════════

function syncCardRow(
  container: HTMLElement,
  cards: Card[] | null,
  faceUp: boolean,
  dealStepMs: number,
  placeholderCount = 0,
): void {
  const desired = cards ?? [];

  for (const ph of Array.from(container.querySelectorAll('.card-placeholder'))) {
    ph.remove();
  }

  const existing = Array.from(container.children) as HTMLElement[];

  let matched = 0;
  while (matched < existing.length && matched < desired.length) {
    const el = existing[matched]!;
    if (
      el.dataset['cardStr'] === desired[matched] &&
      el.dataset['faceUp'] === (faceUp ? '1' : '0')
    ) {
      matched++;
    } else {
      break;
    }
  }

  for (let i = existing.length - 1; i >= matched; i--) {
    existing[i]!.remove();
  }

  for (let i = matched; i < desired.length; i++) {
    container.appendChild(makeCardEl(desired[i]!, faceUp, (i - matched) * dealStepMs, container));
  }

  for (let i = desired.length; i < placeholderCount; i++) {
    const ph = document.createElement('div');
    ph.className = 'card-placeholder';
    container.appendChild(ph);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Per-seat rendering
// ═══════════════════════════════════════════════════════════════════════

function renderSeats(state: GameState, revealAll: boolean): void {
  ensureSeats(state);
  for (let i = 0; i < state.numPlayers; i++) {
    renderSeat(state, i, revealAll);
  }
}

function renderSeat(state: GameState, idx: number, revealAll: boolean): void {
  const seat = seatEl(idx);
  if (!seat) return;

  seat.classList.toggle('is-me', idx === state.myIndex);
  seat.classList.toggle('is-folded', state.folded[idx] === true);
  seat.classList.toggle('is-allin', state.allIn[idx] === true);
  seat.classList.toggle('is-active', state.actingPlayer === idx && isActionPhase(state));
  seat.classList.toggle('is-button', state.buttonIndex === idx);

  const name = seat.querySelector<HTMLElement>('[data-role="name"]');
  const chips = seat.querySelector<HTMLElement>('[data-role="chips"]');
  const chipStack = seat.querySelector<HTMLElement>('[data-role="chip-stack"]');
  const bet = seat.querySelector<HTMLElement>('[data-role="bet"]');
  const badge = seat.querySelector<HTMLElement>('[data-role="badge"]');
  const cardsEl = seat.querySelector<HTMLElement>('[data-role="cards"]');

  if (name) name.textContent = state.names[idx] ?? `Player ${idx + 1}`;
  if (chips) chips.textContent = `$${state.chips[idx] ?? 0}`;

  // Chip stack — re-render only if the amount changed (avoids reflow / layout churn).
  if (chipStack) {
    const amount = state.chips[idx] ?? 0;
    if (chipStack.dataset['rendered'] !== String(amount)) {
      chipStack.innerHTML = chipStackHtml(amount);
      chipStack.dataset['rendered'] = String(amount);
    }
  }

  if (bet) {
    const b = state.bets[idx] ?? 0;
    if (b > 0) {
      if (bet.dataset['rendered'] !== String(b)) {
        bet.innerHTML = chipStackHtml(b, { maxVisible: 3 });
        bet.dataset['rendered'] = String(b);
      }
      bet.classList.add('has-bet');
    } else {
      bet.innerHTML = '';
      bet.dataset['rendered'] = '';
      bet.classList.remove('has-bet');
    }
  }

  if (badge) {
    const parts: string[] = [];
    if (state.buttonIndex === idx) parts.push('D');
    if (state.actingPlayer === idx && isActionPhase(state)) parts.push('◆');
    if (state.allIn[idx]) parts.push('ALL-IN');
    badge.textContent = parts.join(' ');
  }

  if (cardsEl) {
    const hole = state.holeCards[idx];
    const faceUp = idx === state.myIndex || revealAll || state.phase === 'showdown';
    const cards = hole && !state.folded[idx] ? [hole[0], hole[1]] : null;
    syncCardRow(cardsEl, cards, faceUp, 80);
  }
}

function isActionPhase(state: GameState): boolean {
  return state.phase === 'preflop' || state.phase === 'flop' || state.phase === 'turn' || state.phase === 'river';
}

// ═══════════════════════════════════════════════════════════════════════
// Community + pot
// ═══════════════════════════════════════════════════════════════════════

export function renderCommunity(state: GameState): void {
  const el = maybe$(IDS.communityCards);
  if (!el) return;
  syncCardRow(el, state.community.slice(), true, 100, 5);
}

export function renderPhaseLabel(state: GameState): void {
  // Drive the phase wheel by setting data-phase on its root.
  // CSS handles the translate + opacity transition from the right.
  const wheel = maybe$('phase-wheel');
  if (wheel) wheel.dataset['phase'] = state.phase;

  // Legacy fallback if the wheel isn't in the DOM yet.
  const el = maybe$(IDS.phaseLabel);
  if (el) el.textContent = PHASE_LABELS[state.phase] ?? state.phase.toUpperCase();
}

export function renderPot(state: GameState): void {
  bumpPot(state.pot);
}

// ═══════════════════════════════════════════════════════════════════════
// Action controls
// ═══════════════════════════════════════════════════════════════════════

export function updateActionUI(state: GameState): void {
  const foldBtn = maybe$(IDS.btnFold) as HTMLButtonElement | null;
  const callBtn = maybe$(IDS.btnCall) as HTMLButtonElement | null;
  const raiseBtn = maybe$(IDS.btnRaise) as HTMLButtonElement | null;
  const raiseInput = maybe$(IDS.raiseInput) as HTMLInputElement | null;
  const status = maybe$(IDS.actionStatus);
  if (!foldBtn || !callBtn || !raiseBtn || !raiseInput || !status) return;

  const isMyTurn = state.actingPlayer === state.myIndex;
  const actionPhase = isActionPhase(state);
  const actions = legalActions(state);
  const iAct = isMyTurn && actionPhase;

  foldBtn.disabled = !iAct || !actions.includes('fold');
  callBtn.disabled = !iAct || !(actions.includes('call') || actions.includes('check'));
  raiseBtn.disabled = !iAct || !actions.includes('raise');
  raiseInput.disabled = raiseBtn.disabled;

  if (!actionPhase) {
    status.textContent = '';
    return;
  }

  if (iAct) {
    status.textContent = 'Your turn';
    const toCall = callAmount(state);
    callBtn.textContent = toCall === 0 ? 'Check' : `Call $${toCall}`;
    callBtn.className = 'btn btn-call';

    const myBet = state.bets[state.myIndex] ?? 0;
    const myStack = state.stacks[state.myIndex] ?? 0;
    const maxTotal = myBet + myStack;
    const minTotal = Math.min(minRaiseAmount(state), maxTotal);
    if (!raiseInput.dataset['touched']) {
      raiseInput.value = String(Math.min(minTotal, maxTotal));
    }
    raiseInput.max = String(maxTotal);
    raiseInput.min = String(minTotal);
  } else {
    const actorName = state.names[state.actingPlayer] ?? 'opponent';
    status.textContent = `Waiting for ${actorName}…`;
    callBtn.textContent = 'Call';
  }
}
