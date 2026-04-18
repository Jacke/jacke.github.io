/**
 * Ход-2 gameplay UX: hand strength meter, pot-odds widget, and a small
 * helper to compute the "equity" shown during your turn.
 *
 * Keyboard shortcuts + raise presets live in app.ts event wiring — this
 * module is pure render helpers.
 */

import type { GameState } from '../core/types.js';
import { maybe$ } from './dom.js';
import { bestHand } from '../core/hands.js';
import { callAmount } from '../core/rules.js';

const HAND_LABELS: Record<number, string> = {
  0: 'High Card',
  1: 'Pair',
  2: 'Two Pair',
  3: 'Three of a Kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Four of a Kind',
  8: 'Straight Flush',
};

/**
 * Update the hand-strength meter. Shows the best-5 category for the human's
 * hole cards + current community, as a label + fill gradient (0 → 8).
 */
export function renderHandMeter(state: GameState): void {
  const wrap = maybe$('hand-meter-wrap');
  const label = maybe$('hand-meter-label');
  const fill = maybe$('hand-meter-fill');
  if (!wrap || !label || !fill) return;

  const me = state.myIndex;
  const hole = state.holeCards[me];
  const hasHand = !!hole && state.phase !== 'idle';
  if (!hasHand) {
    wrap.classList.add('hidden');
    return;
  }

  if (state.community.length === 0) {
    // Preflop — show hole-card summary only
    const a = hole![0] ?? '2s';
    const b = hole![1] ?? '2h';
    const rA = a[0] ?? '2';
    const rB = b[0] ?? '2';
    const suited = a[1] === b[1];
    const pair = rA === rB;
    const text = pair ? `Pair of ${rA}'s` : `${rA}${rB}${suited ? ' suited' : ' offsuit'}`;
    wrap.classList.remove('hidden');
    label.textContent = text;
    // Preflop fill: 10% for trash → 100% for AA
    const preScore = preflopRoughScore(a, b);
    fill.style.width = `${Math.round(preScore * 100)}%`;
    return;
  }

  try {
    const best = bestHand([...hole!, ...state.community]);
    const cat = best.category as number;
    wrap.classList.remove('hidden');
    label.textContent = HAND_LABELS[cat] ?? best.name;
    // Category 0..8 → width 15..100%
    fill.style.width = `${15 + (cat / 8) * 85}%`;
  } catch {
    wrap.classList.add('hidden');
  }
}

function preflopRoughScore(a: string, b: string): number {
  const VALS: Record<string, number> = {
    '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14,
  };
  const hi = Math.max(VALS[a[0] ?? '2'] ?? 2, VALS[b[0] ?? '2'] ?? 2);
  const lo = Math.min(VALS[a[0] ?? '2'] ?? 2, VALS[b[0] ?? '2'] ?? 2);
  const pair = a[0] === b[0];
  const suited = a[1] === b[1];
  let score = (hi / 14) * 0.45 + (lo / 14) * 0.15;
  if (pair) score = 0.4 + (hi / 14) * 0.58;
  else {
    if (suited) score += 0.07;
    const gap = hi - lo;
    if (gap === 1) score += 0.06;
    else if (gap === 2) score += 0.03;
  }
  return Math.max(0.1, Math.min(1, score));
}

/**
 * Update the pot-odds widget — shows "Need X%" (required equity) and
 * "Equity Y%" (our rough equity). Only visible during our action turn.
 */
export function renderPotOdds(state: GameState, equityPct: number | null): void {
  const wrap = maybe$('pot-odds-wrap');
  const reqEl = maybe$('po-required');
  const eqEl = maybe$('po-equity');
  if (!wrap || !reqEl || !eqEl) return;

  const isMyTurn = state.actingPlayer === state.myIndex && state.phase !== 'idle' && state.phase !== 'showdown';
  if (!isMyTurn) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');

  const toCall = callAmount(state);
  const required = toCall === 0 ? 0 : toCall / (state.pot + toCall);
  reqEl.textContent = toCall === 0 ? 'free' : `${Math.round(required * 100)}%`;
  if (equityPct === null) {
    eqEl.textContent = '—';
    (eqEl as HTMLElement).className = 'po-value';
  } else {
    eqEl.textContent = `${Math.round(equityPct)}%`;
    const profitable = toCall === 0 || equityPct / 100 >= required + 0.02;
    (eqEl as HTMLElement).className = 'po-value ' + (profitable ? 'profitable' : 'losing');
  }
}

/** Disable all preset buttons when it's not the human's turn. */
export function updatePresetButtons(enabled: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach(btn => {
    btn.disabled = !enabled;
  });
}
