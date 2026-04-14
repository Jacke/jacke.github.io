import { IDS, maybe$ } from './dom.js';
import { chipStackHtml } from './chips.js';

export type LogIcon = 'hand' | 'chip' | 'deck' | 'trophy' | 'fold' | 'check' | 'call' | 'raise' | 'info';
export type LogCategory = 'action' | 'hand' | 'system';

// Inline SVG icons — kept small, recolored by CSS currentColor.
const ICON_SVG: Record<LogIcon, string> = {
  hand: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 7h3V5h2v2h2V5h2v2h3v9H4V7zm2 2v5h8V9H6z"/></svg>`,
  chip: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7"/><path d="M10 3v3M10 14v3M3 10h3M14 10h3M5 5l2 2M13 13l2 2M5 15l2-2M13 7l2-2"/></svg>`,
  deck: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="10" height="14" rx="1.5"/><rect x="7" y="5" width="10" height="14" rx="1.5" fill="rgba(255,255,255,0.04)"/></svg>`,
  trophy: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M5 3h10v3a4 4 0 01-4 4H9a4 4 0 01-4-4V3zm5 9v3h3v2H7v-2h3v-3h0z"/></svg>`,
  fold: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5l10 10M15 5L5 15"/></svg>`,
  check: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/></svg>`,
  call: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h10M11 6l4 4-4 4"/></svg>`,
  raise: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16V4M5 9l5-5 5 5"/></svg>`,
  info: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5v0.5"/></svg>`,
};

export interface LogEntryOptions {
  icon: LogIcon;
  text: string;
  emphasis?: boolean;
  playerIdx?: number;
  category?: LogCategory;
}

export interface LogActionOptions {
  player: number;
  playerName: string;
  action: 'fold' | 'check' | 'call' | 'raise';
  amount: number;
  allIn: boolean;
  isMe: boolean;
}

/** Mirror of DOM log for clipboard-copy support. */
const textBuffer: string[] = [];

// Log state ──────────────────────────────────────────────────────────
let autoScroll = true;
let currentFilter: 'all' | LogCategory = 'all';

export function getAutoScroll(): boolean { return autoScroll; }
export function setAutoScroll(v: boolean): void {
  autoScroll = v;
  const btn = maybe$('log-autoscroll-btn');
  if (btn) btn.classList.toggle('active', v);
  if (v) scrollLogToBottom();
}

export function setFilter(filter: 'all' | LogCategory): void {
  currentFilter = filter;
  const log = maybe$(IDS.actionLog);
  if (log) log.dataset['filter'] = filter;
  document.querySelectorAll('.log-filter-pill').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset['filter'] === filter);
  });
}

export function scrollLogToBottom(): void {
  const log = maybe$(IDS.actionLog);
  if (log) log.scrollTop = log.scrollHeight;
  hideJumpPill();
}

function showJumpPill(): void {
  maybe$('log-jump-latest')?.classList.add('visible');
}
function hideJumpPill(): void {
  maybe$('log-jump-latest')?.classList.remove('visible');
}

/** Attach scroll listener so "jump to latest" pill appears when user scrolls up. */
export function attachLogScrollWatcher(): void {
  const log = maybe$(IDS.actionLog);
  if (!log) return;
  log.addEventListener('scroll', () => {
    const gap = log.scrollHeight - log.scrollTop - log.clientHeight;
    if (gap > 80) {
      autoScroll = false;
      const btn = maybe$('log-autoscroll-btn');
      if (btn) btn.classList.remove('active');
      showJumpPill();
    } else {
      hideJumpPill();
    }
  });
}

// Log entry builders ─────────────────────────────────────────────────

function appendEntry(el: HTMLElement, category: LogCategory, plainText: string): void {
  const log = maybe$(IDS.actionLog);
  if (!log) return;
  el.dataset['cat'] = category;
  log.appendChild(el);
  textBuffer.push(plainText);
  setTimeout(() => el.classList.remove('log-new'), 1800);
  while (log.children.length > 300) {
    log.removeChild(log.firstChild!);
    textBuffer.shift();
  }
  if (autoScroll) scrollLogToBottom();
  else showJumpPill();
}

export function addLog(opts: LogEntryOptions): void {
  const category = opts.category ?? (opts.emphasis ? 'hand' : 'system');
  const entry = document.createElement('div');
  entry.className = 'log-entry log-new' + (opts.emphasis ? ' log-emphasis' : '');
  if (opts.playerIdx !== undefined) entry.dataset['player'] = String(opts.playerIdx);
  entry.innerHTML = `
    <span class="log-icon">${ICON_SVG[opts.icon]}</span>
    <span class="log-text"></span>
  `;
  entry.querySelector('.log-text')!.textContent = opts.text;
  appendEntry(entry, category, opts.text);
}

/** Special hand-marker divider — styled as a separator with the hand number. */
export function logHandDivider(handNum: number): void {
  const entry = document.createElement('div');
  entry.className = 'log-divider log-new';
  entry.innerHTML = `
    <span class="log-divider-line"></span>
    <span class="log-divider-label">HAND · ${handNum}</span>
    <span class="log-divider-line"></span>
  `;
  appendEntry(entry, 'hand', `─── Hand #${handNum} ───`);
}

/** Match-boundary marker — big emphasized divider. */
export function logMatchDivider(label: string): void {
  const entry = document.createElement('div');
  entry.className = 'log-match-divider log-new';
  entry.innerHTML = `
    <span class="match-divider-tag">MATCH</span>
    <span class="match-divider-text"></span>
  `;
  entry.querySelector('.match-divider-text')!.textContent = label;
  appendEntry(entry, 'system', `═══ ${label} ═══`);
}

export function logAction(opts: LogActionOptions): void {
  const icon: LogIcon = opts.action;
  const verbLabel: Record<typeof opts.action, string> = {
    fold: 'folds',
    check: 'checks',
    call: 'calls',
    raise: 'raises to',
  };
  const verb = verbLabel[opts.action];
  const amountText = (opts.action === 'call' || opts.action === 'raise') && opts.amount > 0
    ? `$${opts.amount}${opts.allIn ? ' ALL-IN' : ''}`
    : opts.allIn ? 'ALL-IN' : '';

  const entry = document.createElement('div');
  entry.className = `log-entry log-new log-action log-${opts.action}` + (opts.isMe ? ' log-self' : '');
  entry.dataset['player'] = String(opts.player);
  entry.innerHTML = `
    <span class="log-icon">${ICON_SVG[icon]}</span>
    <span class="log-actor"></span>
    <span class="log-verb"></span>
    <span class="log-amount"></span>
  `;
  entry.querySelector('.log-actor')!.textContent = opts.playerName;
  entry.querySelector('.log-verb')!.textContent = verb;
  entry.querySelector('.log-amount')!.textContent = amountText;

  appendEntry(entry, 'action', `${opts.playerName} ${verb}${amountText ? ' ' + amountText : ''}`);
}

/** Get the full log as plain text (for clipboard copy / download). */
export function logText(): string {
  return textBuffer.join('\n');
}

export function clearLog(): void {
  const log = maybe$(IDS.actionLog);
  if (log) log.innerHTML = '';
  textBuffer.length = 0;
  hideJumpPill();
}

// Pot display ─────────────────────────────────────────────────────────

let lastPotRendered = -1;

export function bumpPot(value: number): void {
  const el = maybe$(IDS.potAmount);
  if (el) el.textContent = String(value);
  if (value === lastPotRendered) return;
  lastPotRendered = value;

  const chipsArea = maybe$('pot-chips-area');
  if (chipsArea) {
    chipsArea.innerHTML = value > 0 ? chipStackHtml(value, { maxVisible: 6, showLabel: false, size: 40 }) : '';
  }

  const potVisual = maybe$('pot-visual');
  if (potVisual) {
    potVisual.classList.remove('grow');
    void (potVisual as HTMLElement).offsetWidth;
    potVisual.classList.add('grow');
  }
}

export function resetPotDisplay(): void {
  lastPotRendered = -1;
}
