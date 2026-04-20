// Durak entry point - wire events between UI and engine

import { $, IDS, showScreen, hideOverlay } from '../ui/dom.js';
import { createDurakState, startDurak, rankOf, suitOf, isTrump, beats, canAttackWith, attack as durakAttack, defend as durakDefend, take as durakTake, pass as durakPass, endRound, MAX_TABLE_CARDS } from './engine.js';
import { decideDurak, thinkDelayMs, type DurakDifficulty } from './bot.js';
import { shuffle, defaultRng } from '../core/cards.js';

// Global state
let durakState = createDurakState(2);
let botTimer: ReturnType<typeof setTimeout> | null = null;
let currentDifficulty: DurakDifficulty = 'medium';
let selectedAttackCard: string | null = null;
let selectedDefendCard: string | null = null;

// Card rendering helpers
const CARD_SYMBOLS: Record<string, string> = {
  s: '♠', h: '♥', d: '♦', c: '♣'
};

function renderCard(card: string, selected: boolean = false): string {
  const rank = card[0];
  const suit = card[1];
  const symbol = CARD_SYMBOLS[suit] || suit;
  const isRed = suit === 'h' || suit === 'd';
  const style = isRed ? 'color:#e55' : 'color:#fff';
  const selStyle = selected ? 'background:#4a4;border-radius:4px;' : '';
  
  return `<span class="d-card" data-card="${card}" style="display:inline-block;width:50px;height:70px;border:1px solid #666;border-radius:6px;padding:8px 4px;margin:2px;font-size:1.4rem;cursor:pointer;${style}${selStyle}" title="${card}">${rank}${symbol}</span>`;
}

function renderTrumpCard(): string {
  if (!durakState.trumpCard) return '<span>None</span>';
  const card = durakState.trumpCard;
  const rank = card[0];
  const suit = card[1];
  const symbol = CARD_SYMBOLS[suit] || suit;
  const isRed = suit === 'h' || suit === 'd';
  return `<span style="font-size:1.4rem;${isRed ? 'color:#e55' : 'color:#fff'}">${rank}${symbol}</span>`;
}

function getCardSymbol(suit: string): string {
  return CARD_SYMBOLS[suit] || suit;
}

function renderTableCards(): string {
  if (durakState.table.length === 0) {
    return '<div style="color:#666;font-size:0.9rem;">table empty</div>';
  }
  
  let html = '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;padding:10px;">';
  for (let i = 0; i < durakState.table.length; i++) {
    const card = durakState.table[i]!;
    const rank = card[0];
    const suit = card[1];
    const symbol = getCardSymbol(suit);
    const isRed = suit === 'h' || suit === 'd';
    html += `<div class="d-table-card" style="display:inline-block;width:45px;height:65px;border:1px solid #555;border-radius:4px;background:#222;padding:6px;font-size:1.1rem;color:${isRed ? '#e55' : '#fff'};text-align:center;">${rank}<br>${symbol}</div>`;
  }
  html += '</div>';
  return html;
}

function renderPlayerHand(playerIndex: number, isAttacker: boolean): string {
  const hand = durakState.hands[playerIndex];
  if (!hand || hand.length === 0) {
    return '<div style="color:#666;">no cards</div>';
  }
  
  let html = '<div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:center;">';
  
  for (const card of hand) {
    const rank = card[0];
    const suit = card[1];
    const symbol = getCardSymbol(suit);
    const isRed = suit === 'h' || suit === 'd';
    
    // Check if card can be played
    let canPlay = false;
    let playAction = '';
    
    if (playerIndex === 0 && durakState.phase === 'attack' && durakState.currentAttacker === 0) {
      canPlay = canAttackWith(durakState, 0, card);
      playAction = 'attack';
    } else if (playerIndex === 0 && durakState.phase === 'defend' && durakState.currentDefender === 0 && durakState.table.length > 0) {
      const attackCard = durakState.table[durakState.table.length - 1]!;
      if (beats(card, attackCard, durakState.trumpSuit!)) {
        canPlay = true;
        playAction = 'defend';
      }
    }
    
    const cursor = canPlay ? 'cursor:pointer;background:#334;' : 'background:#222;opacity:0.5;';
    const borderColor = canPlay ? '#6a6' : '#444';
    const selBorder = (selectedAttackCard === card || selectedDefendCard === card) ? '#afa' : borderColor
    
    html += `<span class="d-hand-card" data-card="${card}" data-action="${playAction}" style="display:inline-block;width:42px;height:60px;border:2px solid ${selBorder};border-radius:4px;padding:4px;font-size:1rem;${cursor}color:${isRed ? '#e55' : '#fff'};user-select:none;text-align:center;">${rank}<br>${symbol}</span>`;
  }
  
  html += '</div>';
  return html;
}

function renderButtons(): string {
  let buttons = '';
  
  // Attack pass button
  if (durakState.phase === 'attack' && !durakState.defenderCanTake) {
    buttons += `<button class="d-btn d-btn-pass" data-action="pass" style="padding:8px 16px;background:#444;border:1px solid #666;color:#fff;border-radius:4px;cursor:pointer;">Pass</button>`;
  }
  
  // Defend take button
  if (durakState.phase === 'defend' && durakState.currentDefender === 0 && durakState.defenderCanTake) {
    buttons += `<button class="d-btn d-btn-take" data-action="take" style="padding:8px 16px;background:#a44;border:1px solid #c66;color:#fff;border-radius:4px;cursor:pointer;margin-left:8px;">Take</button>`;
  }
  
  // Play button (after selecting card)
  if (selectedAttackCard || selectedDefendCard) {
    buttons += `<button class="d-btn d-btn-play" data-action="play" style="padding:8px 20px;background:#4a4;border:1px solid #6a6;color:#fff;border-radius:4px;cursor:pointer;margin-left:8px;">Play</button>`;
  }
  
  return buttons ? `<div style="margin-top:12px;">${buttons}</div>` : '';
}

function renderPhaseIndicator(): string {
  const phaseEmoji: Record<string, string> = {
    'attack': '⚔️',
    'defend': '🛡️',
    'end': '🎉'
  };
  const emoji = phaseEmoji[durakState.phase] || '';
  const statusText: Record<string, string> = {
    'attack': 'Your attack',
    'defend': 'Your defense',
    'end': 'Round over'
  };
  return `<div style="font-size:1rem;margin:8px 0;color:#aaa;">${emoji} ${statusText[durakState.phase] || durakState.phase}</div>`;
}

function renderDeckInfo(): string {
  return `<div style="font-size:0.8rem;color:#666;margin-top:8px;">Deck: ${durakState.deck.length} cards</div>`;
}

function updateDisplay(): void {
  const container = document.getElementById('screen-durak');
  if (!container) return;
  
  const playerHand = renderPlayerHand(0, durakState.currentAttacker === 0);
  const botHand = renderPlayerHand(1, durakState.currentAttacker === 1);
  const tableCards = renderTableCards();
  const buttons = renderButtons();
  const phaseIndicator = renderPhaseIndicator();
  const deckInfo = renderDeckInfo();
  
  container.innerHTML = `
    <div style="max-width:600px;margin:0 auto;padding:20px;color:#fff;text-align:center;">
      <h1 style="font-size:1.8rem;margin-bottom:8px;">♣ DURAK</h1>
      
      <div style="background:#1a1a1a;border-radius:8px;padding:12px;margin:12px 0;">
        <div style="font-size:0.8rem;color:#888;">TRUMP</div>
        ${renderTrumpCard()}
        ${deckInfo}
      </div>
      
      ${phaseIndicator}
      
      <div style="background:#222;border-radius:8px;padding:12px;margin:12px 0;min-height:100px;">
        <div style="font-size:0.75rem;color:#666;margin-bottom:6px;">Bot (defender)</div>
        <div style="opacity:0.6;">${botHand}</div>
      </div>
      
      ${tableCards}
      
      <div style="background:#222;border-radius:8px;padding:12px;margin:12px 0;min-height:100px;">
        <div style="font-size:0.75rem;color:#666;margin-bottom:6px;">Your hand</div>
        ${playerHand}
        ${buttons}
      </div>
      
      <button class="d-exit" onclick="document.getElementById('screen-landing').classList.add('active');document.getElementById('screen-durak').classList.remove('active');" style="margin-top:20px;padding:8px 16px;background:#333;border:1px solid #555;color:#888;border-radius:4px;cursor:pointer;">← Exit</button>
    </div>
  `;
  
  // Attach event listeners
  attachCardListeners();
  attachButtonListeners();
}

function attachCardListeners(): void {
  document.querySelectorAll('.d-hand-card[data-card]').forEach(el => {
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const card = target.dataset['card'];
      const action = target.dataset['action'];
      
      if (!card || !action) return;
      
      if (action === 'attack' && durakState.phase === 'attack') {
        selectedAttackCard = selectedAttackCard === card ? null : card;
        selectedDefendCard = null;
        updateDisplay();
      } else if (action === 'defend' && durakState.phase === 'defend') {
        selectedDefendCard = selectedDefendCard === card ? null : card;
        selectedAttackCard = null;
        updateDisplay();
      }
    });
  });
}

function attachButtonListeners(): void {
  // Pass button
  document.querySelector('.d-btn-pass')?.addEventListener('click', () => {
    if (durakState.phase === 'attack' && durakState.currentAttacker === 0) {
      durakPass(durakState, 0);
      processBotTurn();
    }
  });
  
  // Take button
  document.querySelector('.d-btn-take')?.addEventListener('click', () => {
    if (durakState.phase === 'defend' && durakState.currentDefender === 0) {
      durakTake(durakState, 0);
      processBotTurn();
    }
  });
  
  // Play button
  document.querySelector('.d-btn-play')?.addEventListener('click', () => {
    handlePlayAction();
  });
}

function handlePlayAction(): void {
  if (!selectedAttackCard && !selectedDefendCard) return;
  
  if (selectedAttackCard && durakState.phase === 'attack') {
    durakAttack(durakState, 0, selectedAttackCard);
    selectedAttackCard = null;
  } else if (selectedDefendCard && durakState.phase === 'defend') {
    const attackCard = durakState.table[durakState.table.length - 1];
    if (attackCard) {
      durakDefend(durakState, 0, attackCard, selectedDefendCard);
      selectedDefendCard = null;
    }
  }
  
  // Check if round ended
  if (durakState.phase === 'end' || durakState.roundWinner !== null) {
    const winner = durakState.roundWinner;
    if (winner !== null) {
      endRound(durakState, winner);
    }
    durakState.roundWinner = null;
  }
  
  updateDisplay();
  
  // Bot turn after player action
  setTimeout(() => processBotTurn(), 500);
}

function processBotTurn(): void {
  if (botTimer) clearTimeout(botTimer);
  
  const delay = thinkDelayMs(currentDifficulty);
  botTimer = setTimeout(() => {
    const botIdx = 1;
    const action = decideDurak(durakState, botIdx, currentDifficulty);
    console.log('[durak] Bot action:', action);
    
    if (action.type === 'attack' && action.card) {
      durakAttack(durakState, botIdx, action.card);
    } else if (action.type === 'defend' && action.card && action.targetCard) {
      durakDefend(durakState, botIdx, action.targetCard, action.card);
    } else if (action.type === 'take') {
      durakTake(durakState, botIdx);
    } else if (action.type === 'pass') {
      durakPass(durakState, botIdx);
    }
    
    // Check for game end
    if (durakState.gameWinner !== null) {
      alert(durakState.gameWinner === 0 ? '🎉 You win!' : '💀 You lose!');
      startDurakGame(currentDifficulty);
      return;
    }
    
    // Check for round end
    if (durakState.phase === 'end') {
      durakState.roundWinner = null;
      durakState.phase = 'attack';
    }
    
    updateDisplay();
  }, delay);
}

export function startDurakGame(difficulty: DurakDifficulty = 'medium'): void {
  currentDifficulty = difficulty;
  durakState = createDurakState(2);
  const events = startDurak(durakState, defaultRng);
  
  console.log('[durak] Starting game:', events);
  
  showScreen('screen-durak');
  updateDisplay();
}

export function initDurak(): void {
  const soloBtn = document.getElementById('btn-durak');
  const pvpBtn = document.getElementById('btn-durak-pvp');
  
  soloBtn?.addEventListener('click', () => {
    console.log('[durak] Starting solo game');
    startDurakGame('medium');
  });
  
  pvpBtn?.addEventListener('click', () => {
    console.log('[durak] Starting PvP game');
  });
}