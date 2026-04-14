import type { Card, GameState, GameConfig, GameVariant } from './core/types.js';
import { DEFAULT_CONFIG } from './core/types.js';
import { makeDeck, makeVariantDeck, shuffle, genRoomId } from './core/cards.js';
import {
  applyAction, createGameState, dealHand, finishToShowdown, legalActions,
  nextStreet, startNextHand, type EngineEvent,
} from './core/engine.js';
import { BB_AMOUNT, callAmount, minRaiseAmount } from './core/rules.js';
import { bestHand } from './core/hands.js';

import type { Message, ActionMessage } from './protocol/messages.js';
import { BroadcastTransport } from './transports/broadcast.js';
import { PeerJSTransport, type Role } from './transports/peerjs.js';
import { decideAction, monteCarloEquity, thinkDelayMs, type Difficulty } from './bot/bot.js';

import { IDS, $, maybe$, getParam, hideOverlay, setConnStatus, showOverlay, showScreen } from './ui/dom.js';
import {
  addLog, logAction, logText, clearLog, bumpPot,
  logHandDivider, logMatchDivider,
  setAutoScroll, setFilter, scrollLogToBottom, attachLogScrollWatcher,
} from './ui/log.js';
import { renderTable, updateActionUI } from './ui/render.js';
import { loadSettings, applySettings, saveSettings, type Settings } from './ui/settings.js';
import { recordHandStart, recordAction, recordHandEnd, saveMatch, loadMatch, clearMatch, hasMatch } from './ui/match-recorder.js';
import { rulesHtml } from './ui/rules-content.js';
import { flyChip, breakdownHtml, setChipStyle } from './ui/chips.js';
import { setBgAnimation } from './ui/bg-animation.js';
import { renderHandMeter, renderPotOdds, updatePresetButtons } from './ui/gameplay-ux.js';
import {
  sfxChipDrop, sfxCardDeal, sfxCheck, sfxCall, sfxRaise, sfxFold, sfxWin, sfxLose,
  setSoundEnabled, unlockAudio,
} from './ui/sfx.js';
import {
  buyIn, commitMatch, loadBank, loadHistory, formatMatchSummary, clearHistory, resetBank, saveBank,
  computeStats, sparklineSvg,
} from './ui/bank.js';
import { createSession, saveSession, loadSession, clearSession, sessionSummary, type GameSession } from './ui/session.js';

// ═══════════════════════════════════════════════════════════════════════
// App state
// ═══════════════════════════════════════════════════════════════════════

type Mode = 'pvp' | 'bot';

interface App {
  state: GameState;
  mode: Mode;
  botDifficulty: Difficulty;
  /** Bot difficulty per seat (for multi-bot). seat 0 = human = unused. */
  botDifficulties: Difficulty[];
  numPlayers: number;
  role: Role;
  roomId: string;
  myName: string;
  /** Name of the "other" (for PvP — first peer). Multi-bot uses state.names. */
  oppName: string;
  bc: BroadcastTransport | null;
  peer: PeerJSTransport | null;
  activeTransport: 'bc' | 'webrtc' | null;
  myReady: boolean;
  oppReady: boolean;
  myNextReady: boolean;
  oppNextReady: boolean;
  botTimer: ReturnType<typeof setTimeout> | null;
  /** Chips the human started this match with — for bank delta. */
  matchStartChips: number;
  /** Hand counter within this match. */
  matchHandCount: number;
  /** Unique session ID for resume. */
  sessionId: string | null;
  /** Current game config (variant, betting structure, etc.) */
  gameConfig: GameConfig;
}

const app: App = {
  state: createGameState(2, 0, ['You', 'Opponent']),
  mode: 'pvp',
  botDifficulty: 'medium',
  botDifficulties: ['medium', 'medium', 'medium', 'medium', 'medium', 'medium'],
  numPlayers: 2,
  role: 'host',
  roomId: '',
  myName: 'Host',
  oppName: 'Opponent',
  bc: null,
  peer: null,
  activeTransport: null,
  myReady: false,
  oppReady: false,
  myNextReady: false,
  oppNextReady: false,
  botTimer: null,
  matchStartChips: 0,
  matchHandCount: 0,
  sessionId: null,
  gameConfig: DEFAULT_CONFIG,
};

// ═══════════════════════════════════════════════════════════════════════
// Transport wiring (PvP only — bot mode skips all of this)
// ═══════════════════════════════════════════════════════════════════════

function send(msg: Message): void {
  if (app.mode === 'bot') return;
  if (app.activeTransport === 'bc' && app.bc) {
    try { app.bc.send(msg); } catch (e) { console.error('[poker] bc send error', e); }
    return;
  }
  if (app.peer && app.peer.status() === 'open') {
    try { app.peer.send(msg); } catch (e) { console.error('[poker] webrtc send error', e); }
    return;
  }
  console.warn('[poker] send with no active transport', msg);
}

function startTransports(roomId: string): void {
  app.bc = new BroadcastTransport(roomId, app.myName);
  app.bc.on('open', () => {
    if (app.activeTransport === 'webrtc') return;
    app.activeTransport = 'bc';
    setConnStatus('connected', 'Connected');
  });
  app.bc.on('message', (msg) => {
    if (app.activeTransport === 'webrtc') return;
    if (!app.activeTransport) {
      app.activeTransport = 'bc';
      setConnStatus('connected', 'Connected');
    }
    handleMessage(msg);
  });

  app.peer = new PeerJSTransport({
    roomId,
    role: app.role,
    onRoleChange: (newRole) => {
      app.role = newRole;
      app.state.myIndex = newRole === 'host' ? 0 : 1;
      $(IDS.yourNameLabel).textContent = app.myName;
    },
  });
  app.peer.on('status', (s, label) => {
    if (app.activeTransport === 'bc') return;
    const uiState = s === 'open' ? 'connected' : s === 'error' ? 'error' : 'connecting';
    setConnStatus(uiState as 'connecting' | 'connected' | 'error', label ?? '');
  });
  app.peer.on('open', () => {
    if (app.activeTransport === 'bc') return;
    app.activeTransport = 'webrtc';
    setConnStatus('connected', 'Connected');
    send({ type: 'hello', name: app.myName });
  });
  app.peer.on('message', (msg) => {
    if (app.activeTransport === 'bc') return;
    if (!app.activeTransport) app.activeTransport = 'webrtc';
    handleMessage(msg);
  });
  app.peer.on('close', () => {
    if (!maybe$(IDS.screenLanding)?.classList.contains('active')) {
      showOverlay(IDS.overlayDisconnected);
    }
  });
  app.peer.on('error', () => {});
}

// ═══════════════════════════════════════════════════════════════════════
// Incoming message dispatch
// ═══════════════════════════════════════════════════════════════════════

function handleMessage(msg: Message): void {
  switch (msg.type) {
    case 'hello':
      app.oppName = msg.name || 'Opponent';
      app.state.names[1] = app.oppName;
      $(IDS.readyOppName).textContent = app.oppName;
      $(IDS.oppNameLabel).textContent = app.oppName;
      setConnStatus('connected', 'Connected');
      if (
        maybe$(IDS.screenWaiting)?.classList.contains('active') ||
        maybe$(IDS.screenLanding)?.classList.contains('active')
      ) {
        showScreen(IDS.screenReady);
        $(IDS.readyYouName).textContent = app.myName;
        $(IDS.readyOppName).textContent = app.oppName;
      }
      break;

    case 'ready':
      app.oppReady = true;
      maybe$(IDS.readyDotOpp)?.classList.add('ready-yes');
      maybeStartGame();
      break;

    case 'deal':
      if (app.role !== 'host') {
        app.state.buttonIndex = msg.button;
        app.state.handNum = msg.handNum - 1;
        runDealHand(msg.deck);
      }
      break;

    case 'action':
      if (app.state.actingPlayer !== app.state.myIndex) {
        applyRemoteAction(msg);
      }
      break;

    case 'next_hand':
      app.oppNextReady = true;
      if (app.myNextReady) doStartNextHand();
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Ready barrier
// ═══════════════════════════════════════════════════════════════════════

function maybeStartGame(): void {
  if (!app.myReady || !app.oppReady) return;
  hideOverlay(IDS.overlayName);
  setTimeout(() => {
    app.myNextReady = false;
    app.oppNextReady = false;
    if (app.role === 'host') hostStartHand();
    else showScreen(IDS.screenGame);
  }, 600);
}

// ═══════════════════════════════════════════════════════════════════════
// Hand lifecycle
// ═══════════════════════════════════════════════════════════════════════

function hostStartHand(): void {
  showScreen(IDS.screenGame);
  const deck = shuffle(makeDeck());
  send({
    type: 'deal',
    deck,
    button: app.state.buttonIndex as 0 | 1,
    handNum: app.state.handNum + 1,
  });
  runDealHand(deck);
}

function runDealHand(deck: Card[]): void {
  showScreen(IDS.screenGame);
  const events = dealHand(app.state, deck);
  recordHandStart(deck, app.state.buttonIndex, app.state.handNum);
  logEvents(events);
  renderTable(app.state);
  updateActionUI(app.state);
  refreshPlayerUX();

  // Kick bot if it's first to act.
  scheduleBotIfNeeded();
}

/** Re-render hand strength meter, pot odds and preset availability. */
function refreshPlayerUX(): void {
  const s = app.state;
  renderHandMeter(s);
  const isMyTurn = s.actingPlayer === s.myIndex && s.phase !== 'idle' && s.phase !== 'showdown';
  updatePresetButtons(isMyTurn);
  // Rough equity for the widget — reuse the bot's monte-carlo with a small
  // sample size so it's quick. Only compute when we actually have cards.
  if (isMyTurn && s.holeCards[s.myIndex]) {
    // Set actingPlayer already points at us here; monteCarloEquity reads it.
    const eq = s.community.length === 0
      ? preflopRoughEquity(s.holeCards[s.myIndex]!)
      : monteCarloEquity(s, 200) * 100;
    renderPotOdds(s, eq);
  } else {
    renderPotOdds(s, null);
  }
}

/**
 * Apply a raise preset: "0.5", "0.67", "1", "1.5" (fractions of pot) or "allin".
 * Computes the target total bet, snaps to legal range, stuffs the raise input.
 */
function applyRaisePreset(preset: string): void {
  const s = app.state;
  const me = s.myIndex;
  const maxTotal = (s.stacks[me] ?? 0) + (s.bets[me] ?? 0);
  const minTotal = Math.min(minRaiseAmount(s), maxTotal);
  let target: number;
  if (preset === 'allin') {
    target = maxTotal;
  } else {
    const pct = parseFloat(preset);
    if (isNaN(pct)) return;
    // "Pot-sized raise" = top bet + pot * pct (after our call).
    let topBet = 0;
    for (const b of s.bets) if (b > topBet) topBet = b;
    const toCall = callAmount(s);
    const potAfterCall = s.pot + toCall;
    target = topBet + Math.round(potAfterCall * pct);
  }
  target = Math.max(minTotal, Math.min(target, maxTotal));
  const input = maybe$(IDS.raiseInput) as HTMLInputElement | null;
  if (!input) return;
  input.value = String(target);
  input.dataset['touched'] = '1';
  // Auto-submit the raise for fast play.
  maybe$(IDS.btnRaise)?.click();
}

/** Cheap preflop equity approximation so we don't spin up MC preflop. */
function preflopRoughEquity(hole: readonly [string, string]): number {
  const VALS: Record<string, number> = {
    '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14,
  };
  const c0 = hole[0] ?? '2s';
  const c1 = hole[1] ?? '2h';
  const hi = Math.max(VALS[c0[0] ?? '2'] ?? 2, VALS[c1[0] ?? '2'] ?? 2);
  const lo = Math.min(VALS[c0[0] ?? '2'] ?? 2, VALS[c1[0] ?? '2'] ?? 2);
  const pair = c0[0] === c1[0];
  const suited = c0[1] === c1[1];
  // Very rough lookup — tuned by feel, not by a Sklansky chart.
  let eq = 35 + (hi - 2) * 3 + (lo - 2) * 1.2;
  if (pair) eq = 52 + (hi - 2) * 3.2;
  if (suited && !pair) eq += 4;
  const gap = hi - lo;
  if (gap === 1 && !pair) eq += 2;
  return Math.max(18, Math.min(88, eq));
}

function logEvents(events: ReadonlyArray<EngineEvent>): void {
  for (const e of events) {
    switch (e.kind) {
      case 'hand-start':
        logHandDivider(e.handNum);
        sfxCardDeal();
        break;
      case 'blinds-posted': {
        const sbName = nameOf(e.sb.player);
        const bbName = nameOf(e.bb.player);
        addLog({
          icon: 'chip',
          text: `Blinds: ${sbName} $${e.sb.amount} · ${bbName} $${e.bb.amount}`,
        });
        break;
      }
      case 'action': {
        logAction({
          player: e.player,
          playerName: nameOf(e.player),
          action: e.action.kind,
          amount: e.action.kind === 'raise' ? (e.action.amount ?? 0) : e.effective,
          allIn: e.allIn,
          isMe: e.player === app.state.myIndex,
        });
        // Sound effect per action kind.
        switch (e.action.kind) {
          case 'fold':  sfxFold(); break;
          case 'check': sfxCheck(); break;
          case 'call':  sfxCall(); sfxChipDrop(); break;
          case 'raise': sfxRaise(); sfxChipDrop(); break;
        }
        // Fly a chip from the acting seat to the pot when money goes in.
        if ((e.action.kind === 'call' || e.action.kind === 'raise') && e.effective > 0) {
          const seat = document.querySelector(`[data-seat="${e.player}"]`);
          const pot  = maybe$('pot-visual');
          const chipCount = Math.min(5, 1 + Math.floor(Math.log10(e.effective + 1)));
          flyChip(seat, pot, { amount: e.effective, count: chipCount });
        }
        bumpPot(app.state.pot);
        break;
      }
      case 'community': {
        const label = e.phase === 'flop' ? 'Flop' : e.phase === 'turn' ? 'Turn' : 'River';
        addLog({ icon: 'deck', text: `${label}: ${e.cards.join(' ')}`, emphasis: true });
        break;
      }
      case 'award': {
        for (const pot of e.pots) {
          const winners = pot.winners.map(nameOf).join(' & ');
          addLog({ icon: 'trophy', text: `${winners} wins $${pot.amount}`, emphasis: true });
          // Sound: win/lose from the human's perspective.
          if (pot.winners.includes(app.state.myIndex)) sfxWin();
          else if (app.state.folded[app.state.myIndex]) sfxLose();
          // Fly chips from pot back to each winner.
          const potEl = maybe$('pot-visual');
          for (const w of pot.winners) {
            const seat = document.querySelector(`[data-seat="${w}"]`);
            const share = Math.floor(pot.amount / pot.winners.length);
            const chipCount = Math.min(6, 2 + Math.floor(Math.log10(share + 1)));
            flyChip(potEl, seat, { amount: share, count: chipCount, reverse: true, delay: 200 });
          }
        }
        break;
      }
      default:
        break;
    }
  }
}

function nameOf(idx: number): string {
  if (idx === 0) return app.mode === 'bot' ? 'You' : app.myName;
  if (app.mode === 'bot') return app.state.names[idx] ?? `Bot ${idx}`;
  return app.oppName;
}

/** Get display name for a game variant */
function getVariantLabel(variant: GameVariant): string {
  const labels: Record<GameVariant, string> = {
    holdem: 'Hold\'em',
    omaha: 'Omaha',
    shortdeck: 'Short Deck',
    pineapple: 'Pineapple',
    crazypineapple: 'Crazy Pineapple',
    irish: 'Irish',
  };
  return labels[variant] || 'Hold\'em';
}

// ═══════════════════════════════════════════════════════════════════════
// Action input
// ═══════════════════════════════════════════════════════════════════════

function doLocalAction(action: ActionMessage['action'], amount?: number): void {
  if (app.state.actingPlayer !== app.state.myIndex) return;
  const engineAction = action === 'raise' ? { kind: 'raise' as const, amount } : { kind: action };
  const result = applyAction(app.state, app.state.myIndex, engineAction);
  recordAction(app.state.myIndex, action, amount);
  logEvents(result.events);
  renderTable(app.state);
  updateActionUI(app.state);
  send({
    type: 'action',
    player: app.state.myIndex as 0 | 1,
    action,
    ...(amount !== undefined ? { amount } : {}),
  });
  handlePostAction(result);
}

function applyRemoteAction(msg: ActionMessage): void {
  const action = msg.action === 'raise'
    ? { kind: 'raise' as const, amount: msg.amount ?? 0 }
    : { kind: msg.action };
  const actor = app.state.actingPlayer;
  const result = applyAction(app.state, actor, action);
  recordAction(actor, msg.action, msg.amount);
  logEvents(result.events);
  renderTable(app.state);
  updateActionUI(app.state);
  handlePostAction(result);
}

function handlePostAction(result: { roundClosed: boolean; handEnded: boolean }): void {
  if (result.handEnded) {
    finalizeHand('fold');
    return;
  }
  if (!result.roundClosed) {
    refreshPlayerUX();
    scheduleBotIfNeeded();
    return;
  }

  const noMore = actorCountLocal() <= 1;
  if (noMore) {
    setTimeout(() => {
      const events = finishToShowdown(app.state);
      logEvents(events);
      renderTable(app.state, true);
      finalizeHand('showdown');
    }, 500);
  } else {
    setTimeout(() => {
      const events = nextStreet(app.state);
      logEvents(events);
      if (app.state.phase === 'showdown') {
        renderTable(app.state, true);
        finalizeHand('showdown');
      } else {
        renderTable(app.state);
        updateActionUI(app.state);
        refreshPlayerUX();
        scheduleBotIfNeeded();
      }
    }, 400);
  }
}

function actorCountLocal(): number {
  let c = 0;
  for (let i = 0; i < app.state.numPlayers; i++) {
    if (!app.state.folded[i] && !app.state.allIn[i]) c++;
  }
  return c;
}

// ═══════════════════════════════════════════════════════════════════════
// Bot scheduling
// ═══════════════════════════════════════════════════════════════════════

function scheduleBotIfNeeded(): void {
  if (app.mode !== 'bot') return;
  if (app.botTimer) return;
  const s = app.state;
  if (s.phase === 'idle' || s.phase === 'showdown') return;
  if (s.actingPlayer === s.myIndex) return;
  if (s.folded[s.actingPlayer] || s.allIn[s.actingPlayer]) return;
  const diff = app.botDifficulties[s.actingPlayer] ?? app.botDifficulty;
  const delay = thinkDelayMs(diff);
  app.botTimer = setTimeout(() => {
    app.botTimer = null;
    doBotAction();
  }, delay);
}

function doBotAction(): void {
  if (app.mode !== 'bot') return;
  const s = app.state;
  if (s.phase === 'idle' || s.phase === 'showdown') return;
  if (s.actingPlayer === s.myIndex) return;

  const diff = app.botDifficulties[s.actingPlayer] ?? app.botDifficulty;
  const action = decideAction(s, diff);
  const actor = s.actingPlayer;
  const result = applyAction(s, actor, action);
  recordAction(actor, action.kind, action.kind === 'raise' ? action.amount : undefined);
  logEvents(result.events);
  renderTable(s);
  updateActionUI(s);
  handlePostAction(result);
}

// ═══════════════════════════════════════════════════════════════════════
// Showdown presentation + hand finalization
// ═══════════════════════════════════════════════════════════════════════

function finalizeHand(reason: 'fold' | 'showdown'): void {
  // Gather best hands for each non-folded player for display.
  const hands = new Array(app.state.numPlayers).fill(null);
  if (reason === 'showdown') {
    for (let i = 0; i < app.state.numPlayers; i++) {
      if (app.state.folded[i]) continue;
      const hole = app.state.holeCards[i];
      if (!hole) continue;
      hands[i] = bestHand([...hole, ...app.state.community]);
    }
  }

  // Find winner(s) — for display we pick from the last award event if available;
  // engine already distributed chips. Here we derive display from chip deltas.
  const winnerIdxs: number[] = [];
  // Compare chips to what we started the hand with — we don't track that
  // explicitly but we know one winner has the largest stack gain. Simpler:
  // the engine emitted 'award' events — but we don't have them here. For UX
  // we just mark anyone who has chips still and didn't fold as a "survivor"
  // and highlight the best hand.
  if (reason === 'fold') {
    const survivor = app.state.folded.findIndex(f => !f);
    if (survivor >= 0) winnerIdxs.push(survivor);
  } else {
    let best = -Infinity;
    for (let i = 0; i < app.state.numPlayers; i++) {
      const h = hands[i];
      if (!h) continue;
      if (h.score > best) { best = h.score; winnerIdxs.length = 0; winnerIdxs.push(i); }
      else if (h.score === best) winnerIdxs.push(i);
    }
  }

  // Highlight winning cards
  if (reason === 'showdown' && winnerIdxs.length > 0) {
    const wIdx = winnerIdxs[0]!;
    const wHand = hands[wIdx];
    if (wHand) {
      document.querySelectorAll<HTMLElement>('.card').forEach(el => {
        const s = el.dataset['cardStr'];
        if (s && wHand.cards.includes(s)) el.classList.add('winner-card');
      });
    }
  }
  for (const w of winnerIdxs) {
    document.querySelector(`[data-seat="${w}"]`)?.classList.add('seat-winner');
  }

  recordHandEnd(reason, winnerIdxs);

  const title = winnerIdxs.includes(app.state.myIndex) && winnerIdxs.length === 1
    ? 'You win!'
    : winnerIdxs.length === 1
      ? `${nameOf(winnerIdxs[0]!)} wins`
      : 'Split pot';

  const lines: string[] = [];
  if (reason === 'showdown') {
    for (let i = 0; i < app.state.numPlayers; i++) {
      const h = hands[i];
      if (!h) continue;
      lines.push(`${nameOf(i)}: ${h.name}`);
    }
  } else {
    lines.push(`${title} — opponents folded`);
  }

  // Track hand count for the bank.
  app.matchHandCount++;

  // Save the bank after every hand so progress is never lost if the user
  // exits mid-match (no backend — only localStorage). Bank = chips still at
  // the cashier (saved before the match) + current stack on the table.
  if (app.mode === 'bot') {
    const b = loadBank();
    const offTable = bankRemainderAtMatchStart;
    b.chips = offTable + (app.state.chips[0] ?? 0);
    saveBank(b);
  }
  refreshBankWidget();

  // Persist current session snapshot (for resume).
  if (app.mode === 'bot' && app.sessionId && !app.state.gameOver) {
    saveSession({
      id: app.sessionId,
      mode: 'bot',
      difficulty: app.botDifficulty,
      numPlayers: app.state.numPlayers,
      matchStartChips: app.matchStartChips,
      matchHandCount: app.matchHandCount,
      state: app.state,
      createdAt: 0, // re-set on save
      updatedAt: 0,
    });
  } else if (app.state.gameOver) {
    clearSession();
  }

  showShowdownResult(title, lines.join('\n'), app.state.gameOver);

  if (app.state.gameOver) {
    // Save the completed match (replay buffer)
    saveMatch({ mode: app.mode, numPlayers: app.state.numPlayers, names: app.state.names.slice() });

    if (app.mode === 'bot') {
      // Commit the match: cash out whatever's on the table back into the bank.
      const tableChips = app.state.chips[0] ?? 0;
      const finalBank = bankRemainderAtMatchStart + tableChips;
      const bank = commitMatch({
        startChips: app.matchStartChips,
        endChips: tableChips,
        numPlayers: app.state.numPlayers,
        difficulty: app.botDifficulty,
        hands: app.matchHandCount,
      });
      // commitMatch sets bank.chips = endChips — correct if there was no
      // off-table remainder. Adjust for partial buy-ins.
      bank.chips = finalBank;
      saveBank(bank);
      const delta = tableChips - app.matchStartChips;
      addLog({
        icon: 'trophy',
        text: `Cashed out · ${delta >= 0 ? '+' : ''}$${delta} · Bank now $${finalBank}`,
        emphasis: true,
      });
    }
  }
}

function showShowdownResult(title: string, body: string, isGameOver: boolean): void {
  $(IDS.showdownWinnerTitle).textContent = title;
  const bodyEl = $(IDS.showdownBody);
  bodyEl.textContent = body;
  bodyEl.style.whiteSpace = 'pre-line';

  const nextBtn = $(IDS.showdownNextBtn);
  const newGameBtn = $(IDS.showdownNewGameBtn);
  if (isGameOver) {
    nextBtn.style.display = 'none';
    newGameBtn.style.display = 'inline-flex';
  } else {
    nextBtn.style.display = 'inline-flex';
    newGameBtn.style.display = 'none';
    (nextBtn as HTMLButtonElement).disabled = false;
    nextBtn.textContent = 'Next Hand';
    app.myNextReady = false;
    app.oppNextReady = false;
  }
  setTimeout(() => showOverlay(IDS.overlayShowdown), 800);
}

function doStartNextHand(): void {
  hideOverlay(IDS.overlayShowdown);
  app.myReady = false;
  app.oppReady = false;
  app.myNextReady = false;
  app.oppNextReady = false;
  document.querySelectorAll<HTMLElement>('.seat-winner').forEach(el => el.classList.remove('seat-winner'));
  document.querySelectorAll<HTMLElement>('.winner-card').forEach(el => el.classList.remove('winner-card'));
  startNextHand(app.state);
  if (app.mode === 'bot') {
    hostStartHand();
    return;
  }
  if (app.role === 'host') hostStartHand();
  else showScreen(IDS.screenGame);
}

// ═══════════════════════════════════════════════════════════════════════
// Bot mode bootstrap
// ═══════════════════════════════════════════════════════════════════════

// Silhouette SVG — single "player" glyph (head + shoulders).
const PLAYER_SILHOUETTE = `<svg viewBox="0 0 16 32" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="4"/><path d="M2 30 Q2 16 8 16 Q14 16 14 30 Z"/></svg>`;

/** User-chosen buy-in amount (updated by the slider / preset buttons). */
let chosenBuyIn = 1000;
/** Chips left in the bank (off-table) at the start of the current match. */
let bankRemainderAtMatchStart = 0;

function buildSoloPicker(): void {
  const row = maybe$('count-row');
  if (!row) return;

  // Populate tiles with N silhouettes each.
  row.innerHTML = '';
  for (let n = 1; n <= 5; n++) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'count-tile';
    tile.dataset['count'] = String(n);
    const silhouettes = PLAYER_SILHOUETTE.repeat(n);
    tile.innerHTML = `
      <div class="count-silhouettes">${silhouettes}</div>
      <div class="count-num">${n}</div>
      <div class="count-text">${n === 1 ? 'heads-up' : 'opponents'}</div>
    `;
    tile.addEventListener('click', () => {
      const diff = (row.dataset['diff'] as Difficulty | undefined) ?? 'medium';
      // Pass current game config when starting
      startBotGame(diff, n, app.gameConfig);
    });
    row.appendChild(tile);
  }

  // Wire difficulty tabs — change the row's data-diff for hover accent colors
  // and to hold the current selection for when a tile is clicked.
  document.querySelectorAll<HTMLElement>('.diff-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const diff = tab.dataset['diff'];
      if (!diff) return;
      document.querySelectorAll('.diff-tab').forEach(t => t.classList.remove('selected'));
      tab.classList.add('selected');
      row.dataset['diff'] = diff;
    });
  });

  // Buy-in picker
  const slider = maybe$('buyin-slider') as HTMLInputElement | null;
  const amountEl = maybe$('buyin-amount');
  const bankLabel = maybe$('buyin-bank-label');
  if (slider && amountEl && bankLabel) {
    const syncBuyIn = () => {
      const bank = Math.max(100, loadBank().chips || 1000);
      // Top up to $1000 if the bank is empty (realistic casino reload).
      const effectiveBank = bank <= 0 ? 1000 : bank;
      slider.max = String(Math.max(100, effectiveBank));
      if (Number(slider.value) > effectiveBank) slider.value = String(effectiveBank);
      chosenBuyIn = Math.min(Number(slider.value) || 1000, effectiveBank);
      amountEl.textContent = `$${chosenBuyIn}`;
      bankLabel.textContent = `Bank: $${bank}`;
    };
    slider.addEventListener('input', () => {
      chosenBuyIn = Number(slider.value);
      amountEl.textContent = `$${chosenBuyIn}`;
    });
    document.querySelectorAll<HTMLElement>('.buyin-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const pct = Number(btn.dataset['pct'] ?? 100) / 100;
        const bank = Math.max(100, loadBank().chips || 1000);
        const v = Math.max(100, Math.round(bank * pct / 50) * 50);
        slider.value = String(v);
        chosenBuyIn = v;
        amountEl.textContent = `$${v}`;
      });
    });
    syncBuyIn();
  }
}

export function startBotGame(difficulty: Difficulty, numOpponents: number, config?: Partial<GameConfig>): void {
  const total = Math.max(2, Math.min(6, numOpponents + 1));
  app.mode = 'bot';
  app.botDifficulty = difficulty;
  app.numPlayers = total;
  app.role = 'host';
  app.myName = 'You';
  
  // Merge provided config with defaults
  app.gameConfig = { ...DEFAULT_CONFIG, ...config };
  const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

  // Withdraw the chosen buy-in from the persistent bank; bots get a fresh 1000.
  // Whatever remains in the bank stays put until the session cashes out.
  const bank = loadBank();
  const bankBefore = bank.chips > 0 ? bank.chips : 1000;
  const desired = chosenBuyIn > 0 ? chosenBuyIn : buyIn();
  const humanChips = Math.max(100, Math.min(desired, bankBefore));
  bankRemainderAtMatchStart = bankBefore - humanChips;
  bank.chips = bankRemainderAtMatchStart;
  saveBank(bank);
  app.matchStartChips = humanChips;
  app.matchHandCount = 0;

  const names = ['You'];
  const difficulties: Difficulty[] = [difficulty];
  for (let i = 1; i < total; i++) {
    names.push(`Bot ${i}`);
    difficulties.push(difficulty);
  }
  // Pass game config to createGameState
  app.state = createGameState(total, 0, names, undefined, app.gameConfig);
  app.state.chips[0] = humanChips;
  app.botDifficulties = difficulties;
  app.myReady = true;
  app.oppReady = true;

  // Show variant in connection status
  const variantLabel = getVariantLabel(app.gameConfig.variant);
  setConnStatus('connected', `${diffLabel} · ${variantLabel} · ${total - 1} bot${total - 1 > 1 ? 's' : ''}`);
  clearLog();
  lastBankShown = -1; // force pulse on first refresh
  refreshBankWidget();

  // Register a new session ID for this match so we can resume later.
  const session = createSession({
    mode: 'bot',
    difficulty,
    numPlayers: total,
    matchStartChips: humanChips,
    state: app.state,
  });
  app.sessionId = session.id;
  saveSession(session);

  // History recap first — small, filter-friendly
  const history = loadHistory();
  const bankNow = loadBank();
  if (history.length > 0) {
    addLog({ icon: 'info', text: `Last ${Math.min(4, history.length)} match${history.length === 1 ? '' : 'es'}:`, category: 'system' });
    for (const rec of history.slice(0, 4)) {
      addLog({ icon: 'chip', text: formatMatchSummary(rec), category: 'system' });
    }
  }
  addLog({
    icon: 'info',
    text: `Bank $${bankNow.chips + humanChips} · on table $${humanChips} · Lifetime ${bankNow.netLifetime >= 0 ? '+' : ''}$${bankNow.netLifetime} · ${bankNow.matchesPlayed} matches`,
    category: 'system',
  });
  logMatchDivider(`${diffLabel} · ${total - 1} ${total - 1 === 1 ? 'bot' : 'bots'} · Buy-in $${humanChips}`);

  hostStartHand();
}

// ═══════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════

export function init(): void {
  // Settings (card/bg themes)
  const settings = loadSettings();
  applySettings(settings);
  setChipStyle(settings.chipStyle as 'classic' | 'minimal' | 'retro' | 'neon');
  setBgAnimation(settings.bgAnim as 'static' | 'particles' | 'aurora' | 'starfield');
  setSoundEnabled(settings.sound);
  wireSettings(settings);

  // Unlock audio on first gesture (browser requirement).
  const unlock = () => { unlockAudio(); document.removeEventListener('pointerdown', unlock); };
  document.addEventListener('pointerdown', unlock);

  // Populate rules content in both the side panel and the modal.
  const html = rulesHtml();
  const sideBody = document.querySelector('.rules-aside-body');
  const modalBody = maybe$('rules-modal-body');
  if (sideBody) sideBody.innerHTML = html;
  if (modalBody) modalBody.innerHTML = html;

  attachEventListeners();
  attachLogScrollWatcher();
  attachChipBreakdownListener();
  refreshBankWidget();

  // Show replay button only if a saved match exists
  const replayBtn = maybe$('btn-replay-last');
  if (replayBtn) replayBtn.style.display = hasMatch() ? 'inline-flex' : 'none';

  // Offer to resume an in-progress session, if any.
  const savedSession = loadSession();
  const resumeBtn = maybe$('btn-resume-session');
  const resumeDesc = maybe$('btn-resume-desc');
  if (resumeBtn && savedSession) {
    resumeBtn.style.display = 'flex';
    if (resumeDesc) resumeDesc.textContent = sessionSummary(savedSession);
    resumeBtn.addEventListener('click', () => resumeSession(savedSession));
  } else if (resumeBtn) {
    resumeBtn.style.display = 'none';
  }

  const r = getParam('r');
  if (!r) {
    showScreen(IDS.screenLanding);
    return;
  }

  // Guest mode
  app.roomId = r;
  app.role = 'guest';
  app.state = createGameState(2, 1, [app.myName, app.oppName]);
  app.myName = 'Guest';
  app.numPlayers = 2;
  $(IDS.yourNameLabel).textContent = app.myName;
  $(IDS.readyYouName).textContent = app.myName;
  $(IDS.roomCodeDisplay).textContent = r;
  ($(IDS.shareLinkInput) as HTMLInputElement).value = `${window.location.origin}/poker/?r=${r}`;

  showScreen(IDS.screenWaiting);
  setConnStatus('connecting', 'Joining…');
  startTransports(r);
}

function attachEventListeners(): void {
  // Two-step solo picker: difficulty tabs + count tiles
  buildSoloPicker();

  // Variant selector
  const variantBtn = maybe$('btn-variant');
  const variantDropdown = maybe$('variant-dropdown');
  const variantValueEl = maybe$('variant-value');
  
  if (variantBtn && variantDropdown && variantValueEl) {
    variantBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      variantDropdown.classList.toggle('open');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      variantDropdown.classList.remove('open');
    });
    
    // Handle variant selection
    variantDropdown.querySelectorAll('.variant-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = e.currentTarget as HTMLElement;
        const variant = target.dataset['variant'] as GameVariant;
        const holeCards = parseInt(target.dataset['holecards'] || '2', 10) as 2 | 3 | 4;
        
        // Update selected state
        variantDropdown.querySelectorAll('.variant-option').forEach(o => o.classList.remove('selected'));
        target.classList.add('selected');
        
        // Update app config
        app.gameConfig = {
          ...DEFAULT_CONFIG,
          variant,
          holeCards,
        };
        
        // Update display
        const nameEl = target.querySelector('.vo-name');
        if (nameEl) {
          variantValueEl.textContent = nameEl.textContent || 'Texas Hold\'em';
        }
        
        variantDropdown.classList.remove('open');
      });
    });
  }

  // Create PvP game
  maybe$(IDS.btnCreateGame)?.addEventListener('click', () => {
    if (app.bc || app.peer) return;
    const newRoomId = genRoomId();
    window.history.pushState({}, '', '/poker/?r=' + newRoomId);
    app.mode = 'pvp';
    app.roomId = newRoomId;
    app.role = 'host';
    app.state = createGameState(2, 0, [app.myName, app.oppName]);
    app.myName = 'Host';
    app.numPlayers = 2;
    $(IDS.yourNameLabel).textContent = app.myName;
    $(IDS.readyYouName).textContent = app.myName;
    $(IDS.roomCodeDisplay).textContent = newRoomId;
    ($(IDS.shareLinkInput) as HTMLInputElement).value = `${window.location.origin}/poker/?r=${newRoomId}`;
    showScreen(IDS.screenWaiting);
    setConnStatus('connecting', 'Starting…');
    startTransports(newRoomId);
  });

  // Copy link
  maybe$(IDS.copyLinkBtn)?.addEventListener('click', () => {
    const input = $(IDS.shareLinkInput) as HTMLInputElement;
    void navigator.clipboard.writeText(input.value).then(() => {
      const btn = $(IDS.copyLinkBtn);
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    }).catch(() => {
      input.select();
      document.execCommand('copy');
    });
  });

  // Ready button (PvP)
  maybe$(IDS.readyBtn)?.addEventListener('click', () => {
    if (app.myReady) return;
    app.myReady = true;
    maybe$(IDS.readyDotYou)?.classList.add('ready-yes');
    const btn = $(IDS.readyBtn);
    btn.classList.add('already-ready');
    btn.textContent = 'WAITING...';
    send({ type: 'ready' });
    maybeStartGame();
  });

  // Game action buttons
  maybe$(IDS.btnFold)?.addEventListener('click', () => doLocalAction('fold'));
  maybe$(IDS.btnCall)?.addEventListener('click', () => {
    const actions = legalActions(app.state);
    if (actions.includes('check')) doLocalAction('check');
    else if (actions.includes('call')) doLocalAction('call', callAmount(app.state));
  });
  maybe$(IDS.btnRaise)?.addEventListener('click', () => {
    const input = $(IDS.raiseInput) as HTMLInputElement;
    let amount = parseInt(input.value, 10);
    const me = app.state.myIndex;
    const maxTotal = (app.state.stacks[me] ?? 0) + (app.state.bets[me] ?? 0);
    const minTotal = Math.min(minRaiseAmount(app.state), maxTotal);
    amount = Math.max(minTotal, Math.min(amount, maxTotal));
    input.value = String(amount);
    delete input.dataset['touched'];
    doLocalAction('raise', amount);
  });

  maybe$(IDS.raiseUp)?.addEventListener('click', () => {
    const input = $(IDS.raiseInput) as HTMLInputElement;
    const max = parseInt(input.max || '9999', 10);
    const step = Math.max(BB_AMOUNT, Math.floor(max * 0.1));
    input.value = String(Math.min(parseInt(input.value || '0', 10) + step, max));
    input.dataset['touched'] = '1';
  });
  maybe$(IDS.raiseDn)?.addEventListener('click', () => {
    const input = $(IDS.raiseInput) as HTMLInputElement;
    const max = parseInt(input.max || '9999', 10);
    const min = parseInt(input.min || '0', 10);
    const step = Math.max(BB_AMOUNT, Math.floor(max * 0.1));
    input.value = String(Math.max(parseInt(input.value || '0', 10) - step, min));
    input.dataset['touched'] = '1';
  });
  maybe$(IDS.raiseInput)?.addEventListener('input', () => {
    ($(IDS.raiseInput) as HTMLInputElement).dataset['touched'] = '1';
  });

  // Raise presets (½ pot, ⅔ pot, pot, 1.5×, all-in)
  document.querySelectorAll<HTMLElement>('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset['preset'];
      if (!preset) return;
      applyRaisePreset(preset);
    });
  });

  // Keyboard shortcuts — F/C/R/Space/Esc
  document.addEventListener('keydown', (e) => {
    // Ignore when typing in an input (raise slider, share link, etc.)
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
    // Close modals on Escape
    if (e.key === 'Escape') {
      document.querySelectorAll<HTMLElement>('.overlay.visible').forEach(o => o.classList.remove('visible'));
      maybe$('side-stack')?.classList.remove('show-rules');
      return;
    }
    // Only in-game keys
    const gameActive = maybe$(IDS.screenGame)?.classList.contains('active');
    if (!gameActive) return;
    const s = app.state;
    const isMyTurn = s.actingPlayer === s.myIndex && s.phase !== 'idle' && s.phase !== 'showdown';
    if (!isMyTurn) return;
    const k = e.key.toLowerCase();
    if (k === 'f') { e.preventDefault(); doLocalAction('fold'); }
    else if (k === 'c' || k === ' ') {
      e.preventDefault();
      const actions = legalActions(app.state);
      if (actions.includes('check')) doLocalAction('check');
      else if (actions.includes('call')) doLocalAction('call', callAmount(app.state));
    }
    else if (k === 'r') {
      e.preventDefault();
      (maybe$(IDS.raiseInput) as HTMLInputElement | null)?.focus();
    }
    else if (k === 'enter') {
      e.preventDefault();
      maybe$(IDS.btnRaise)?.click();
    }
  });

  // Showdown next hand
  maybe$(IDS.showdownNextBtn)?.addEventListener('click', () => {
    if (app.mode === 'bot') {
      doStartNextHand();
      return;
    }
    app.myNextReady = true;
    const btn = $(IDS.showdownNextBtn);
    btn.textContent = 'Waiting…';
    (btn as HTMLButtonElement).disabled = true;
    send({ type: 'next_hand' });
    if (app.oppNextReady) doStartNextHand();
  });
  maybe$(IDS.showdownNewGameBtn)?.addEventListener('click', () => { window.location.href = '/poker/'; });
  maybe$(IDS.btnNewGameDc)?.addEventListener('click', () => { window.location.href = '/poker/'; });
  maybe$(IDS.btnErrorOk)?.addEventListener('click', () => { hideOverlay(IDS.overlayError); });

  // Home button — restart to landing
  maybe$('btn-home')?.addEventListener('click', () => {
    if (confirm('Start a new game? Current match will be lost.')) {
      window.location.href = '/poker/';
    }
  });

  // Quick light/dark toggle
  maybe$('btn-mode')?.addEventListener('click', () => {
    const current = loadSettings();
    const next: Settings = { ...current, mode: current.mode === 'dark' ? 'light' : 'dark' };
    saveSettings(next);
    applySettings(next);
    setBgAnimation(next.bgAnim as 'static' | 'particles' | 'aurora' | 'starfield');
  });

  // Fullscreen toggle
  maybe$('btn-fullscreen')?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.();
    } else {
      void document.exitFullscreen?.();
    }
  });

  // Sound + reduced-motion toggles inside settings modal
  const soundToggle = maybe$('toggle-sound') as HTMLInputElement | null;
  const motionToggle = maybe$('toggle-reduced-motion') as HTMLInputElement | null;
  const initialSettings = loadSettings();
  if (soundToggle) {
    soundToggle.checked = initialSettings.sound;
    soundToggle.addEventListener('change', () => {
      const current = loadSettings();
      const next: Settings = { ...current, sound: soundToggle.checked };
      saveSettings(next);
      applySettings(next);
      setSoundEnabled(next.sound);
    });
  }
  if (motionToggle) {
    motionToggle.checked = initialSettings.reducedMotion;
    motionToggle.addEventListener('change', () => {
      const current = loadSettings();
      const next: Settings = { ...current, reducedMotion: motionToggle.checked };
      saveSettings(next);
      applySettings(next);
      setBgAnimation(next.bgAnim as 'static' | 'particles' | 'aurora' | 'starfield');
    });
  }

  // Rules: side panel during game, modal on landing.
  maybe$('btn-rules')?.addEventListener('click', () => {
    const gameActive = maybe$(IDS.screenGame)?.classList.contains('active');
    if (gameActive) {
      const side = maybe$('side-stack');
      side?.classList.toggle('show-rules');
    } else {
      showOverlay('overlay-rules');
    }
  });
  maybe$('btn-close-rules')?.addEventListener('click', () => hideOverlay('overlay-rules'));
  maybe$('btn-close-rules-side')?.addEventListener('click', () => {
    maybe$('side-stack')?.classList.remove('show-rules');
  });

  maybe$('btn-equity')?.addEventListener('click', () => {
    if (app.state.phase === 'idle') {
      showEquityResult('—', 'No hand in progress. Start a hand to compute equity.');
      return;
    }
    showEquityResult('computing…', 'Running Monte-Carlo simulation…');
    setTimeout(() => {
      const hole = app.state.holeCards[app.state.myIndex];
      if (!hole) { showEquityResult('—', 'No hole cards.'); return; }
      // Temporarily set acting to me for the calc (monteCarloEquity reads actingPlayer)
      const prev = app.state.actingPlayer;
      app.state.actingPlayer = app.state.myIndex;
      const eq = monteCarloEquity(app.state, 1500);
      app.state.actingPlayer = prev;
      const pct = (eq * 100).toFixed(1);
      showEquityResult(`${pct}%`, `Estimated win probability over ${app.state.numPlayers === 2 ? 'one' : (app.state.numPlayers - 1)} random opponent(s) and random runouts.`);
    }, 50);
  });
  maybe$('btn-close-equity')?.addEventListener('click', () => hideOverlay('overlay-equity'));

  maybe$('btn-settings')?.addEventListener('click', () => showOverlay('overlay-settings'));
  maybe$('btn-close-settings')?.addEventListener('click', () => hideOverlay('overlay-settings'));

  // Log toolbar
  maybe$('btn-copy-log')?.addEventListener('click', () => {
    const text = logText();
    void navigator.clipboard.writeText(text).then(() => {
      const btn = $('btn-copy-log');
      btn.classList.add('flashed');
      setTimeout(() => btn.classList.remove('flashed'), 1500);
    });
  });
  maybe$('btn-download-log')?.addEventListener('click', () => {
    const text = logText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poker-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  });
  maybe$('btn-clear-log')?.addEventListener('click', () => {
    if (confirm('Clear the action log?')) clearLog();
  });
  maybe$('log-autoscroll-btn')?.addEventListener('click', () => {
    setAutoScroll(!maybe$('log-autoscroll-btn')?.classList.contains('active'));
  });
  maybe$('log-jump-latest')?.addEventListener('click', () => {
    setAutoScroll(true);
    scrollLogToBottom();
  });
  document.querySelectorAll<HTMLElement>('.log-filter-pill').forEach(el => {
    el.addEventListener('click', () => {
      const f = el.dataset['filter'] as 'all' | 'action' | 'hand' | 'system' | undefined;
      if (f) setFilter(f);
    });
  });
  setAutoScroll(true);
  setFilter('all');

  // Replay last match button
  maybe$('btn-replay-last')?.addEventListener('click', () => {
    const match = loadMatch();
    if (!match) return;
    startReplay(match);
  });
  maybe$('btn-clear-replay')?.addEventListener('click', () => {
    clearMatch();
    const btn = maybe$('btn-replay-last');
    if (btn) btn.style.display = 'none';
  });

  // Reset bank / clear match history
  maybe$('btn-reset-bank')?.addEventListener('click', () => {
    if (confirm('Reset your bank to $1000 and wipe match history?')) {
      resetBank();
      clearHistory();
      refreshBankDisplay();
    }
  });
  maybe$('btn-clear-history')?.addEventListener('click', () => {
    clearHistory();
    refreshBankDisplay();
  });
  // Populate bank summary when opening settings
  maybe$('btn-settings')?.addEventListener('click', refreshBankDisplay);

  // Bank widget → lifetime stats modal
  maybe$('bank-widget')?.addEventListener('click', () => {
    renderStatsModal();
    showOverlay('overlay-stats');
  });
  maybe$('btn-close-stats')?.addEventListener('click', () => hideOverlay('overlay-stats'));
}

function renderStatsModal(): void {
  const stats = computeStats();
  const grid = maybe$('stats-grid');
  if (grid) {
    const streakText = stats.currentStreak.kind === 'none'
      ? '—'
      : `${stats.currentStreak.length} ${stats.currentStreak.kind === 'win' ? 'W' : 'L'}`;
    grid.innerHTML = `
      <div class="stat-tile">
        <div class="stat-label">Bank</div>
        <div class="stat-value">$${stats.bank}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Lifetime</div>
        <div class="stat-value ${stats.lifetime >= 0 ? 'up' : 'down'}">${stats.lifetime >= 0 ? '+' : ''}$${stats.lifetime}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Matches</div>
        <div class="stat-value">${stats.matches}</div>
        <div class="stat-sub">${stats.wins}W · ${stats.losses}L</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value">${(stats.winRate * 100).toFixed(0)}%</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Hands</div>
        <div class="stat-value">${stats.handsPlayed}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Current streak</div>
        <div class="stat-value">${streakText}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Biggest win</div>
        <div class="stat-value up">+$${stats.biggestWin}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Biggest loss</div>
        <div class="stat-value down">$${stats.biggestLoss}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Best streaks</div>
        <div class="stat-value">${stats.longestWinStreak}W / ${stats.longestLossStreak}L</div>
        <div class="stat-sub">fav: ${stats.favouriteDifficulty}</div>
      </div>
    `;
  }
  const sparkWrap = maybe$('sparkline-wrap');
  if (sparkWrap) sparkWrap.innerHTML = sparklineSvg(320, 60);

  const hist = maybe$('stats-history');
  if (hist) {
    const records = loadHistory().slice(0, 10);
    hist.innerHTML = records.length === 0
      ? '<div class="stats-history-row"><span>no matches yet</span><span></span><span></span></div>'
      : records.map(rec => {
          const sign = rec.delta >= 0 ? '+' : '';
          const cls = rec.delta >= 0 ? 'up' : 'down';
          const dt = new Date(rec.timestamp);
          const label = `${rec.difficulty} · ${rec.numPlayers - 1}b · ${rec.hands}h`;
          return `
            <div class="stats-history-row">
              <span>${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span>${label}</span>
              <span class="sh-delta ${cls}">${sign}$${rec.delta}</span>
            </div>`;
        }).join('');
  }
}

function refreshBankDisplay(): void {
  const el = maybe$('settings-bank-display');
  if (!el) return;
  const bank = loadBank();
  const history = loadHistory();
  el.innerHTML = `Bank <b>$${bank.chips}</b> · Lifetime ${bank.netLifetime >= 0 ? '+' : ''}$${bank.netLifetime} · Matches ${bank.matchesPlayed}<br>History: ${history.length} match${history.length === 1 ? '' : 'es'}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Bank widget — visible during gameplay
// ═══════════════════════════════════════════════════════════════════════

let lastBankShown = -1;
let lastMatchDeltaShown = 0;

function refreshBankWidget(): void {
  const widget = maybe$('bank-widget');
  if (!widget) return;
  const bank = loadBank();
  // Total bank = off-table cash (stored) + chips currently on the table.
  const onTable = app.mode === 'bot' && app.state.phase !== 'idle'
    ? (app.state.chips[0] ?? 0)
    : 0;
  const liveChips = app.mode === 'bot' && app.state.phase !== 'idle'
    ? bank.chips + onTable
    : bank.chips;
  const matchDelta = app.mode === 'bot' ? onTable - app.matchStartChips : 0;

  const chipsEl    = widget.querySelector('.bw-chips');
  const deltaEl    = widget.querySelector('.bw-delta');
  const lifeEl     = widget.querySelector('.bw-lifetime');
  if (chipsEl) chipsEl.textContent = `$${liveChips}`;
  if (deltaEl) {
    if (app.mode === 'bot' && app.state.phase !== 'idle') {
      deltaEl.textContent = `${matchDelta >= 0 ? '+' : ''}$${matchDelta}`;
      (deltaEl as HTMLElement).className = 'bw-delta ' + (matchDelta >= 0 ? 'up' : 'down');
      (deltaEl as HTMLElement).style.display = '';
    } else {
      (deltaEl as HTMLElement).style.display = 'none';
    }
  }
  if (lifeEl) lifeEl.textContent = `Lifetime ${bank.netLifetime >= 0 ? '+' : ''}$${bank.netLifetime} · ${bank.matchesPlayed} matches`;

  // Pulse animation when chips actually change.
  if (liveChips !== lastBankShown) {
    widget.classList.remove('pulse-up', 'pulse-down');
    void (widget as HTMLElement).offsetWidth;
    widget.classList.add(liveChips > lastBankShown ? 'pulse-up' : 'pulse-down');
    lastBankShown = liveChips;
  }
  lastMatchDeltaShown = matchDelta;
}

// ═══════════════════════════════════════════════════════════════════════
// Chip breakdown popover
// ═══════════════════════════════════════════════════════════════════════

function attachChipBreakdownListener(): void {
  // Delegated click handler — any chip-stack opens a breakdown popover.
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const stack = target.closest('.chip-stack') as HTMLElement | null;
    if (stack) {
      e.stopPropagation();
      const amount = Number(stack.dataset['amount'] ?? 0);
      if (amount <= 0) return;
      openBreakdownPopover(stack, amount);
      return;
    }
    // Click outside → close existing popover
    closeBreakdownPopover();
  });
}

function openBreakdownPopover(anchor: HTMLElement, amount: number): void {
  closeBreakdownPopover();
  const pop = document.createElement('div');
  pop.className = 'chip-breakdown-popover';
  pop.innerHTML = breakdownHtml(amount);
  document.body.appendChild(pop);

  // Position above the anchor, clamped to viewport.
  const rect = anchor.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - popRect.width / 2;
  let top = rect.top - popRect.height - 12;
  if (top < 10) top = rect.bottom + 12;
  if (left < 10) left = 10;
  if (left + popRect.width > window.innerWidth - 10) {
    left = window.innerWidth - popRect.width - 10;
  }
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  requestAnimationFrame(() => pop.classList.add('visible'));
}

function closeBreakdownPopover(): void {
  document.querySelectorAll('.chip-breakdown-popover').forEach(el => el.remove());
}

// ═══════════════════════════════════════════════════════════════════════
// Session resume
// ═══════════════════════════════════════════════════════════════════════

function resumeSession(session: GameSession): void {
  app.mode = session.mode;
  app.botDifficulty = session.difficulty;
  app.numPlayers = session.numPlayers;
  app.matchStartChips = session.matchStartChips;
  app.matchHandCount = session.matchHandCount;
  app.sessionId = session.id;
  app.role = 'host';
  app.myName = 'You';
  app.myReady = true;
  app.oppReady = true;

  // Restore the entire game state from the snapshot.
  app.state = session.state;
  app.botDifficulties = new Array(session.numPlayers).fill(session.difficulty);

  const diffLabel = session.difficulty.charAt(0).toUpperCase() + session.difficulty.slice(1);
  setConnStatus('connected', `${diffLabel} · resumed`);
  clearLog();
  addLog({ icon: 'info', text: `Session resumed · hand #${app.state.handNum}`, emphasis: true });

  showScreen(IDS.screenGame);
  renderTable(app.state);
  updateActionUI(app.state);
  refreshBankWidget();

  // If it's the bot's turn, schedule their action.
  scheduleBotIfNeeded();
}

// ═══════════════════════════════════════════════════════════════════════
// Settings
// ═══════════════════════════════════════════════════════════════════════

function wireSettings(initial: Settings): void {
  const set = (group: string, value: string) => {
    document.querySelectorAll<HTMLElement>(`[data-setting="${group}"] [data-value]`).forEach(el => {
      el.classList.toggle('selected', el.dataset['value'] === value);
    });
  };
  set('cardback', initial.cardBack);
  set('table', initial.tableBg);
  set('chipstyle', initial.chipStyle);
  set('bganim', initial.bgAnim);
  set('mode', initial.mode);

  document.querySelectorAll<HTMLElement>('[data-setting] [data-value]').forEach(el => {
    el.addEventListener('click', () => {
      const group = el.parentElement?.dataset['setting'];
      const value = el.dataset['value'];
      if (!group || !value) return;
      const current = loadSettings();
      let next = current;
      if (group === 'cardback')   next = { ...current, cardBack: value };
      else if (group === 'table') next = { ...current, tableBg: value };
      else if (group === 'chipstyle') next = { ...current, chipStyle: value };
      else if (group === 'bganim')    next = { ...current, bgAnim: value };
      else if (group === 'mode')      next = { ...current, mode: value };
      saveSettings(next);
      applySettings(next);
      if (group === 'chipstyle') {
        setChipStyle(value as 'classic' | 'minimal' | 'retro' | 'neon');
        // Re-render table to pick up new chip visuals.
        renderTable(app.state);
      }
      if (group === 'bganim') {
        setBgAnimation(value as 'static' | 'particles' | 'aurora' | 'starfield');
      }
      set(group, value);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Equity modal
// ═══════════════════════════════════════════════════════════════════════

function showEquityResult(headline: string, detail: string): void {
  const h = maybe$('equity-headline');
  const d = maybe$('equity-detail');
  if (h) h.textContent = headline;
  if (d) d.textContent = detail;
  showOverlay('overlay-equity');
}

// ═══════════════════════════════════════════════════════════════════════
// Replay (basic viewer)
// ═══════════════════════════════════════════════════════════════════════

import type { Match } from './ui/match-recorder.js';

function startReplay(match: Match): void {
  // Disable bot mode + start a replay state; step through actions at fixed pace.
  app.mode = 'bot'; // prevents any networking path
  app.botTimer && clearTimeout(app.botTimer);
  app.botTimer = null;
  const s = createGameState(match.numPlayers, 0, match.names);
  app.state = s;
  app.numPlayers = match.numPlayers;
  setConnStatus('connected', 'Replay');
  clearLog();
  showScreen(IDS.screenGame);

  let handIdx = 0;
  let actionIdx = 0;
  let inHand = false;

  const step = () => {
    if (!inHand) {
      if (handIdx >= match.hands.length) {
        addLog({ icon: 'trophy', text: 'Replay complete', emphasis: true });
        return;
      }
      const hand = match.hands[handIdx]!;
      s.buttonIndex = hand.button;
      const events = dealHand(s, hand.deck);
      logEvents(events);
      renderTable(s);
      inHand = true;
      actionIdx = 0;
      setTimeout(step, 700);
      return;
    }
    const hand = match.hands[handIdx]!;
    if (actionIdx >= hand.actions.length) {
      // End of hand — run to showdown if still in action
      if (s.phase !== 'showdown' && s.phase !== 'idle') {
        const events = finishToShowdown(s);
        logEvents(events);
      }
      renderTable(s, true);
      handIdx++;
      inHand = false;
      if (handIdx < match.hands.length) {
        setTimeout(() => { startNextHand(s); step(); }, 1500);
      } else {
        addLog({ icon: 'trophy', text: 'Replay complete', emphasis: true });
      }
      return;
    }
    const rec = hand.actions[actionIdx++]!;
    const action = rec.kind === 'raise'
      ? { kind: 'raise' as const, amount: rec.amount ?? 0 }
      : { kind: rec.kind };
    try {
      const result = applyAction(s, rec.player, action);
      logEvents(result.events);
      renderTable(s);
      if (result.roundClosed && !result.handEnded) {
        const events = nextStreet(s);
        logEvents(events);
      }
    } catch (e) {
      console.error('[replay] action failed', e);
    }
    setTimeout(step, 600);
  };
  step();
}
