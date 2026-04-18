import type { Card } from '../core/types.js';
import { SUIT_CLASS, SUIT_SYMBOL, rankChar, suitChar, isJoker } from '../core/cards.js';

function displayRank(card: Card): string {
  if (isJoker(card)) return '\u2605'; // ★
  const r = rankChar(card);
  return r === 'T' ? '10' : r;
}

function cardFaceHtml(card: Card): string {
  if (isJoker(card)) {
    return `
    <div class="card-face card-face-joker">
      <span class="card-rank-tl">\u2605</span>
      <span class="card-suit-tl">JK</span>
      <span class="card-rank-br">\u2605</span>
      <span class="card-suit-br">JK</span>
    </div>`;
  }
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
 * Compute the offset from the origin element's visual center to
 * `targetContainer`'s next-child position, and set CSS variables on the
 * card so the @keyframes card-deal animation flies it from there.
 *
 * `originId` defaults to `'deck-pile'` (poker's deck graphic). Blackjack
 * passes `'bj-shoe'` so cards appear to come from the shoe in the top-right.
 */
function computeDealOffset(
  targetContainer: Element | null,
  originId: string,
): { dx: number; dy: number; rot: number } {
  if (!targetContainer) return { dx: 0, dy: -120, rot: -18 };
  const origin = document.getElementById(originId);
  if (!origin) return { dx: 0, dy: -120, rot: -18 };
  const originRect = origin.getBoundingClientRect();
  const targetRect = targetContainer.getBoundingClientRect();
  // Aim at the right edge of the existing card row (next card slot).
  const tx = targetRect.left + Math.min(targetRect.width, (targetContainer.children.length + 1) * 70);
  const ty = targetRect.top + targetRect.height / 2;
  const dx = (originRect.left + originRect.width / 2) - tx;
  const dy = (originRect.top + originRect.height / 2) - ty;
  // Slight per-card rotation for organic look.
  const rot = -12 + Math.random() * 24;
  return { dx, dy, rot };
}

function flashDeckTap(originId: string): void {
  const origin = document.getElementById(originId);
  if (!origin) return;
  origin.classList.remove('dealing');
  // Force reflow so we can retrigger the animation.
  void (origin as HTMLElement).offsetWidth;
  origin.classList.add('dealing');
  setTimeout(() => origin.classList.remove('dealing'), 260);
}

export function makeCardEl(
  card: Card,
  faceUp = true,
  dealDelay = 0,
  targetContainer?: Element,
  originId = 'deck-pile',
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card';
  if (faceUp) {
    if (isJoker(card)) {
      el.classList.add('joker-card');
    } else {
      el.classList.add(SUIT_CLASS[suitChar(card)]);
    }
    el.innerHTML = cardFaceHtml(card);
  } else {
    el.innerHTML = cardBackHtml();
  }
  el.style.animationDelay = dealDelay + 'ms';
  el.classList.add('dealt');
  el.dataset['cardStr'] = card;
  el.dataset['faceUp'] = faceUp ? '1' : '0';

  const { dx, dy, rot } = computeDealOffset(targetContainer ?? null, originId);
  el.style.setProperty('--deal-dx', `${dx}px`);
  el.style.setProperty('--deal-dy', `${dy}px`);
  el.style.setProperty('--deal-rot', `${rot}deg`);

  flashDeckTap(originId);
  return el;
}

export function flipCard(el: HTMLElement, card: Card): void {
  el.classList.add('flipping');
  setTimeout(() => {
    el.classList.remove('card-back', 'red-suit', 'black-suit', 'joker-card');
    if (isJoker(card)) {
      el.classList.add('joker-card');
    } else {
      el.classList.add(SUIT_CLASS[suitChar(card)]);
    }
    el.innerHTML = cardFaceHtml(card);
    el.dataset['faceUp'] = '1';
  }, 300);
}
