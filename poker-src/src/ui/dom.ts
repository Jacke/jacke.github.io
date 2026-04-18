/**
 * DOM ID constants and element lookups.
 * All raw `document.getElementById` calls go through here so renaming an ID
 * is a single-file change.
 */

export const IDS = {
  // Screens
  screenLanding: 'screen-landing',
  screenWaiting: 'screen-waiting',
  screenReady: 'screen-ready',
  screenGame: 'screen-game',
  screenBlackjack: 'screen-blackjack',
  // Overlays
  overlayName: 'overlay-name',
  overlayShowdown: 'overlay-showdown',
  overlayDisconnected: 'overlay-disconnected',
  overlayError: 'overlay-error',
  // Waiting room
  roomCodeDisplay: 'room-code-display',
  shareLinkInput: 'share-link-input',
  copyLinkBtn: 'copy-link-btn',
  // Ready screen
  readyYouName: 'ready-you-name',
  readyOppName: 'ready-opp-name',
  readyDotYou: 'ready-dot-you',
  readyDotOpp: 'ready-dot-opp',
  readyBtn: 'ready-btn',
  // Game — players
  yourNameLabel: 'your-name-label',
  oppNameLabel: 'opp-name-label',
  yourChips: 'your-chips',
  oppChips: 'opp-chips',
  yourBadge: 'your-badge',
  oppBadge: 'opp-badge',
  yourBetLabel: 'your-bet-label',
  oppBetLabel: 'opp-bet-label',
  // Game — cards
  yourHoleCards: 'your-hole-cards',
  oppHoleCards: 'opp-hole-cards',
  communityCards: 'community-cards',
  // Game — betting
  potAmount: 'pot-amount',
  actionLog: 'action-log',
  phaseLabel: 'phase-label',
  btnFold: 'btn-fold',
  btnCall: 'btn-call',
  btnRaise: 'btn-raise',
  raiseInput: 'raise-input',
  raiseUp: 'raise-up',
  raiseDn: 'raise-dn',
  actionStatus: 'action-status',
  // Connection indicator
  connIndicator: 'conn-indicator',
  connDot: 'conn-dot',
  connLabel: 'conn-label',
  // Overlays — content
  nameInput: 'name-input',
  btnConfirmName: 'btn-confirm-name',
  btnCreateGame: 'btn-create-game',
  btnFindMatch: 'btn-find-match',
  btnBotEasy: 'btn-bot-easy',
  btnBotMedium: 'btn-bot-medium',
  btnBotHard: 'btn-bot-hard',
  showdownWinnerTitle: 'showdown-winner-title',
  showdownBody: 'showdown-body',
  showdownNextBtn: 'showdown-next-btn',
  showdownNewGameBtn: 'showdown-new-game-btn',
  btnErrorOk: 'btn-error-ok',
  errorBody: 'error-body',
  btnNewGameDc: 'btn-new-game-dc',
} as const;

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

export function maybe$(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function showScreen(id: string): void {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  maybe$(id)?.classList.add('active');
}

export function showOverlay(id: string): void {
  document.querySelectorAll('.overlay').forEach(o => o.classList.remove('visible'));
  maybe$(id)?.classList.add('visible');
}

export function hideOverlay(id: string): void {
  maybe$(id)?.classList.remove('visible');
}

export function setConnStatus(state: 'connecting' | 'connected' | 'error', label: string): void {
  const dot = maybe$(IDS.connDot);
  const lbl = maybe$(IDS.connLabel);
  const ind = maybe$(IDS.connIndicator);
  if (dot) dot.className = 'conn-dot ' + state;
  if (lbl) lbl.textContent = label;
  if (ind) ind.classList.add('visible');
}

export function getParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}
