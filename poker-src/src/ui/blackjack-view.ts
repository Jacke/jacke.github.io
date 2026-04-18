/**
 * Blackjack render layer — diff-based, no DOM wipes.
 *
 * `renderBlackjack(state)` is safe to call on any state change. It never
 * clears containers via `innerHTML = ''`; instead it diffs the desired
 * card list against existing DOM and only appends newcomers / removes
 * stale tails. Existing cards keep their deal animation state and do NOT
 * re-animate on every render.
 *
 * One-shot animators (`flipDealerHole`, `flashOutcomeBanner`) live here
 * too but are driven explicitly from `app.ts` during the staged dealer
 * sequence — they're not called by `renderBlackjack` itself.
 */

import type { BjGameState, Hand } from '../blackjack/types.js';
import { handValue, isBlackjack, isBust } from '../blackjack/rules.js';
import { legalBjActions } from '../blackjack/engine.js';
import { makeCardEl, flipCard } from './cards-view.js';
import { syncCardRow } from './card-row.js';
import { chipStackHtml } from './chips.js';
import { maybe$ } from './dom.js';

// ═══════════════════════════════════════════════════════════════════════
// Coordinator
// ═══════════════════════════════════════════════════════════════════════

export function renderBlackjack(state: BjGameState): void {
  syncDealerCards(state);
  syncPlayerHands(state);
  setActionButtonState(state);
  updateBetChips(state);
  updateLabels(state);
}

// ═══════════════════════════════════════════════════════════════════════
// Dealer card row — handles mixed face state (card[0] up, card[1] down
// during player phase; both up after reveal).
// ═══════════════════════════════════════════════════════════════════════

function syncDealerCards(state: BjGameState): void {
  const area = maybe$('bj-dealer-cards');
  if (!area) return;
  const cards = state.dealer.cards;
  const revealAll = state.phase === 'dealer' || state.phase === 'settled';

  const existing = Array.from(area.children) as HTMLElement[];

  // Prefix-match existing cards against (cardStr, desired face state).
  let matched = 0;
  while (matched < existing.length && matched < cards.length) {
    const el = existing[matched]!;
    const wantFaceUp = revealAll || matched === 0;
    const wantFaceStr = wantFaceUp ? '1' : '0';
    if (el.dataset['cardStr'] === cards[matched] && el.dataset['faceUp'] === wantFaceStr) {
      matched++;
    } else {
      break;
    }
  }
  // Remove stale tail (reverse order so indices stay valid).
  for (let i = existing.length - 1; i >= matched; i--) existing[i]!.remove();
  // Append missing cards with staggered deal animation from the shoe.
  for (let i = matched; i < cards.length; i++) {
    const wantFaceUp = revealAll || i === 0;
    area.appendChild(
      makeCardEl(cards[i]!, wantFaceUp, (i - matched) * 80, area, 'bj-shoe'),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Player hands — diff-render wrappers keyed on data-hand-idx
// ═══════════════════════════════════════════════════════════════════════

function syncPlayerHands(state: BjGameState): void {
  const area = maybe$('bj-player-hands');
  if (!area) return;
  area.dataset['handCount'] = String(state.hands.length);

  // Remove any wrappers whose hand-idx is beyond state.hands.length.
  const existingWraps = Array.from(
    area.querySelectorAll<HTMLElement>('[data-hand-idx]'),
  );
  for (const wrap of existingWraps) {
    const idx = Number(wrap.dataset['handIdx']);
    if (idx >= state.hands.length) wrap.remove();
  }

  for (let idx = 0; idx < state.hands.length; idx++) {
    const hand = state.hands[idx]!;
    let wrap = area.querySelector<HTMLElement>(`[data-hand-idx="${idx}"]`);
    const isNew = !wrap;
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'bj-hand';
      wrap.dataset['handIdx'] = String(idx);
      wrap.innerHTML = `
        <div class="bj-hand-cards"></div>
        <div class="bj-hand-info">
          <span class="bj-total"></span>
          <span class="bj-bet"></span>
          <span class="bj-outcome"></span>
        </div>
      `;
      area.appendChild(wrap);
    }

    // Active-hand pulse + outcome border tint.
    const isActive = idx === state.activeHandIdx && !hand.done && state.phase === 'player';
    wrap.classList.toggle('active', isActive);
    for (const cls of ['outcome-win', 'outcome-blackjack', 'outcome-loss', 'outcome-push', 'outcome-surrender']) {
      wrap.classList.remove(cls);
    }
    if (hand.outcome) wrap.classList.add(`outcome-${hand.outcome}`);

    // One-shot slide-in animation for newly inserted hands (split).
    if (isNew && state.hands.length > 1) {
      wrap.classList.add('bj-hand-new');
      setTimeout(() => wrap?.classList.remove('bj-hand-new'), 500);
    }

    // Cards row — diff-render via shared util.
    const cardsRow = wrap.querySelector<HTMLElement>('.bj-hand-cards');
    if (cardsRow) {
      syncCardRow(cardsRow, hand.cards, true, {
        dealStepMs: 70,
        dealOriginId: 'bj-shoe',
      });
    }

    // Info strip — update text content without rebuilding.
    const totalEl = wrap.querySelector<HTMLElement>('.bj-total');
    if (totalEl) totalEl.textContent = handValueStr(hand.cards);
    const betEl = wrap.querySelector<HTMLElement>('.bj-bet');
    if (betEl) betEl.textContent = `$${hand.bet}`;
    const outcomeEl = wrap.querySelector<HTMLElement>('.bj-outcome');
    if (outcomeEl) outcomeEl.textContent = hand.outcome ? labelOutcome(hand) : '';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Action buttons — toggle disabled state only, never rebuild
// ═══════════════════════════════════════════════════════════════════════

function setActionButtonState(state: BjGameState): void {
  const legal = legalBjActions(state);

  setBtnEnabled('bj-btn-hit',       legal.hit);
  setBtnEnabled('bj-btn-stand',     legal.stand);
  setBtnEnabled('bj-btn-double',    legal.double);
  setBtnEnabled('bj-btn-split',     legal.split);
  setBtnEnabled('bj-btn-surrender', legal.surrender);

  const insRow = maybe$('bj-insurance-row');
  if (insRow) insRow.style.display = state.phase === 'insurance' ? '' : 'none';

  const dealBtn = maybe$('bj-btn-deal') as HTMLButtonElement | null;
  if (dealBtn) {
    const showDeal = state.phase === 'idle' || state.phase === 'settled';
    dealBtn.style.display = showDeal ? '' : 'none';
    dealBtn.textContent = state.phase === 'settled' ? 'NEXT HAND' : 'DEAL';
  }
}

function setBtnEnabled(id: string, enabled: boolean): void {
  const btn = maybe$(id) as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = !enabled;
  btn.classList.toggle('disabled', !enabled);
}

// ═══════════════════════════════════════════════════════════════════════
// Bet chip stack — rebuild only when the amount changes
// ═══════════════════════════════════════════════════════════════════════

function updateBetChips(state: BjGameState): void {
  const el = maybe$('bj-betting-circle-chips');
  if (!el) return;

  // Preview the pending bet from the input when no hand is live.
  let amount: number;
  if (state.phase === 'idle' || state.phase === 'settled') {
    const inputEl = maybe$('bj-bet-input') as HTMLInputElement | null;
    amount = inputEl ? Math.max(0, Math.floor(Number(inputEl.value) || 0)) : 0;
  } else {
    amount = state.currentBet;
  }

  if (el.dataset['amount'] !== String(amount)) {
    el.innerHTML = amount > 0 ? chipStackHtml(amount, { maxVisible: 6 }) : '';
    el.dataset['amount'] = String(amount);
    // Any mid-hand update clears the loss fade so the next round starts clean.
    el.classList.remove('fading-loss');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Text labels — totals, bankroll, phase banner, insurance amount
// ═══════════════════════════════════════════════════════════════════════

function updateLabels(state: BjGameState): void {
  const chipsEl = maybe$('bj-chips');
  if (chipsEl) chipsEl.textContent = `$${state.chips}`;

  const insLabel = maybe$('bj-insurance-amt');
  if (insLabel) insLabel.textContent = `$${Math.floor(state.currentBet / 2)}`;

  const totalEl = maybe$('bj-dealer-total');
  if (totalEl) {
    if (state.phase === 'dealer' || state.phase === 'settled') {
      totalEl.textContent = handValueStr(state.dealer.cards);
    } else {
      const up = state.dealer.cards[0];
      totalEl.textContent = up ? handValueStr([up]) : '';
    }
  }

  const phaseEl = maybe$('bj-phase-label');
  if (phaseEl) {
    const map: Record<BjGameState['phase'], string> = {
      idle: 'PLACE YOUR BET',
      dealing: 'DEALING…',
      insurance: 'INSURANCE?',
      player: 'YOUR MOVE',
      dealer: 'DEALER',
      settled: 'HAND OVER',
    };
    phaseEl.textContent = map[state.phase];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// One-shot animators — called explicitly from app.ts during the staged
// dealer sequence. Not invoked by renderBlackjack.
// ═══════════════════════════════════════════════════════════════════════

/** Find the dealer's second card element (hole) and flip it face-up. */
export function flipDealerHole(state: BjGameState): void {
  const area = maybe$('bj-dealer-cards');
  if (!area) return;
  const existing = Array.from(area.children) as HTMLElement[];
  const holeEl = existing[1];
  const holeCard = state.dealer.cards[1];
  if (!holeEl || !holeCard) return;
  if (holeEl.dataset['faceUp'] === '1') return; // already face-up, idempotent
  flipCard(holeEl, holeCard);
}

/**
 * Slide in the outcome banner. Reads the aggregate outcome — if there's
 * only one hand, shows that outcome. For multi-hand (split) scenarios it
 * shows the best-for-player outcome since otherwise the banner flickers.
 */
export function flashOutcomeBanner(state: BjGameState): void {
  const el = maybe$('bj-outcome-banner');
  if (!el) return;
  const outcomes = state.hands.map(h => h.outcome).filter(Boolean) as NonNullable<Hand['outcome']>[];
  if (outcomes.length === 0) return;

  // Pick the "most exciting" outcome across all hands for the banner.
  const priority: Record<string, number> = {
    blackjack: 5, win: 4, push: 3, surrender: 2, loss: 1,
  };
  const top = outcomes.reduce((a, b) => (priority[a]! >= priority[b]! ? a : b));

  // Pick the message — for a loss, use BUST when any hand actually busted.
  const anyBust = state.hands.some(h => isBust(h.cards));
  let text: string;
  let tint: string;
  switch (top) {
    case 'blackjack': text = 'BLACKJACK +3:2'; tint = 'banner-bj'; break;
    case 'win':       text = 'WIN';            tint = 'banner-win'; break;
    case 'push':      text = 'PUSH';           tint = 'banner-push'; break;
    case 'surrender': text = 'SURRENDER';      tint = 'banner-loss'; break;
    case 'loss':      text = anyBust ? 'BUST' : 'LOSE'; tint = 'banner-loss'; break;
  }

  el.textContent = text;
  el.classList.remove('banner-flash-in', 'banner-win', 'banner-bj', 'banner-loss', 'banner-push');
  // Force reflow so the animation re-runs if it's already been triggered.
  void el.offsetWidth;
  el.classList.add('banner-flash-in', tint);

  // Clean up after the animation finishes (1800ms).
  setTimeout(() => {
    el.classList.remove('banner-flash-in', tint);
  }, 1850);
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function handValueStr(cards: readonly string[]): string {
  if (cards.length === 0) return '';
  const { total, soft } = handValue(cards);
  if (total > 21) return `${total} BUST`;
  if (isBlackjack(cards)) return 'BLACKJACK';
  if (soft && total <= 21) return `${total - 10}/${total}`;
  return String(total);
}

function labelOutcome(hand: Hand): string {
  switch (hand.outcome) {
    case 'blackjack': return 'BJ +3:2';
    case 'win':       return 'WIN';
    case 'push':      return 'PUSH';
    case 'loss':      return isBust(hand.cards) ? 'BUST' : 'LOSE';
    case 'surrender': return 'SURR.';
    default:          return '';
  }
}
