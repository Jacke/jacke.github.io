// Durak UI + turn driver — "Красный бархат" edition.
// Visuals: red velvet felt, gold khokhloma corner filigree, wax-seal phase badge,
// framed trump cartouche, discard pile, bilingual outcome banner.

import { showScreen } from '../ui/dom.js';
import {
  createDurakState,
  startDurak,
  suitOf,
  beats,
  canAttackWith,
  attack as durakAttack,
  defend as durakDefend,
  take as durakTake,
  pass as durakPass,
} from './engine.js';
import type { DurakState } from './types.js';
import { decideDurak, thinkDelayMs, type DurakDifficulty } from './bot.js';
import { defaultRng } from '../core/cards.js';

const PLAYER = 0;
const BOT = 1;

const SUIT_SYM: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = new Set(['h', 'd']);

interface UIState {
  state: DurakState;
  difficulty: DurakDifficulty;
  selected: string | null;
  botTimer: ReturnType<typeof setTimeout> | null;
  banner: { kind: 'win' | 'loss'; text: string; ruText: string } | null;
  locked: boolean;
}

let ui: UIState | null = null;

// ─── Khokhloma SVG flourish (used in all 4 corners) ──────────────────
const KHOKHLOMA_SVG = `
<svg viewBox="0 0 150 150" aria-hidden="true">
  <path d="M 8 142 C 20 122, 30 108, 48 100 C 62 92, 66 72, 55 55 C 46 40, 52 24, 68 18"/>
  <path d="M 48 100 C 58 104, 70 112, 82 120"/>
  <path d="M 55 55 Q 70 60, 82 52 T 96 42"/>
  <path d="M 68 18 Q 78 14, 90 22"/>
  <path d="M 28 110 Q 20 105, 18 95 Q 22 98, 30 102"/>
  <path d="M 65 75 Q 72 68, 78 72 Q 76 80, 68 82"/>
  <path d="M 75 38 Q 82 30, 92 32 Q 88 40, 80 44"/>
  <circle class="d-berry" cx="48" cy="100" r="3.2"/>
  <circle class="d-berry" cx="55" cy="55" r="3.2"/>
  <circle class="d-berry" cx="68" cy="18" r="3.5"/>
  <circle class="d-berry" cx="82" cy="120" r="2.6"/>
  <circle class="d-berry" cx="96" cy="42" r="2.6"/>
  <circle class="d-berry" cx="90" cy="22" r="2.4"/>
</svg>
`;

function rankLabel(card: string): string {
  return card[0] === 'T' ? '10' : card[0]!;
}

function cardFaceHtml(
  card: string,
  opts: { selected?: boolean; playable?: boolean; disabled?: boolean; extraClass?: string; clickable?: boolean } = {},
): string {
  const suit = card[1]!;
  const isRed = RED_SUITS.has(suit);
  const classes = ['card', isRed ? 'red-suit' : 'black-suit'];
  if (opts.selected) classes.push('is-selected');
  if (opts.playable) classes.push('is-playable');
  if (opts.disabled) classes.push('is-disabled');
  if (opts.extraClass) classes.push(opts.extraClass);
  const dataAttr = opts.clickable ? ` data-card="${card}"` : '';
  const r = rankLabel(card);
  const s = SUIT_SYM[suit] ?? suit;
  return `
    <div class="${classes.join(' ')}"${dataAttr}>
      <div class="card-face">
        <span class="card-rank-tl">${r}</span>
        <span class="card-suit-tl">${s}</span>
        <span class="card-rank-br">${r}</span>
        <span class="card-suit-br">${s}</span>
      </div>
    </div>
  `;
}

function cardBackHtml(extraClass = ''): string {
  const cls = ['card', extraClass].filter(Boolean).join(' ');
  return `
    <div class="${cls}">
      <div class="card-back"><span class="card-back-logo">ДУРАК</span></div>
    </div>
  `;
}

function renderKhokhlomaCorners(): string {
  return `
    <div class="d-corner d-corner-tl">${KHOKHLOMA_SVG}</div>
    <div class="d-corner d-corner-tr">${KHOKHLOMA_SVG}</div>
    <div class="d-corner d-corner-bl">${KHOKHLOMA_SVG}</div>
    <div class="d-corner d-corner-br">${KHOKHLOMA_SVG}</div>
  `;
}

function renderTrumpFrame(state: DurakState): string {
  const trump = state.trumpCard;
  const deckN = state.deck.length;
  const trumpMarkup = trump
    ? cardFaceHtml(trump, { extraClass: 'd-trump-card' })
    : `<div style="opacity:0.4;font-size:0.7rem;letter-spacing:0.2em;">NO TRUMP</div>`;
  const deckMarkup = deckN > 0
    ? `<div class="d-deck">
         <div class="d-deck-card"></div>
         <div class="d-deck-card"></div>
         <div class="d-deck-card"></div>
       </div>`
    : `<div class="d-deck empty"></div>`;
  const suitChar = trump ? SUIT_SYM[suitOf(trump)] : '';
  return `
    <div class="d-trump-frame">
      <div class="d-trump-title">TRUMP · КОЗЫРЬ ${suitChar}</div>
      ${trumpMarkup}
      <div class="d-deck-block">
        ${deckMarkup}
        <span class="d-deck-count">${deckN}</span>
      </div>
    </div>
  `;
}

function renderDiscardPile(state: DurakState): string {
  const n = state.discardPile.length;
  if (n === 0) return '';
  const layers = Math.min(3, Math.ceil(n / 6));
  const cards = Array.from({ length: layers })
    .map(() => '<div class="d-discard-card"></div>')
    .join('');
  return `
    <div class="d-discard">
      <div class="d-discard-stack">${cards}</div>
      <span class="d-discard-label">DISCARD · ${n}</span>
    </div>
  `;
}

function renderBotZone(state: DurakState): string {
  const hand = state.hands[BOT] ?? [];
  const backs = hand.map(() => cardBackHtml()).join('');
  const botActive = isBotTurn(state);
  return `
    <div class="d-zone d-zone-bot${botActive ? ' is-active' : ''}">
      <div class="d-zone-plate">
        <span class="d-zone-title">BOT</span>
        <span class="d-zone-title-ru">БОТ</span>
        <span class="d-zone-count">${hand.length} cards</span>
      </div>
      <div class="d-hand">${backs || '<div style="opacity:0.35;font-size:0.7rem;letter-spacing:0.2em;">EMPTY</div>'}</div>
    </div>
  `;
}

function renderPlayArea(state: DurakState): string {
  if (state.table.length === 0) {
    return `<div class="d-play-area"><div class="d-play-empty">СТОЛ · WAITING FOR ATTACK</div></div>`;
  }
  let html = '<div class="d-play-area">';
  for (let i = 0; i < state.table.length; i += 2) {
    const atk = state.table[i]!;
    const def = state.table[i + 1];
    html += '<div class="d-pair">';
    html += cardFaceHtml(atk, { extraClass: 'd-attack-card' });
    if (def) html += cardFaceHtml(def, { extraClass: 'd-defend-card' });
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderPlayerZone(state: DurakState, selected: string | null): string {
  const hand = state.hands[PLAYER] ?? [];
  const phase = state.phase;
  const myTurn =
    (phase === 'attack' && state.currentAttacker === PLAYER) ||
    (phase === 'defend' && state.currentDefender === PLAYER);

  const trumpSuit = state.trumpSuit;
  const topAttack = state.table.length % 2 === 1 ? state.table[state.table.length - 1]! : null;

  const cards = hand
    .map((card) => {
      let playable = false;
      if (myTurn && phase === 'attack') {
        playable = canAttackWith(state, PLAYER, card);
      } else if (myTurn && phase === 'defend' && topAttack && trumpSuit) {
        playable = beats(card, topAttack, trumpSuit);
      }
      return cardFaceHtml(card, {
        selected: selected === card,
        playable,
        disabled: myTurn && !playable,
        clickable: true,
      });
    })
    .join('');

  return `
    <div class="d-zone d-zone-player${myTurn ? ' is-active' : ''}">
      <div class="d-hand">${cards || '<div style="opacity:0.35;font-size:0.7rem;letter-spacing:0.2em;">EMPTY</div>'}</div>
      <div class="d-zone-plate">
        <span class="d-zone-title">YOU</span>
        <span class="d-zone-title-ru">ТЫ</span>
        <span class="d-zone-count">${hand.length} cards</span>
      </div>
    </div>
  `;
}

function phaseSealInfo(state: DurakState): { icon: string; label: string; cls: string } {
  if (state.gameWinner !== null) return { icon: '🏁', label: 'END', cls: '' };
  if (state.phase === 'attack') {
    if (state.currentAttacker === PLAYER) return { icon: '⚔', label: 'ATK', cls: 'is-player-attack' };
    return { icon: '⚔', label: 'BOT', cls: 'is-bot-turn' };
  }
  if (state.phase === 'defend') {
    if (state.currentDefender === PLAYER) return { icon: '🛡', label: 'DEF', cls: 'is-player-defend' };
    return { icon: '🛡', label: 'BOT', cls: 'is-bot-turn' };
  }
  return { icon: '·', label: '···', cls: '' };
}

function renderTopbar(state: DurakState, difficulty: DurakDifficulty): string {
  const seal = phaseSealInfo(state);
  return `
    <div class="d-topbar">
      <button type="button" class="d-exit" data-action="exit">← LOBBY</button>
      <div class="d-title-block">
        <span class="d-overline">ДУРАК</span>
        <span class="d-title">DURAK</span>
        <span class="d-subtitle">36 CARDS · HEADS-UP · ${difficulty.toUpperCase()}</span>
      </div>
      <div class="d-phase-seal ${seal.cls}" title="${seal.label}">
        <span class="d-phase-icon">${seal.icon}</span>
        <span class="d-phase-label">${seal.label}</span>
      </div>
    </div>
  `;
}

function renderControls(state: DurakState, selected: string | null): string {
  const phase = state.phase;
  const buttons: string[] = [];

  if (phase === 'defend' && state.currentDefender === PLAYER && state.table.length % 2 === 1) {
    buttons.push(`<button type="button" class="d-btn danger" data-action="take">TAKE · ВЗЯТЬ</button>`);
  }
  if (phase === 'attack' && state.currentAttacker === PLAYER && state.table.length > 0 && state.table.length % 2 === 0) {
    buttons.push(`<button type="button" class="d-btn" data-action="pass">BITO · БИТО</button>`);
  }
  if (selected) {
    buttons.push(`<button type="button" class="d-btn primary" data-action="play">PLAY · ХОДИТЬ</button>`);
  }

  if (buttons.length === 0) {
    return `<div class="d-hint">${
      isBotTurn(state) ? 'Bot is thinking…' : phase === 'end' ? 'Dealing next round…' : 'Pick a card'
    }</div>`;
  }
  return `<div class="d-controls">${buttons.join('')}</div>`;
}

function renderOutcomeBanner(banner: UIState['banner']): string {
  if (!banner) return '';
  const cls = banner.kind === 'win' ? 'show win' : 'show loss';
  return `<div class="d-outcome-banner ${cls}">${banner.text}<span class="d-outcome-ru">${banner.ruText}</span></div>`;
}

function renderScreen(): void {
  if (!ui) return;
  const container = document.getElementById('screen-durak');
  if (!container) return;
  const { state, selected, banner, difficulty } = ui;

  container.innerHTML = `
    ${renderTopbar(state, difficulty)}
    <div class="d-table">
      <div class="d-felt-pattern" aria-hidden="true"></div>
      <div class="d-spotlight" aria-hidden="true"></div>
      ${renderKhokhlomaCorners()}
      ${renderTrumpFrame(state)}
      ${renderDiscardPile(state)}
      ${renderBotZone(state)}
      ${renderPlayArea(state)}
      ${renderPlayerZone(state, selected)}
      ${renderControls(state, selected)}
      ${renderOutcomeBanner(banner)}
    </div>
  `;

  wireEvents(container);
}

function wireEvents(container: HTMLElement): void {
  container.querySelector('[data-action="exit"]')?.addEventListener('click', exitToLobby);
  container.querySelector('[data-action="take"]')?.addEventListener('click', onTake);
  container.querySelector('[data-action="pass"]')?.addEventListener('click', onPass);
  container.querySelector('[data-action="play"]')?.addEventListener('click', onPlay);

  container.querySelectorAll('.d-zone-player .card[data-card]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!ui || ui.locked) return;
      const card = (el as HTMLElement).dataset['card'];
      if (!card) return;
      const node = el as HTMLElement;
      if (!node.classList.contains('is-playable') && !node.classList.contains('is-selected')) return;
      ui.selected = ui.selected === card ? null : card;
      renderScreen();
    });
  });
}

function isBotTurn(state: DurakState): boolean {
  if (state.gameWinner !== null) return false;
  if (state.phase === 'attack' && state.currentAttacker === BOT) return true;
  if (state.phase === 'defend' && state.currentDefender === BOT) return true;
  return false;
}

function onPlay(): void {
  if (!ui || ui.locked) return;
  const card = ui.selected;
  if (!card) return;
  ui.selected = null;

  if (ui.state.phase === 'attack' && ui.state.currentAttacker === PLAYER) {
    durakAttack(ui.state, PLAYER, card);
  } else if (ui.state.phase === 'defend' && ui.state.currentDefender === PLAYER) {
    const attackCard = ui.state.table[ui.state.table.length - 1];
    if (attackCard) durakDefend(ui.state, PLAYER, attackCard, card);
  }
  progress();
}

function onTake(): void {
  if (!ui || ui.locked) return;
  if (ui.state.phase !== 'defend' || ui.state.currentDefender !== PLAYER) return;
  ui.selected = null;
  durakTake(ui.state, PLAYER);
  progress();
}

function onPass(): void {
  if (!ui || ui.locked) return;
  if (ui.state.phase !== 'attack' || ui.state.currentAttacker !== PLAYER) return;
  ui.selected = null;
  durakPass(ui.state, PLAYER);
  progress();
}

function progress(): void {
  if (!ui) return;
  checkGameOver();
  renderScreen();
  if (ui.state.gameWinner !== null) return;
  scheduleBot();
}

function checkGameOver(): void {
  if (!ui) return;
  if (ui.state.gameWinner !== null) {
    const won = ui.state.gameWinner === PLAYER;
    ui.banner = won
      ? { kind: 'win', text: 'YOU WIN', ruText: 'ПОБЕДА' }
      : { kind: 'loss', text: 'YOU LOSE', ruText: 'ДУРАК' };
    ui.locked = true;
    if (ui.botTimer) clearTimeout(ui.botTimer);
    ui.botTimer = setTimeout(() => {
      if (!ui) return;
      startDurakGame(ui.difficulty);
    }, 2800);
  }
}

function scheduleBot(): void {
  if (!ui) return;
  if (ui.botTimer) clearTimeout(ui.botTimer);
  if (!isBotTurn(ui.state)) return;

  ui.botTimer = setTimeout(() => {
    if (!ui) return;
    const action = decideDurak(ui.state, BOT, ui.difficulty);

    if (action.type === 'attack' && action.card) {
      durakAttack(ui.state, BOT, action.card);
    } else if (action.type === 'defend' && action.card && action.targetCard) {
      durakDefend(ui.state, BOT, action.targetCard, action.card);
    } else if (action.type === 'take') {
      durakTake(ui.state, BOT);
    } else if (action.type === 'pass') {
      durakPass(ui.state, BOT);
    }

    checkGameOver();
    renderScreen();
    if (ui.state.gameWinner === null && isBotTurn(ui.state)) {
      scheduleBot();
    }
  }, thinkDelayMs(ui.difficulty));
}

function exitToLobby(): void {
  if (ui?.botTimer) clearTimeout(ui.botTimer);
  ui = null;
  showScreen('screen-landing');
}

export function startDurakGame(difficulty: DurakDifficulty = 'medium'): void {
  const state = createDurakState(2);
  startDurak(state, defaultRng);
  ui = {
    state,
    difficulty,
    selected: null,
    botTimer: null,
    banner: null,
    locked: false,
  };
  showScreen('screen-durak');
  renderScreen();
  if (isBotTurn(state)) scheduleBot();
}

export function initDurak(): void {
  const soloBtn = document.getElementById('btn-durak');
  const pvpBtn = document.getElementById('btn-durak-pvp');

  soloBtn?.addEventListener('click', () => startDurakGame('medium'));
  pvpBtn?.addEventListener('click', () => {
    alert('PvP for Durak is coming — solo mode is playable today.');
  });
}
