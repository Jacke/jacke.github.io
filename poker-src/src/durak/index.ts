// Durak UI + turn driver. Engine lives in ./engine.ts.

import { showScreen } from '../ui/dom.js';
import {
  createDurakState,
  startDurak,
  rankOf,
  suitOf,
  isTrump,
  beats,
  canAttackWith,
  attack as durakAttack,
  defend as durakDefend,
  take as durakTake,
  pass as durakPass,
  MAX_TABLE_CARDS,
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
  banner: { kind: 'win' | 'loss' | 'round'; text: string } | null;
  locked: boolean;
}

let ui: UIState | null = null;

function rankLabel(card: string): string {
  return card[0] === 'T' ? '10' : card[0]!;
}

function cardFaceHtml(card: string, opts: { selected?: boolean; playable?: boolean; disabled?: boolean; extraClass?: string; clickable?: boolean } = {}): string {
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
      <div class="card-back"><span class="card-back-logo">JACKE</span></div>
    </div>
  `;
}

function renderTrumpCorner(state: DurakState): string {
  const deckN = state.deck.length;
  const trump = state.trumpCard;
  const deckClass = deckN === 0 ? 'd-deck empty' : 'd-deck';
  const deckStack = deckN > 0
    ? `<div class="${deckClass}">
         <div class="d-deck-card"></div>
         <div class="d-deck-card"></div>
         <div class="d-deck-card"></div>
       </div>`
    : `<div class="${deckClass}"></div>`;
  const trumpCard = trump
    ? cardFaceHtml(trump, { extraClass: 'd-trump-card' })
    : '<div class="d-trump-label" style="opacity:0.4">NO TRUMP</div>';
  return `
    <div class="d-trump-corner">
      ${trumpCard}
      ${deckStack}
      <div class="d-deck-count">DECK ${deckN}</div>
      <div class="d-trump-label">TRUMP ${trump ? SUIT_SYM[suitOf(trump)] : ''}</div>
    </div>
  `;
}

function renderBotHand(state: DurakState): string {
  const hand = state.hands[BOT] ?? [];
  const backs = hand.map(() => cardBackHtml()).join('');
  const botActive = isBotTurn(state);
  return `
    <div class="d-zone d-zone-bot${botActive ? ' is-active' : ''}">
      <div class="d-zone-plate">
        <span class="d-zone-title">BOT</span>
        <span class="d-zone-count">${hand.length} cards</span>
      </div>
      <div class="d-hand">${backs || '<div style="opacity:0.35;font-size:0.7rem;letter-spacing:0.2em;">EMPTY</div>'}</div>
    </div>
  `;
}

function renderPlayArea(state: DurakState): string {
  if (state.table.length === 0) {
    return `<div class="d-play-area"><div class="d-play-empty">Table · Waiting for attack</div></div>`;
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

function renderPlayerHand(state: DurakState, selected: string | null): string {
  const hand = state.hands[PLAYER] ?? [];
  const phase = state.phase;
  const myTurn =
    (phase === 'attack' && state.currentAttacker === PLAYER) ||
    (phase === 'defend' && state.currentDefender === PLAYER);

  const trumpSuit = state.trumpSuit;
  const topAttack = state.table.length % 2 === 1 ? state.table[state.table.length - 1]! : null;

  const cards = hand.map((card) => {
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
  }).join('');

  return `
    <div class="d-zone d-zone-player${myTurn ? ' is-active' : ''}">
      <div class="d-hand">${cards || '<div style="opacity:0.35;font-size:0.7rem;letter-spacing:0.2em;">EMPTY</div>'}</div>
      <div class="d-zone-plate">
        <span class="d-zone-title">YOU</span>
        <span class="d-zone-count">${hand.length} cards</span>
      </div>
    </div>
  `;
}

function phaseLabel(state: DurakState): { text: string; cls: string } {
  if (state.gameWinner !== null) return { text: 'GAME OVER', cls: '' };
  if (state.phase === 'end') return { text: 'ROUND END', cls: '' };
  if (state.phase === 'attack') {
    return state.currentAttacker === PLAYER
      ? { text: 'YOUR ATTACK', cls: 'is-attack' }
      : { text: 'BOT ATTACKS', cls: 'is-attack' };
  }
  if (state.phase === 'defend') {
    return state.currentDefender === PLAYER
      ? { text: 'YOUR DEFENSE', cls: 'is-defend' }
      : { text: 'BOT DEFENDS', cls: 'is-defend' };
  }
  return { text: state.phase.toUpperCase(), cls: '' };
}

function renderControls(state: DurakState, selected: string | null): string {
  const phase = state.phase;
  const buttons: string[] = [];

  if (phase === 'defend' && state.currentDefender === PLAYER && state.table.length % 2 === 1) {
    buttons.push(`<button type="button" class="d-btn danger" data-action="take">TAKE</button>`);
  }
  if (phase === 'attack' && state.currentAttacker === PLAYER && state.table.length > 0 && state.table.length % 2 === 0) {
    buttons.push(`<button type="button" class="d-btn" data-action="pass">PASS</button>`);
  }
  if (selected) {
    buttons.push(`<button type="button" class="d-btn primary" data-action="play">PLAY</button>`);
  }

  if (buttons.length === 0) {
    return `<div class="d-hint">${
      isBotTurn(state) ? 'Bot is thinking…' : phase === 'end' ? 'Dealing next round…' : 'Pick a card'
    }</div>`;
  }
  return `<div class="d-controls">${buttons.join('')}</div>`;
}

function renderOutcomeBanner(banner: UIState['banner']): string {
  if (!banner) return `<div class="d-outcome-banner"></div>`;
  const cls = banner.kind === 'win' ? 'show win' : banner.kind === 'loss' ? 'show loss' : 'show';
  return `<div class="d-outcome-banner ${cls}">${banner.text}</div>`;
}

function renderScreen(): void {
  if (!ui) return;
  const container = document.getElementById('screen-durak');
  if (!container) return;
  const { state, selected, banner } = ui;
  const phase = phaseLabel(state);

  container.innerHTML = `
    <div class="d-topbar">
      <button type="button" class="d-exit" data-action="exit">← LOBBY</button>
      <div class="d-title-block">
        <span class="d-title">DURAK</span>
        <span class="d-subtitle">36 CARDS · HEADS-UP · ${state.difficulty?.toString().toUpperCase() ?? ui.difficulty.toUpperCase()}</span>
      </div>
      <span class="d-phase-badge ${phase.cls}">${phase.text}</span>
    </div>
    <div class="d-table">
      <div class="d-felt-pattern" aria-hidden="true"></div>
      ${renderTrumpCorner(state)}
      ${renderBotHand(state)}
      ${renderPlayArea(state)}
      ${renderPlayerHand(state, selected)}
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
      if (!(el as HTMLElement).classList.contains('is-playable') && !(el as HTMLElement).classList.contains('is-selected')) return;
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
    ui.banner = { kind: won ? 'win' : 'loss', text: won ? 'YOU WIN' : 'YOU LOSE' };
    ui.locked = true;
    // auto-restart after banner animates
    if (ui.botTimer) clearTimeout(ui.botTimer);
    ui.botTimer = setTimeout(() => {
      if (!ui) return;
      startDurakGame(ui.difficulty);
    }, 2400);
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
    } else {
      // Bot is stuck (no valid action) — end the round in defender's favor
      // to keep play moving. Edge case; shouldn't normally hit.
      console.warn('[durak] bot returned none; forcing pass');
    }

    checkGameOver();
    renderScreen();
    if (ui.state.gameWinner === null && isBotTurn(ui.state)) {
      // Bot may need another turn (e.g. still attacking)
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
