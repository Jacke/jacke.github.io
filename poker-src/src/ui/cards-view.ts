import type { Card } from '../core/types.js';
import { SUIT_CLASS, SUIT_SYMBOL, rankChar, suitChar } from '../core/cards.js';

function displayRank(card: Card): string {
  const r = rankChar(card);
  return r === 'T' ? '10' : r;
}

function cardFaceHtml(card: Card): string {
  const disp = displayRank(card);
  const sym = SUIT_SYMBOL[suitChar(card)];
  return `
    <div class="card-face">
      <span class="card-rank-tl">${disp}</span>
      <span class="card-suit-tl">${sym}</span>
      <span class="card-rank-br">${disp}</span>
      <span class="card-suit-br">${sym}</span>
    </div>`;
}

function cardBackHtml(): string {
  return `<div class="card-back"></div>`;
}

/**
 * Compute the offset from the deck pile's visual center to `targetContainer`'s
 * next-child position, and set CSS variables on the card so the @keyframes
 * card-deal animation flies it from the deck.
 */
function computeDealOffset(targetContainer: Element | null): { dx: number; dy: number; rot: number } {
  if (!targetContainer) return { dx: 0, dy: -120, rot: -18 };
  const deck = document.getElementById('deck-pile');
  if (!deck) return { dx: 0, dy: -120, rot: -18 };
  const deckRect = deck.getBoundingClientRect();
  const targetRect = targetContainer.getBoundingClientRect();
  // Aim at the right edge of the existing card row (next card slot).
  const tx = targetRect.left + Math.min(targetRect.width, (targetContainer.children.length + 1) * 70);
  const ty = targetRect.top + targetRect.height / 2;
  const dx = (deckRect.left + deckRect.width / 2) - tx;
  const dy = (deckRect.top + deckRect.height / 2) - ty;
  // Slight per-card rotation for organic look.
  const rot = -12 + Math.random() * 24;
  return { dx, dy, rot };
}

function flashDeckTap(): void {
  const deck = document.getElementById('deck-pile');
  if (!deck) return;
  deck.classList.remove('dealing');
  // Force reflow so we can retrigger the animation.
  void (deck as HTMLElement).offsetWidth;
  deck.classList.add('dealing');
  setTimeout(() => deck.classList.remove('dealing'), 260);
}

export function makeCardEl(card: Card, faceUp = true, dealDelay = 0, targetContainer?: Element): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card';
  if (faceUp) {
    el.classList.add(SUIT_CLASS[suitChar(card)]);
    el.innerHTML = cardFaceHtml(card);
  } else {
    el.innerHTML = cardBackHtml();
  }
  el.style.animationDelay = dealDelay + 'ms';
  el.classList.add('dealt');
  el.dataset['cardStr'] = card;
  el.dataset['faceUp'] = faceUp ? '1' : '0';

  const { dx, dy, rot } = computeDealOffset(targetContainer ?? null);
  el.style.setProperty('--deal-dx', `${dx}px`);
  el.style.setProperty('--deal-dy', `${dy}px`);
  el.style.setProperty('--deal-rot', `${rot}deg`);

  flashDeckTap();
  return el;
}

export function flipCard(el: HTMLElement, card: Card): void {
  el.classList.add('flipping');
  setTimeout(() => {
    el.classList.remove('card-back', 'red-suit', 'black-suit');
    el.classList.add(SUIT_CLASS[suitChar(card)]);
    el.innerHTML = cardFaceHtml(card);
    el.dataset['faceUp'] = '1';
  }, 300);
}
