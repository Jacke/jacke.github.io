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
import { WebSocketTransport } from './transports/websocket.js';
import { clientConfig } from './config.js';
import { decideAction, monteCarloEquity, thinkDelayMs, type Difficulty } from './bot/bot.js';
import { opponentModel } from './bot/opponent-model.js';
import {
  STRUCTURES,
  createTournament,
  currentBlinds,
  onHandComplete as tournamentOnHandComplete,
  eliminate as tournamentEliminate,
  icmEquity,
  defaultPayouts,
  aliveSeats,
  type TournamentState,
  type BlindStructure,
} from './core/tournament.js';

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
import { makeCardEl } from './ui/cards-view.js';
import { setLang, getLang, t, applyI18n, type Lang } from './ui/i18n.js';
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
import {
  createSession, saveSession, loadSession, clearSession, sessionSummary,
  saveSessionById, listSessions, removeSession,
  setActiveSessionId, getActiveSessionId,
  type GameSession,
} from './ui/session.js';
import { matchToHHF, downloadHHF } from './history/hhf.js';
import { matchHistoryToCsv, lifetimeSummaryToCsv, downloadCsv } from './ui/stats-export.js';
import {
  createBjState, startHand as bjStartHand,
  hitStep as bjHitStep, standStep as bjStandStep,
  doubleStep as bjDoubleStep, splitStep as bjSplitStep,
  surrenderStep as bjSurrenderStep,
  dealerShouldDraw as bjDealerShouldDraw,
  dealerDrawOne as bjDealerDrawOne,
  finalizeHand as bjFinalizeHand,
  takeInsurance as bjTakeInsurance, declineInsurance as bjDeclineInsurance,
  readyNextHand as bjReadyNextHand, legalBjActions,
} from './blackjack/engine.js';
import type { BjGameState } from './blackjack/types.js';
import { renderBlackjack, flipDealerHole, flashOutcomeBanner } from './ui/blackjack-view.js';
import {
  sfxCardDeal as bjSfxDeal, sfxCardFlip as bjSfxFlip,
  sfxChipDrop as bjSfxChip, sfxWin as bjSfxWin, sfxLose as bjSfxLose,
} from './ui/sfx.js';
import {
  initRouter, on as onRoute, onFallback as onRouteFallback,
  navigateTo, currentRoute,
} from './ui/router.js';
import {
  initChatPanel, showChatPanel, setChatMode, appendChatMessage,
  clearChatHistory, appendChatSystem,
} from './ui/chat-panel.js';
import {
  startLogSession, appendLogEntry, endLogSession,
  listSessions as listLogSessions, clearLog as clearMatchLog,
  relativeTime, type GameKind, type LoggedSession, type LogEntry,
} from './ui/match-log.js';

// ═══════════════════════════════════════════════════════════════════════
// App state
// ═══════════════════════════════════════════════════════════════════════

type Mode = 'pvp' | 'bot';
// `GameKind` is re-exported from './ui/match-log.js' (see import above) —
// single source of truth for the 'poker' | 'blackjack' union. Both app.ts
// and the log storage share the type so there's no drift.

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
  ws: WebSocketTransport | null;
  activeTransport: 'bc' | 'webrtc' | 'ws' | null;
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
  /** Tournament state when running in tournament mode; null in cash mode. */
  tournament: TournamentState | null;
  /**
   * Multi-table bag — snapshots of every non-active table.
   * The currently-active table lives in the top-level `state` / `tournament`
   * / `botDifficulties` / etc. fields; on switch we serialize the active
   * table into this map, then deserialize the target table out.
   */
  tables: Map<string, TableSlot>;
  /** Which game we're currently running. Poker and blackjack are mutually exclusive. */
  gameKind: GameKind;
  /** Blackjack engine state, non-null only when gameKind === 'blackjack'. */
  blackjack: BjGameState | null;
  /**
   * Active entry in the persistent match-log storage. Set when a new
   * match/session starts (bot or PvP), entries are appended throughout
   * the session, cleared when the session ends.
   */
  logSessionId: string | null;
  /**
   * Shared deterministic shoe seed for blackjack P2P. Host generates on
   * session start and broadcasts via `bj-start`; guest adopts on receive.
   * null outside BJ P2P mode.
   */
  bjP2PSeed: number | null;
}

/** A snapshot of one inactive table. */
interface TableSlot {
  id: string;
  state: GameState;
  tournament: TournamentState | null;
  botDifficulty: Difficulty;
  botDifficulties: Difficulty[];
  gameConfig: GameConfig;
  numPlayers: number;
  matchStartChips: number;
  matchHandCount: number;
  /** Short label shown on the tab strip. */
  label: string;
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
  ws: null,
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
  tournament: null,
  tables: new Map<string, TableSlot>(),
  gameKind: 'poker',
  blackjack: null,
  logSessionId: null,
  bjP2PSeed: null,
};

// ═══════════════════════════════════════════════════════════════════════
// Transport wiring (PvP only — bot mode skips all of this)
// ═══════════════════════════════════════════════════════════════════════

function send(msg: Message): void {
  if (app.mode === 'bot') return;
  // Server-assisted matches run on the WebSocket transport exclusively.
  if (app.activeTransport === 'ws' && app.ws && app.ws.status() === 'open') {
    try { app.ws.send(msg); } catch (e) { console.error('[poker] ws send error', e); }
    return;
  }
  // Prefer the active transport if one has won. Otherwise, fire through
  // whichever is available — BC first (cheapest, always works same-browser),
  // then PeerJS. This avoids the chicken-and-egg where activeTransport only
  // gets set on *received* messages but we need to send before receiving.
  if (app.activeTransport === 'bc' && app.bc) {
    try { app.bc.send(msg); } catch (e) { console.error('[poker] bc send error', e); }
    return;
  }
  if (app.activeTransport === 'webrtc' && app.peer && app.peer.status() === 'open') {
    try { app.peer.send(msg); } catch (e) { console.error('[poker] webrtc send error', e); }
    return;
  }
  // No active transport yet — fan out on whatever channel is alive.
  let sent = false;
  if (app.bc) {
    try { app.bc.send(msg); sent = true; } catch (e) { console.error('[poker] bc send error', e); }
  }
  if (app.peer && app.peer.status() === 'open') {
    try { app.peer.send(msg); sent = true; } catch (e) { console.error('[poker] webrtc send error', e); }
  }
  if (!sent) console.warn('[poker] send with no active transport', msg);
}

function startTransports(roomId: string): void {
  app.bc = new BroadcastTransport(roomId, app.myName);
  app.bc.on('open', () => {
    if (app.activeTransport === 'webrtc') return;
    app.activeTransport = 'bc';
    setConnStatus('connected', 'Connected');
    // Announce ourselves back — the BC transport already echoes a hello on
    // its own 'open' but this is belt-and-suspenders so the app-level handler
    // fires on both sides regardless of ordering.
    try { app.bc?.send({ type: 'hello', name: app.myName }); } catch { /* ignore */ }
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

/**
 * Server-assisted matchmaking: open a WebSocket to the iamjacke poker
 * server, authenticate with the persistent Ed25519 identity, enter the
 * queue, and hand off to the normal PvP game flow once matched. Unlike
 * P2P mode there's no invite link — the server pairs two players from
 * the global queue and assigns a room.
 */
function startMatchmakerFlow(displayName: string): void {
  if (app.ws) return;
  const ws = new WebSocketTransport({
    game: 'poker',
    seats: 2,
    displayName,
    onMatched: ({ roomId, seat }) => {
      app.roomId = roomId;
      app.role = seat === 0 ? 'host' : 'guest';
      app.state.myIndex = seat;
      app.numPlayers = 2;
      app.state = createGameState(2, seat, [
        seat === 0 ? displayName : 'Opponent',
        seat === 0 ? 'Opponent' : displayName,
      ]);
      app.sessionId = mintPvpSession(roomId, { role: app.role, myIndex: seat, myName: displayName });
      window.history.pushState({}, '', `/poker/?r=${roomId}&session=${app.sessionId}`);
    },
  });
  app.ws = ws;
  app.mode = 'pvp';
  app.myName = displayName;
  showScreen(IDS.screenWaiting);
  setConnStatus('connecting', 'Finding an opponent…');

  ws.on('status', (s, label) => {
    const uiState = s === 'open' ? 'connected' : s === 'error' ? 'error' : 'connecting';
    setConnStatus(uiState as 'connecting' | 'connected' | 'error', label ?? '');
  });
  ws.on('open', () => {
    app.activeTransport = 'ws';
    setConnStatus('connected', 'Connected');
    // Let the other side know our name — same pattern as BC/PeerJS.
    try { ws.send({ type: 'hello', name: displayName }); } catch { /* ignore */ }
  });
  ws.on('message', (msg) => {
    if (app.activeTransport !== 'ws') app.activeTransport = 'ws';
    handleMessage(msg);
  });
  ws.on('close', () => {
    if (!maybe$(IDS.screenLanding)?.classList.contains('active')) {
      showOverlay(IDS.overlayDisconnected);
    }
  });
  ws.on('error', (err) => {
    console.warn('[poker] matchmaker error', err);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Incoming message dispatch
// ═══════════════════════════════════════════════════════════════════════

function handleMessage(msg: Message): void {
  switch (msg.type) {
    case 'hello': {
      // Only accept a hello as coming from the OTHER seat — never overwrite
      // our own name entry. The opponent lives at (1 - myIndex) in HU.
      const oppIdx = (1 - app.state.myIndex + app.state.numPlayers) % app.state.numPlayers;
      const incoming = (msg.name || '').trim();
      if (incoming) {
        app.oppName = incoming;
        app.state.names[oppIdx] = incoming;
      }
      $(IDS.readyOppName).textContent = app.oppName;
      $(IDS.oppNameLabel).textContent = app.oppName;
      setConnStatus('connected', 'Connected');

      // Transition to ready screen the first time we hear from the peer,
      // then always (re-)populate the ready UI so name edits mid-screen
      // reflect immediately on both sides.
      if (
        maybe$(IDS.screenWaiting)?.classList.contains('active') ||
        maybe$(IDS.screenLanding)?.classList.contains('active')
      ) {
        showScreen(IDS.screenReady);
      }
      // Keep our OWN name slot coherent with app.myName too.
      app.state.names[app.state.myIndex] = app.myName;
      $(IDS.readyYouName).textContent = app.myName;
      $(IDS.readyOppName).textContent = app.oppName;
      if (maybe$(IDS.screenReady)?.classList.contains('active')) setupReadyScreen();
      // Persist opponent name into the PvP session so a reload remembers it.
      if (app.mode === 'pvp' && app.sessionId) {
        updatePvpSession(app.roomId, app.sessionId, {
          myName: app.myName,
          oppName: app.oppName,
        });
      }
      // BJ P2P — opportunistically broadcast our shoe seed on every hello
      // so whoever joined second also gets it.
      if (app.gameKind === 'blackjack' && app.bjP2PSeed !== null && app.blackjack) {
        try {
          send({ type: 'bj-start', seed: app.bjP2PSeed, startingChips: app.blackjack.chips });
        } catch { /* ignore */ }
        appendChatSystem(`${app.oppName || 'Opponent'} connected`);
      }
      break;
    }

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

    case 'chat':
      // Incoming chat from opponent — append to panel + persist in log.
      appendChatMessage(msg, { mine: false });
      if (app.logSessionId) {
        appendLogEntry(app.gameKind, app.logSessionId, {
          kind: 'chat', ts: msg.ts, from: msg.from, text: msg.text,
        });
      }
      break;

    case 'bj-start':
      // Guest path: adopt the host's seed so both shoes are identical.
      // We rebuild our engine state from scratch — if we already had one
      // with a different seed, overwrite so future deal sync works.
      if (app.gameKind === 'blackjack') {
        const hadLocal = app.blackjack;
        if (!hadLocal || app.bjP2PSeed !== msg.seed) {
          app.blackjack = createBjState({
            numDecks: 6,
            standOnSoft17: true,
            startingChips: hadLocal?.chips ?? msg.startingChips,
            seed: msg.seed,
          });
          app.bjP2PSeed = msg.seed;
          renderBlackjack(app.blackjack);
          appendChatSystem(`Synchronized shoe seed with ${app.oppName || 'opponent'}`);
        }
      }
      break;

    case 'bj-bet':
    case 'bj-deal':
    case 'bj-action':
    case 'bj-insurance':
      // Forward log entry — the shared-deal sync loop is future work.
      // For now we just note the opponent's action in the journal so the
      // history shows both sides' play patterns.
      if (app.logSessionId) {
        appendLogEntry(app.gameKind, app.logSessionId, {
          kind: 'system', ts: Date.now(), text: `opponent ${msg.type}`,
        });
      }
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Ready barrier
// ═══════════════════════════════════════════════════════════════════════

function maybeStartGame(): void {
  if (!app.myReady || !app.oppReady) return;
  hideOverlay(IDS.overlayName);
  // PvP: start a persistent journal entry for this session so chat and
  // hands get logged end-to-end. Also reveal the chat panel.
  if (app.mode === 'pvp' && !app.logSessionId) {
    app.logSessionId = startLogSession('poker', {
      mode: 'pvp',
      label: `vs ${app.oppName || 'Opponent'}`,
    });
    clearChatHistory();
    appendChatSystem(`Connected — say hi to ${app.oppName || 'your opponent'} 👋`);
  }
  showChatPanel(true);
  setChatMode('pvp');
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
    button: app.state.buttonIndex,
    handNum: app.state.handNum + 1,
  });
  runDealHand(deck);
}

function runDealHand(deck: Card[]): void {
  showScreen(IDS.screenGame);
  // Tournament mode: push the current level's blinds into the engine state
  // before dealing, so the escalation actually takes effect on this hand.
  if (app.tournament) {
    const lvl = currentBlinds(app.tournament);
    app.state.blinds = { sb: lvl.sb, bb: lvl.bb, ante: lvl.ante };
  }
  const events = dealHand(app.state, deck);
  recordHandStart(deck, app.state.buttonIndex, app.state.handNum);
  logEvents(events);
  renderTable(app.state);
  updateActionUI(app.state);
  refreshPlayerUX();
  renderTournamentHUD();

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
function preflopRoughEquity(hole: readonly string[]): number {
  if (hole.length < 2) return 40;
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
      case 'hand-start': {
        logHandDivider(e.handNum);
        sfxCardDeal();
        const seats: number[] = [];
        for (let i = 0; i < app.state.numPlayers; i++) seats.push(i);
        opponentModel.newHand(seats);
        break;
      }
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
        // Feed opponent model — uses current state.phase (action applied but
        // street hasn't advanced yet since logEvents runs between
        // applyAction and nextStreet).
        opponentModel.record(e.player, e.action.kind, app.state.phase);
        // Discard is not a betting action — skip the betting log/sfx paths.
        if (e.action.kind === 'discard') break;
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
    joker: 'Joker Hold\'em',
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
    player: app.state.myIndex,
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
  opponentModel.endHand();

  // Persistent journal — record a one-line hand summary.
  if (app.logSessionId) {
    const winnerName = winnerIdxs.length === 1 && winnerIdxs[0] !== undefined
      ? nameOf(winnerIdxs[0])
      : 'Split';
    const potSize = app.state.handContribs.reduce((a, b) => a + b, 0);
    const heroDelta = winnerIdxs.includes(app.state.myIndex)
      ? Math.round(potSize / winnerIdxs.length) - (app.state.handContribs[app.state.myIndex] ?? 0)
      : -(app.state.handContribs[app.state.myIndex] ?? 0);
    appendLogEntry('poker', app.logSessionId, {
      kind: 'hand',
      ts: Date.now(),
      summary: `Hand #${app.state.handNum} · ${winnerName} wins $${potSize} (${reason})`,
      delta: heroDelta,
    });
  }

  // Tournament: advance blind level & track busts.
  if (app.tournament) {
    // Apply winners' chip deltas before detecting eliminations. The engine
    // has already committed everything into state.chips[] via the award path,
    // so any seat now showing 0 chips is a bust.
    for (let i = 0; i < app.state.numPlayers; i++) {
      if ((app.state.chips[i] ?? 0) === 0) tournamentEliminate(app.tournament, i);
    }
    const after = tournamentOnHandComplete(app.tournament);
    const alive = aliveSeats(app.state.chips);
    addLog({
      icon: 'info',
      text: `Blinds $${after.sb}/$${after.bb}${after.ante ? ` · ante $${after.ante}` : ''} · ${alive.length} alive`,
      category: 'system',
    });

    // ICM: log the human's current equity in the prize pool.
    const prizePool = app.tournament.structure.startingStack * app.state.numPlayers;
    const paid = Math.min(app.state.numPlayers, Math.max(1, Math.ceil(app.state.numPlayers / 2)));
    const payouts = defaultPayouts(prizePool, paid);
    const equity = icmEquity(app.state.chips, payouts);
    const myEq = Math.round(equity[app.state.myIndex] ?? 0);
    addLog({
      icon: 'chip',
      text: `ICM equity: $${myEq} (chip share ${Math.round(((app.state.chips[0] ?? 0) / prizePool) * 100)}%)`,
      category: 'system',
    });

    renderTournamentHUD();
  }

  const title = winnerIdxs.includes(app.state.myIndex) && winnerIdxs.length === 1
    ? 'You win!'
    : winnerIdxs.length === 1
      ? `${nameOf(winnerIdxs[0]!)} wins`
      : 'Split pot';

  const lines: string[] = [];
  if (reason === 'fold') {
    lines.push(`Won uncontested — everyone else folded.`);
  }

  // Compute per-player chip deltas for the showdown board.
  const deltas: number[] = new Array(app.state.numPlayers).fill(0);
  for (let i = 0; i < app.state.numPlayers; i++) {
    deltas[i] = (app.state.chips[i] ?? 0) - (app.state.handContribs[i] ?? 0) -
      ((app.state.chips[i] ?? 0) - (app.state.chips[i] ?? 0)); // placeholder
  }
  // More accurate: delta = current chips - (chips before hand).
  // We don't store pre-hand chips, so approximate via handContribs:
  // For winners: they get their contribution back + others' contributions.
  // For losers: they lose their contribution.
  for (let i = 0; i < app.state.numPlayers; i++) {
    const contrib = app.state.handContribs[i] ?? 0;
    if (winnerIdxs.includes(i)) {
      // Winner gains: total pot minus their own contribution, divided among co-winners.
      const totalPot = app.state.handContribs.reduce((a, b) => a + b, 0);
      deltas[i] = Math.round((totalPot - contrib * winnerIdxs.length) / winnerIdxs.length);
    } else {
      deltas[i] = -contrib;
    }
  }

  // Paint the showdown board with all hands, winner ribbon, best-card glow.
  const subtitle = reason === 'fold'
    ? 'UNCONTESTED'
    : `HAND #${app.state.handNum} · SHOWDOWN`;
  renderShowdownBoard(reason, hands, winnerIdxs, deltas, subtitle);

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
    const snap: GameSession = {
      id: app.sessionId,
      mode: 'bot',
      difficulty: app.botDifficulty,
      numPlayers: app.state.numPlayers,
      matchStartChips: app.matchStartChips,
      matchHandCount: app.matchHandCount,
      state: app.state,
      createdAt: 0, // re-set on save
      updatedAt: 0,
    };
    saveSession(snap);
    saveSessionById(snap);
    snapshotActiveTable();
    renderTabStrip();
  } else if (app.state.gameOver) {
    // Drop this table from the multi-bag; if it was the only one the legacy
    // clearSession() also wipes the single-session key.
    if (app.sessionId) {
      app.tables.delete(app.sessionId);
      removeSession(app.sessionId);
    }
    clearSession();
    // Close the persistent journal entry with the final bank delta.
    if (app.logSessionId) {
      const heroChips = app.state.chips[app.state.myIndex] ?? 0;
      const delta = heroChips - app.matchStartChips;
      endLogSession('poker', app.logSessionId, delta);
      app.logSessionId = null;
    }
    renderTabStrip();
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

/**
 * Build a rich showdown body with every player's cards + hand + winner ribbon.
 * reason: 'fold' — only survivor is shown as winner, folded players greyed out.
 * reason: 'showdown' — every non-folded player shows their best 5-card hand,
 *                     with winner highlighted and best-5 cards glowing.
 */
function renderShowdownBoard(
  reason: 'fold' | 'showdown',
  hands: Array<ReturnType<typeof bestHand> | null>,
  winnerIdxs: number[],
  deltas: number[],
  subtitle: string,
): void {
  // Community cards row
  const commEl = maybe$('showdown-community');
  if (commEl) {
    commEl.innerHTML = '';
    app.state.community.forEach((c, i) => {
      const el = makeCardElDirect(c, true, i * 80);
      commEl.appendChild(el);
    });
    // Pad with placeholders if community incomplete (fold before flop)
    for (let i = app.state.community.length; i < 5; i++) {
      const ph = document.createElement('div');
      ph.className = 'card-placeholder';
      commEl.appendChild(ph);
    }
  }

  const subEl = maybe$('showdown-subtitle');
  if (subEl) subEl.textContent = subtitle;

  // Per-player rows
  const playersEl = maybe$('showdown-players');
  if (!playersEl) return;
  playersEl.innerHTML = '';

  for (let i = 0; i < app.state.numPlayers; i++) {
    const row = document.createElement('div');
    row.className = 'sd-player';
    if (app.state.folded[i]) row.classList.add('folded');
    if (winnerIdxs.includes(i)) row.classList.add('winner');

    // Cards
    const cardsEl = document.createElement('div');
    cardsEl.className = 'sd-player-cards';
    const hole = app.state.holeCards[i];
    if (hole) {
      const winHand = hands[i];
      const bestCards = winHand && winnerIdxs.includes(i) ? new Set(winHand.cards) : new Set<string>();
      for (const card of hole) {
        const cEl = makeCardElDirect(card, true, 0);
        if (bestCards.has(card)) cEl.classList.add('best');
        cardsEl.appendChild(cEl);
      }
    }

    // Info
    const infoEl = document.createElement('div');
    infoEl.className = 'sd-player-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'sd-player-name';
    nameEl.textContent = nameOf(i);
    const handEl = document.createElement('div');
    handEl.className = 'sd-player-hand';
    if (app.state.folded[i]) {
      handEl.textContent = reason === 'fold' ? 'fold' : 'folded';
    } else if (hands[i]) {
      handEl.textContent = hands[i]!.name;
    } else {
      handEl.textContent = '—';
    }
    infoEl.appendChild(nameEl);
    infoEl.appendChild(handEl);

    // Delta
    const deltaEl = document.createElement('div');
    const d = deltas[i] ?? 0;
    deltaEl.className = 'sd-player-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'zero');
    deltaEl.textContent = d === 0 ? '—' : (d > 0 ? '+' : '') + `$${d}`;

    row.appendChild(cardsEl);
    row.appendChild(infoEl);
    row.appendChild(deltaEl);
    playersEl.appendChild(row);
  }
}

function makeCardElDirect(card: string, faceUp: boolean, delay: number): HTMLElement {
  // Thin wrapper that just calls the card-view module without triggering
  // the flying-deck animation (showdown cards shouldn't fly from the deck).
  const el = makeCardEl(card, faceUp, delay);
  // Strip the animation so it just appears.
  el.style.animationDelay = '';
  el.classList.remove('dealt');
  return el;
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
    const label = n === 1 ? t('landing.headsup') : t('landing.opps');
    tile.innerHTML = `
      <div class="count-silhouettes">${silhouettes}</div>
      <div class="count-num">${n}</div>
      <div class="count-text">${label}</div>
    `;
    tile.addEventListener('click', () => {
      const diff = (row.dataset['diff'] as Difficulty | undefined) ?? 'medium';
      const mode = row.dataset['mode'] ?? 'cash';
      if (mode === 'tournament') {
        const structure = row.dataset['structure'] ?? 'standard';
        startTournamentGame(diff, n, structure, app.gameConfig);
      } else {
        startBotGame(diff, n, app.gameConfig);
      }
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

  // Wire mode toggle (cash vs tournament) — cash mode shows buy-in, tournament
  // mode shows structure picker and hides buy-in (tournament has fixed stacks).
  row.dataset['mode'] = 'cash';
  row.dataset['structure'] = 'standard';
  const buyinRow = document.querySelector<HTMLElement>('.buyin-row');
  const tourneyRow = maybe$('tourney-structure-row');
  document.querySelectorAll<HTMLElement>('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const m = tab.dataset['mode'];
      if (!m) return;
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('selected'));
      tab.classList.add('selected');
      row.dataset['mode'] = m;
      if (buyinRow) buyinRow.style.display = m === 'tournament' ? 'none' : '';
      if (tourneyRow) tourneyRow.style.display = m === 'tournament' ? '' : 'none';
    });
  });
  document.querySelectorAll<HTMLElement>('.tourney-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const s = tab.dataset['structure'];
      if (!s) return;
      document.querySelectorAll('.tourney-tab').forEach(t => t.classList.remove('selected'));
      tab.classList.add('selected');
      row.dataset['structure'] = s;
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

// ═══════════════════════════════════════════════════════════════════════
// Multi-table — tab strip, snapshot/restore, add/close table
// ═══════════════════════════════════════════════════════════════════════

/** Short label shown on the tab strip — compact enough for 3-4 tables. */
function buildTableLabel(): string {
  const bots = Math.max(0, app.state.numPlayers - 1);
  if (app.tournament) {
    return `${app.tournament.structure.name[0]} · ${bots}B`;
  }
  return `${app.botDifficulty[0]!.toUpperCase()} · ${bots}B`;
}

/** Freeze the currently-active table into app.tables + persist to storage. */
function snapshotActiveTable(): void {
  if (!app.sessionId) return;
  if (app.mode !== 'bot') return; // multi-table only supports bot mode (for now)
  const slot: TableSlot = {
    id: app.sessionId,
    state: app.state,
    tournament: app.tournament,
    botDifficulty: app.botDifficulty,
    botDifficulties: app.botDifficulties.slice(),
    gameConfig: { ...app.gameConfig },
    numPlayers: app.numPlayers,
    matchStartChips: app.matchStartChips,
    matchHandCount: app.matchHandCount,
    label: buildTableLabel(),
  };
  app.tables.set(app.sessionId, slot);
  // Also mirror to localStorage for cross-reload resume.
  const session: GameSession = {
    id: app.sessionId,
    mode: 'bot',
    difficulty: app.botDifficulty,
    numPlayers: app.numPlayers,
    matchStartChips: app.matchStartChips,
    matchHandCount: app.matchHandCount,
    state: app.state,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveSessionById(session);
}

/** Restore a saved table slot into the active app fields. Returns true on success. */
function restoreTable(id: string): boolean {
  const slot = app.tables.get(id);
  if (!slot) return false;
  if (app.botTimer) { clearTimeout(app.botTimer); app.botTimer = null; }
  app.state = slot.state;
  app.tournament = slot.tournament;
  app.botDifficulty = slot.botDifficulty;
  app.botDifficulties = slot.botDifficulties.slice();
  app.gameConfig = { ...slot.gameConfig };
  app.numPlayers = slot.numPlayers;
  app.matchStartChips = slot.matchStartChips;
  app.matchHandCount = slot.matchHandCount;
  app.sessionId = slot.id;
  setActiveSessionId(slot.id);
  renderTabStrip();
  renderTable(app.state);
  updateActionUI(app.state);
  refreshPlayerUX();
  renderTournamentHUD();
  scheduleBotIfNeeded();
  return true;
}

/** Render the tab strip at the top of the game screen. */
function renderTabStrip(): void {
  const strip = maybe$('table-tabs');
  if (!strip) return;
  // Snapshot active table so its label stays in sync without overwriting the
  // live state (shallow — same references, fine for display purposes).
  if (app.sessionId && app.mode === 'bot') {
    const existing = app.tables.get(app.sessionId);
    const slot: TableSlot = existing ?? {
      id: app.sessionId,
      state: app.state,
      tournament: app.tournament,
      botDifficulty: app.botDifficulty,
      botDifficulties: app.botDifficulties.slice(),
      gameConfig: { ...app.gameConfig },
      numPlayers: app.numPlayers,
      matchStartChips: app.matchStartChips,
      matchHandCount: app.matchHandCount,
      label: buildTableLabel(),
    };
    slot.label = buildTableLabel();
    app.tables.set(app.sessionId, slot);
  }

  strip.innerHTML = '';
  // Only show the strip if there's actually more than one table, or we're
  // in bot mode and the user might add one.
  if (app.mode !== 'bot') {
    strip.style.display = 'none';
    return;
  }
  strip.style.display = '';
  for (const [id, slot] of app.tables) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'table-tab' + (id === app.sessionId ? ' active' : '');
    tab.dataset['tableId'] = id;
    const handNum = slot.state.handNum;
    tab.innerHTML = `<span class="tt-label">${slot.label}</span><span class="tt-hand">#${handNum}</span>`;
    tab.addEventListener('click', () => {
      if (id === app.sessionId) return;
      snapshotActiveTable();
      restoreTable(id);
    });
    if (app.tables.size > 1) {
      const close = document.createElement('span');
      close.className = 'tt-close';
      close.textContent = '×';
      close.title = 'Close this table';
      close.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeTable(id);
      });
      tab.appendChild(close);
    }
    strip.appendChild(tab);
  }
  // "+" button to go back to the landing and add a new table.
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'table-tab table-tab-add';
  addBtn.textContent = '+';
  addBtn.title = 'Open a new table';
  addBtn.addEventListener('click', () => {
    snapshotActiveTable();
    showScreen(IDS.screenLanding);
  });
  strip.appendChild(addBtn);
}

/** Remove a table. If it was active, switch to another surviving table. */
function closeTable(id: string): void {
  const wasActive = id === app.sessionId;
  app.tables.delete(id);
  removeSession(id);
  if (!wasActive) {
    renderTabStrip();
    return;
  }
  // Switching active table — pick any survivor.
  const next = app.tables.keys().next().value;
  if (next) {
    restoreTable(next);
    return;
  }
  // No tables left → back to landing.
  app.sessionId = null;
  setActiveSessionId(null);
  showScreen(IDS.screenLanding);
}

// ═══════════════════════════════════════════════════════════════════════
// Tournament HUD — fixed banner at top of the game screen showing level,
// blinds, ante, alive count, ETA to next level, and the human seat's live
// ICM equity against the prize pool.
// ═══════════════════════════════════════════════════════════════════════

function renderTournamentHUD(): void {
  const hud = maybe$('tourney-hud');
  if (!hud) return;
  const t = app.tournament;
  if (!t || app.mode !== 'bot') {
    hud.style.display = 'none';
    return;
  }
  hud.style.display = '';

  const level = currentBlinds(t);
  const levelEl = maybe$('th-level');
  if (levelEl) levelEl.textContent = `L${level.level}`;
  const blindsEl = maybe$('th-blinds');
  if (blindsEl) blindsEl.textContent = `${level.sb}/${level.bb}`;
  const anteEl = maybe$('th-ante');
  if (anteEl) anteEl.textContent = level.ante > 0 ? String(level.ante) : '—';
  const alive = aliveSeats(app.state.chips);
  const aliveEl = maybe$('th-alive');
  if (aliveEl) aliveEl.textContent = `${alive.length}/${app.state.numPlayers}`;
  const nextEl = maybe$('th-next');
  if (nextEl) {
    const remaining = Math.max(0, level.handsPerLevel - t.handsAtLevel);
    nextEl.textContent = remaining > 0 ? `${remaining}h` : 'now';
  }

  // ICM equity for the human seat (index 0).
  const equityEl = maybe$('th-equity');
  if (equityEl) {
    const prizePool = t.structure.startingStack * app.state.numPlayers;
    const paid = Math.min(app.state.numPlayers, Math.max(1, Math.ceil(app.state.numPlayers / 2)));
    const payouts = defaultPayouts(prizePool, paid);
    const eq = icmEquity(app.state.chips, payouts);
    const mine = Math.round(eq[app.state.myIndex] ?? 0);
    equityEl.textContent = `$${mine}`;
  }
}

export function startBotGame(difficulty: Difficulty, numOpponents: number, config?: Partial<GameConfig>): void {
  // If there's an active bot-mode table, snapshot it before we replace it.
  if (app.mode === 'bot' && app.sessionId) snapshotActiveTable();
  const total = Math.max(2, Math.min(6, numOpponents + 1));
  opponentModel.reset();
  app.tournament = null;
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
  saveSessionById(session);
  setActiveSessionId(session.id);
  snapshotActiveTable();
  renderTabStrip();
  renderTournamentHUD(); // hides banner when cash (app.tournament === null)

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

  // Persistent journal entry for this match.
  app.logSessionId = startLogSession('poker', {
    mode: 'bot',
    label: `${diffLabel} · ${total - 1} bot${total - 1 > 1 ? 's' : ''} · $${humanChips}`,
  });

  // Chat panel — visible during solo matches too, but read-only with a
  // helpful placeholder. Users see the journal and can always chat by
  // inviting a friend from the lobby.
  clearChatHistory();
  showChatPanel(true);
  setChatMode('bot');
  appendChatSystem(`Solo match started — journal is live. Invite a friend from the lobby to unlock chat.`);

  hostStartHand();
}

/**
 * Start a tournament against bots. Uses a named structure ("turbo",
 * "standard", "deepstack"), seats the human at 0 with the structure's
 * starting stack, and runs escalating blinds via the tournament module.
 *
 * Unlike cash games, no bank withdrawal — the tournament has its own
 * isolated chip world until it ends. The bank is credited/debited on
 * match completion based on finish position and the ICM-derived payout.
 */
export function startTournamentGame(
  difficulty: Difficulty,
  numOpponents: number,
  structureKey: string,
  config?: Partial<GameConfig>,
): void {
  if (app.mode === 'bot' && app.sessionId) snapshotActiveTable();
  const total = Math.max(2, Math.min(6, numOpponents + 1));
  const structure: BlindStructure = STRUCTURES[structureKey] ?? STRUCTURES['standard']!;
  opponentModel.reset();
  app.mode = 'bot';
  app.botDifficulty = difficulty;
  app.numPlayers = total;
  app.role = 'host';
  app.myName = 'You';
  app.gameConfig = { ...DEFAULT_CONFIG, ...config };

  // Tournament has its own chip economy: every seat starts with the
  // structure's starting stack, regardless of the persistent bank.
  app.matchStartChips = structure.startingStack;
  app.matchHandCount = 0;

  const names = ['You'];
  const difficulties: Difficulty[] = [difficulty];
  for (let i = 1; i < total; i++) {
    names.push(`Bot ${i}`);
    difficulties.push(difficulty);
  }
  app.state = createGameState(total, 0, names, undefined, app.gameConfig);
  for (let i = 0; i < total; i++) app.state.chips[i] = structure.startingStack;
  app.botDifficulties = difficulties;
  app.myReady = true;
  app.oppReady = true;

  // Spin up tournament state + apply initial level's blinds.
  app.tournament = createTournament(structure);
  const lvl = currentBlinds(app.tournament);
  app.state.blinds = { sb: lvl.sb, bb: lvl.bb, ante: lvl.ante };

  const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  setConnStatus(
    'connected',
    `${structure.name} · ${diffLabel} · ${total - 1} bot${total - 1 > 1 ? 's' : ''}`,
  );
  clearLog();

  addLog({
    icon: 'info',
    text: `${structure.name} tournament · ${total} seats · starting stack $${structure.startingStack}`,
    category: 'system',
  });
  addLog({
    icon: 'info',
    text: `Level 1 blinds $${lvl.sb}/$${lvl.bb}${lvl.ante ? ` · ante $${lvl.ante}` : ''} · ${lvl.handsPerLevel} hands/level`,
    category: 'system',
  });

  // Show projected prize pool & payouts (informational only — real payout
  // happens at tournament end from surviving seats).
  const prizePool = structure.startingStack * total;
  const paid = Math.min(total, Math.max(1, Math.ceil(total / 2)));
  const payouts = defaultPayouts(prizePool, paid);
  addLog({
    icon: 'chip',
    text: `Prize pool $${prizePool} · pays top ${paid}: ${payouts.map(p => `$${p}`).join(' / ')}`,
    category: 'system',
  });
  logMatchDivider(
    `${structure.name} · ${diffLabel} · ${total - 1} ${total - 1 === 1 ? 'bot' : 'bots'}`,
  );

  // Register a new session ID so multi-table + resume both work.
  const session = createSession({
    mode: 'bot',
    difficulty,
    numPlayers: total,
    matchStartChips: structure.startingStack,
    state: app.state,
  });
  app.sessionId = session.id;
  saveSession(session);
  saveSessionById(session);
  setActiveSessionId(session.id);
  snapshotActiveTable();
  renderTabStrip();
  renderTournamentHUD();

  // Tournament journal + chat panel in read-only mode.
  app.logSessionId = startLogSession('poker', {
    mode: 'bot',
    label: `${structure.name} tournament · ${diffLabel} · ${total - 1} bots`,
  });
  clearChatHistory();
  showChatPanel(true);
  setChatMode('bot');
  appendChatSystem(`${structure.name} tournament started · $${structure.startingStack} stacks`);

  hostStartHand();
}

// ═══════════════════════════════════════════════════════════════════════
// Blackjack — fully separate from poker. Lives in its own app.blackjack
// slot + #screen-blackjack. Sessions, chips, and hand state never leak
// between the two game kinds.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Persistent blackjack bankroll — stored under its own key so the poker
 * bank is untouched. Realistic casino UX: if you walk up to a blackjack
 * table with no chips, the house reloads you to $1000.
 */
const BJ_BANK_KEY = 'iamjacke-blackjack-bank';

function loadBjBank(): number {
  try {
    const raw = localStorage.getItem(BJ_BANK_KEY);
    if (!raw) return 1000;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 1000;
  } catch {
    return 1000;
  }
}

function saveBjBank(chips: number): void {
  try { localStorage.setItem(BJ_BANK_KEY, String(chips)); } catch { /* ignore */ }
}

// Timing constants for the animated blackjack sequence. All values in ms.
const BJ_DEAL_STEP = 180;     // stagger between the 4 opening cards
const BJ_DEALER_STEP = 480;   // pause between each dealer hit
const BJ_HOLE_FLIP_MS = 620;  // hole card reveal duration
const BJ_SETTLE_DELAY = 420;  // pause after final dealer card before settling
const BJ_OUTCOME_MS = 1800;   // outcome banner hang time
const BJ_CHIP_FLY_MS = 500;   // chip fly travel time

function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** True while a staged animation is running — blocks re-entry on double-clicks. */
let bjBusy = false;

/**
 * Start a blackjack P2P session from a room code. Called by `init()` when
 * the URL has `?r=... &game=blackjack`. Each peer runs its own engine —
 * the shared state is the chat + presence + journal. This is a
 * deliberately-simple "side-by-side duel" model where the real benefit
 * of multiplayer is the chat, not simultaneous dealer play (that's a
 * bigger feature we'll layer on later via bj-deal messages).
 */
export function startBjP2PSession(roomId: string): void {
  app.gameKind = 'blackjack';
  app.mode = 'pvp';
  app.role = 'host'; // transport resolves this; onRoleChange flips us to guest if host slot is taken
  app.roomId = roomId;

  const persistedName = loadPlayerName() || '';
  app.myName = persistedName || 'Player';
  app.oppName = 'Opponent';

  // Each peer runs its own blackjack engine. Host picks the seed; guest
  // receives it via the first `bj-start` hello and rebuilds the same
  // deterministic shoe so any future sync can align.
  const chips = loadBjBank();
  const seed = Math.floor(Math.random() * 2 ** 31);
  app.blackjack = createBjState({
    numDecks: 6,
    standOnSoft17: true,
    startingChips: chips,
    seed,
  });
  bjBusy = false;

  // Persistent journal entry for this session.
  app.logSessionId = startLogSession('blackjack', {
    mode: 'pvp',
    label: `Room ${roomId}`,
  });
  appendLogEntry('blackjack', app.logSessionId, {
    kind: 'system',
    ts: Date.now(),
    text: `P2P room ${roomId} opened`,
  });

  // Start transports — same signed PeerJS/BroadcastChannel as poker PvP.
  startTransports(roomId);

  // Render the blackjack table + reveal chat panel.
  renderBlackjack(app.blackjack);
  showChatPanel(true);
  setChatMode('pvp');
  clearChatHistory();
  appendChatSystem(`Room ${roomId} — share the URL with a friend to play together.`);
  const shareUrl = `${window.location.origin}${window.location.pathname}?r=${encodeURIComponent(roomId)}&game=blackjack#/blackjack`;
  appendChatSystem(`Share link: ${shareUrl}`);
  try {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl).catch(() => { /* user dismissed */ });
    }
  } catch { /* no clipboard */ }
  showScreen(IDS.screenBlackjack);

  // Defer the bj-start broadcast until the transport actually opens.
  // handleMessage receives it on the other side and adopts our seed.
  // We do this opportunistically on every hello exchange — see below.
  app.bjP2PSeed = seed;
}

/**
 * Public entry point for starting a blackjack session. Delegates to the
 * router so the URL reflects the game kind. Calling this when already on
 * #/blackjack is a no-op (the table is already live).
 */
export function startBlackjackGame(): void {
  if (currentRoute() === '/blackjack') {
    // Already on the blackjack screen — re-initialize in place.
    mountBlackjackScreen();
    return;
  }
  navigateTo('#/blackjack');
}

/**
 * Idempotent initializer for the blackjack screen. Called by the router
 * when the URL resolves to '#/blackjack'. Safe to call on direct page
 * load or after browser back/forward navigation.
 */
function mountBlackjackScreen(): void {
  // Tear down any live poker timer.
  if (app.botTimer) { clearTimeout(app.botTimer); app.botTimer = null; }

  app.gameKind = 'blackjack';
  app.mode = 'bot';
  const chips = loadBjBank();
  // If a session already exists (e.g. user hit back/forward), keep it.
  if (!app.blackjack) {
    app.blackjack = createBjState({
      numDecks: 6,
      standOnSoft17: true,
      startingChips: chips,
    });
  }
  bjBusy = false;

  // Start a journal entry for this solo blackjack session if we don't
  // already have one. Entries accumulate as the player deals hands.
  if (!app.logSessionId) {
    app.logSessionId = startLogSession('blackjack', {
      mode: 'bot',
      label: `Solo · $${chips}`,
    });
  }
  // Chat panel visible as journal during solo play.
  clearChatHistory();
  showChatPanel(true);
  setChatMode('bot');
  appendChatSystem('Solo blackjack — journal is live. Multiplayer chat unlocks via "INVITE FRIEND".');

  renderBlackjack(app.blackjack);
  showScreen(IDS.screenBlackjack);
}

function bjPersistAndRender(): void {
  if (!app.blackjack) return;
  saveBjBank(app.blackjack.chips);
  renderBlackjack(app.blackjack);
}

/** DEAL — chip fly → engine deal → render → auto-settle path if BJ. */
async function bjOnDeal(): Promise<void> {
  if (!app.blackjack || bjBusy) return;
  const state = app.blackjack;

  const betInput = maybe$('bj-bet-input') as HTMLInputElement | null;
  const bet = Math.max(1, Math.floor(Number(betInput?.value ?? 50)));
  if (state.phase === 'settled') {
    bjReadyNextHand(state);
    renderBlackjack(state); // wipes old winner's DOM via diff
  }
  if (bet > state.chips) {
    alert(`Not enough chips — you have $${state.chips}`);
    return;
  }

  bjBusy = true;
  try {
    // Chip fly: bankroll label → betting circle.
    const chipsEl = maybe$('bj-chips');
    const circleEl = maybe$('bj-betting-circle');
    const chipCount = Math.min(5, 1 + Math.floor(Math.log10(bet + 1)));
    flyChip(chipsEl, circleEl, { amount: bet, count: chipCount });
    bjSfxChip();
    await wait(BJ_CHIP_FLY_MS);

    // Engine deals all 4 cards synchronously.
    try {
      bjStartHand(state, bet);
    } catch (e) {
      console.error('[bj] startHand failed', e);
      return;
    }
    renderBlackjack(state);

    // SFX for each dealt card, staggered.
    for (let i = 0; i < 4; i++) setTimeout(bjSfxDeal, i * BJ_DEAL_STEP);
    await wait(BJ_DEAL_STEP * 4 + 100);

    saveBjBank(state.chips);

    // Auto-settled paths (player natural BJ, dealer peek BJ).
    if (state.phase === 'settled') {
      flipDealerHole(state);
      bjSfxFlip();
      await wait(BJ_HOLE_FLIP_MS);
      renderBlackjack(state);
      await bjRunOutcome(state);
    }
  } finally {
    bjBusy = false;
    bjPersistAndRender();
  }
}

async function bjOnHit(): Promise<void> {
  if (!app.blackjack || bjBusy) return;
  if (app.blackjack.phase !== 'player') return;
  if (!legalBjActions(app.blackjack).hit) return;
  bjBusy = true;
  try {
    const result = bjHitStep(app.blackjack);
    renderBlackjack(app.blackjack);
    bjSfxDeal();
    await wait(260);
    if (result === 'dealer') {
      await bjRunDealerSequence();
    }
  } catch (e) {
    console.error('[bj] hit failed', e);
  } finally {
    bjBusy = false;
    bjPersistAndRender();
  }
}

async function bjOnStand(): Promise<void> {
  if (!app.blackjack || bjBusy) return;
  if (app.blackjack.phase !== 'player') return;
  if (!legalBjActions(app.blackjack).stand) return;
  bjBusy = true;
  try {
    const result = bjStandStep(app.blackjack);
    renderBlackjack(app.blackjack);
    if (result === 'dealer') {
      await bjRunDealerSequence();
    }
  } catch (e) {
    console.error('[bj] stand failed', e);
  } finally {
    bjBusy = false;
    bjPersistAndRender();
  }
}

async function bjOnDouble(): Promise<void> {
  if (!app.blackjack || bjBusy) return;
  if (app.blackjack.phase !== 'player') return;
  if (!legalBjActions(app.blackjack).double) return;
  bjBusy = true;
  try {
    // Chip fly for the matching bet.
    const activeHand = app.blackjack.hands[app.blackjack.activeHandIdx]!;
    const extra = activeHand.bet;
    flyChip(maybe$('bj-chips'), maybe$('bj-betting-circle'), {
      amount: extra,
      count: Math.min(5, 1 + Math.floor(Math.log10(extra + 1))),
    });
    bjSfxChip();
    await wait(BJ_CHIP_FLY_MS);

    const result = bjDoubleStep(app.blackjack);
    renderBlackjack(app.blackjack);
    bjSfxDeal();
    await wait(320);
    if (result === 'dealer') {
      await bjRunDealerSequence();
    }
  } catch (e) {
    console.error('[bj] double failed', e);
  } finally {
    bjBusy = false;
    bjPersistAndRender();
  }
}

async function bjOnSplit(): Promise<void> {
  if (!app.blackjack || bjBusy) return;
  if (app.blackjack.phase !== 'player') return;
  if (!legalBjActions(app.blackjack).split) return;
  bjBusy = true;
  try {
    const activeHand = app.blackjack.hands[app.blackjack.activeHandIdx]!;
    const extra = activeHand.bet;
    flyChip(maybe$('bj-chips'), maybe$('bj-betting-circle'), {
      amount: extra,
      count: Math.min(5, 1 + Math.floor(Math.log10(extra + 1))),
    });
    bjSfxChip();
    await wait(380);

    const result = bjSplitStep(app.blackjack);
    renderBlackjack(app.blackjack);
    setTimeout(bjSfxDeal, 120);
    setTimeout(bjSfxDeal, 280);
    await wait(420);
    if (result === 'dealer') {
      await bjRunDealerSequence();
    }
  } catch (e) {
    console.error('[bj] split failed', e);
  } finally {
    bjBusy = false;
    bjPersistAndRender();
  }
}

async function bjOnSurrender(): Promise<void> {
  if (!app.blackjack || bjBusy) return;
  if (app.blackjack.phase !== 'player') return;
  if (!legalBjActions(app.blackjack).surrender) return;
  bjBusy = true;
  try {
    const result = bjSurrenderStep(app.blackjack);
    renderBlackjack(app.blackjack);
    // Fade the bet chip stack out for the surrender half-return.
    maybe$('bj-betting-circle-chips')?.classList.add('fading-loss');
    await wait(360);
    if (result === 'dealer') {
      await bjRunDealerSequence();
    }
  } catch (e) {
    console.error('[bj] surrender failed', e);
  } finally {
    bjBusy = false;
    bjPersistAndRender();
  }
}

async function bjOnInsurance(accept: boolean): Promise<void> {
  if (!app.blackjack || bjBusy) return;
  bjBusy = true;
  try {
    const state = app.blackjack;
    if (accept) {
      flyChip(maybe$('bj-chips'), maybe$('bj-betting-circle'), {
        amount: Math.floor(state.currentBet / 2),
        count: 2,
      });
      bjSfxChip();
      await wait(BJ_CHIP_FLY_MS);
      bjTakeInsurance(state);
    } else {
      bjDeclineInsurance(state);
    }
    renderBlackjack(state);
    // If dealer had BJ, settlement already happened synchronously inside
    // the insurance flow — animate the hole flip + banner now.
    if (state.phase === 'settled') {
      flipDealerHole(state);
      bjSfxFlip();
      await wait(BJ_HOLE_FLIP_MS);
      renderBlackjack(state);
      await bjRunOutcome(state);
    }
  } catch (e) {
    console.error('[bj] insurance failed', e);
  } finally {
    bjBusy = false;
    bjPersistAndRender();
  }
}

/**
 * The heart of the rework — an animated dealer turn.
 * 1. Flip the hole card (CSS flip, ~600ms).
 * 2. Loop: check dealerShouldDraw → draw one card → render (diff appends) → wait.
 * 3. Pause, finalize, render, run outcome flash.
 */
async function bjRunDealerSequence(): Promise<void> {
  if (!app.blackjack) return;
  const state = app.blackjack;

  flipDealerHole(state);
  bjSfxFlip();
  await wait(BJ_HOLE_FLIP_MS);
  renderBlackjack(state); // dealer total label updates now that hole is visible

  while (bjDealerShouldDraw(state)) {
    bjDealerDrawOne(state);
    renderBlackjack(state);
    bjSfxDeal();
    await wait(BJ_DEALER_STEP);
  }

  await wait(BJ_SETTLE_DELAY);
  bjFinalizeHand(state);
  renderBlackjack(state);
  await bjRunOutcome(state);
}

/** Flash the outcome banner + payout fly-chips + aggregate sfx. */
async function bjRunOutcome(state: BjGameState): Promise<void> {
  flashOutcomeBanner(state);

  // Aggregate sfx — prioritize win over loss.
  const anyWin = state.hands.some(h => h.outcome === 'win' || h.outcome === 'blackjack');
  const anyLoss = state.hands.some(h => h.outcome === 'loss');
  if (anyWin) bjSfxWin();
  else if (anyLoss) bjSfxLose();

  // Per-hand payout / bet fade.
  for (let i = 0; i < state.hands.length; i++) {
    const h = state.hands[i]!;
    if (h.outcome === 'win' || h.outcome === 'blackjack' || h.outcome === 'push') {
      const payout = h.outcome === 'blackjack'
        ? h.bet + Math.floor(h.bet * 1.5)
        : h.outcome === 'win'
          ? h.bet * 2
          : h.bet;
      const count = Math.min(5, 1 + Math.floor(Math.log10(payout + 1)));
      setTimeout(
        () => flyChip(
          maybe$('bj-betting-circle'),
          maybe$('bj-chips'),
          { amount: payout, count, reverse: true },
        ),
        380 + i * 140,
      );
    } else if (h.outcome === 'loss') {
      maybe$('bj-betting-circle-chips')?.classList.add('fading-loss');
    }
  }

  await wait(BJ_OUTCOME_MS);
  saveBjBank(state.chips);
}

function bjExitToLanding(): void {
  if (app.blackjack) saveBjBank(app.blackjack.chips);
  app.blackjack = null;
  app.gameKind = 'poker';
  bjBusy = false;
  navigateTo('#/');
}

/**
 * Landing screen — default route handler. Called by the router when the
 * URL is '#/' or '#/poker'. Tears down any blackjack session but leaves
 * poker state alone (so the session-resume button still works).
 */
function mountLandingScreen(): void {
  if (app.gameKind === 'blackjack' && app.blackjack) {
    saveBjBank(app.blackjack.chips);
  }
  app.gameKind = 'poker';
  app.blackjack = null;
  if (app.botTimer) { clearTimeout(app.botTimer); app.botTimer = null; }
  showChatPanel(false);
  showScreen(IDS.screenLanding);
}

function bjShowHelp(lang: 'en' | 'ru'): void {
  const overlay = maybe$('bj-help-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  const bodyEn = maybe$('bj-help-body-en');
  const bodyRu = maybe$('bj-help-body-ru');
  if (bodyEn) bodyEn.style.display = lang === 'en' ? '' : 'none';
  if (bodyRu) bodyRu.style.display = lang === 'ru' ? '' : 'none';
  document.querySelectorAll<HTMLElement>('.bj-help-lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset['bjLang'] === lang);
  });
}

function bjHideHelp(): void {
  const overlay = maybe$('bj-help-overlay');
  if (overlay) overlay.style.display = 'none';
}

/** Wire blackjack event listeners once on init. */
function wireBlackjackHandlers(): void {
  maybe$('bj-btn-deal')?.addEventListener('click', () => { void bjOnDeal(); });
  maybe$('bj-btn-hit')?.addEventListener('click', () => { void bjOnHit(); });
  maybe$('bj-btn-stand')?.addEventListener('click', () => { void bjOnStand(); });
  maybe$('bj-btn-double')?.addEventListener('click', () => { void bjOnDouble(); });
  maybe$('bj-btn-split')?.addEventListener('click', () => { void bjOnSplit(); });
  maybe$('bj-btn-surrender')?.addEventListener('click', () => { void bjOnSurrender(); });
  maybe$('bj-btn-insurance-yes')?.addEventListener('click', () => { void bjOnInsurance(true); });
  maybe$('bj-btn-insurance-no')?.addEventListener('click', () => { void bjOnInsurance(false); });
  maybe$('bj-btn-exit')?.addEventListener('click', bjExitToLanding);
  // Help overlay
  maybe$('bj-btn-help')?.addEventListener('click', () => {
    bjShowHelp(getLang() as 'en' | 'ru');
  });
  maybe$('bj-help-close')?.addEventListener('click', bjHideHelp);
  document.querySelectorAll<HTMLElement>('.bj-help-lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset['bjLang'];
      if (lang === 'en' || lang === 'ru') bjShowHelp(lang);
    });
  });
  // Click outside modal to close
  maybe$('bj-help-overlay')?.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).id === 'bj-help-overlay') bjHideHelp();
  });

  // Bet chip presets
  document.querySelectorAll<HTMLElement>('[data-bj-bet]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = maybe$('bj-bet-input') as HTMLInputElement | null;
      if (!input || !app.blackjack) return;
      const delta = Number(btn.dataset['bjBet'] ?? 0);
      const cur = Math.max(0, Number(input.value) || 0);
      const next = Math.max(1, Math.min(app.blackjack.chips, cur + delta));
      input.value = String(next);
      renderBlackjack(app.blackjack);
    });
  });
  maybe$('bj-btn-clear-bet')?.addEventListener('click', () => {
    const input = maybe$('bj-bet-input') as HTMLInputElement | null;
    if (input) input.value = '0';
    if (app.blackjack) renderBlackjack(app.blackjack);
  });
  maybe$('bj-bet-input')?.addEventListener('input', () => {
    if (app.blackjack) renderBlackjack(app.blackjack);
  });

  // Keyboard shortcuts — H/S/D/P/R only while blackjack is active and
  // the player has the turn. Ignores key presses while focused in any
  // input (otherwise typing the bet would trigger Hit).
  document.addEventListener('keydown', (ev) => {
    if (app.gameKind !== 'blackjack' || !app.blackjack) return;
    const target = document.activeElement as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
    // Insurance phase accepts Y/N.
    if (app.blackjack.phase === 'insurance') {
      if (ev.key === 'y' || ev.key === 'Y') { ev.preventDefault(); void bjOnInsurance(true); }
      else if (ev.key === 'n' || ev.key === 'N') { ev.preventDefault(); void bjOnInsurance(false); }
      return;
    }
    // Deal / next hand accepts Space or Enter when idle/settled.
    if (app.blackjack.phase === 'idle' || app.blackjack.phase === 'settled') {
      if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); void bjOnDeal(); }
      return;
    }
    // Player turn: H/S/D/P/R.
    if (app.blackjack.phase !== 'player') return;
    const legal = legalBjActions(app.blackjack);
    const k = ev.key.toLowerCase();
    if (k === 'h' && legal.hit)             { ev.preventDefault(); void bjOnHit(); }
    else if (k === 's' && legal.stand)      { ev.preventDefault(); void bjOnStand(); }
    else if (k === 'd' && legal.double)     { ev.preventDefault(); void bjOnDouble(); }
    else if (k === 'p' && legal.split)      { ev.preventDefault(); void bjOnSplit(); }
    else if (k === 'r' && legal.surrender)  { ev.preventDefault(); void bjOnSurrender(); }
  });
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
  setLang(settings.lang as Lang);
  // Restore persisted player name — prefills the ready-screen input + is
  // used as the outgoing hello name instead of default "Host"/"Guest".
  const savedName = loadPlayerName();
  if (savedName) app.myName = savedName;
  wireSettings(settings);

  // Unlock audio on first gesture (browser requirement).
  const unlock = () => { unlockAudio(); document.removeEventListener('pointerdown', unlock); };
  document.addEventListener('pointerdown', unlock);

  // Init other games
  import('./durak/index.js').then(m => m.initDurak());

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
  // First-paint translations for any [data-i18n] element already in DOM.
  applyI18n();

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
  const gameParam = getParam('game');

  // Blackjack PvP is detected by `?r=... &game=blackjack`. It uses the
  // existing signed transports (PeerJS + BroadcastChannel) for chat +
  // opponent presence, but each peer runs its own blackjack engine. The
  // match log captures hands + chat end-to-end.
  if (r && gameParam === 'blackjack') {
    startBjP2PSession(r);
    return;
  }

  if (!r) {
    // Hash-based router decides which screen to show first. Defaults to
    // the landing; #/blackjack jumps straight to the blackjack table.
    onRoute('#/', mountLandingScreen);
    onRoute('#/poker', mountLandingScreen);
    onRoute('#/blackjack', mountBlackjackScreen);
    onRouteFallback(() => navigateTo('#/', { replace: true }));
    initRouter();
    return;
  }

  // PvP — the URL may carry a `session` token. If it does, this client has
  // been to this room before and wants to reclaim its original seat.
  const sessionToken = getParam('session');
  const pvpSession = sessionToken
    ? loadPvpSession(r, sessionToken)
    : null;

  // Seed name from the saved player-name localStorage — never the default
  // 'Host'/'Guest' — AND write it into the right seat index.
  const persistedName = loadPlayerName() || '';

  if (pvpSession) {
    // Resume path — rehydrate myIndex + role from the saved session snapshot.
    app.roomId = r;
    app.role = pvpSession.role;
    const myIdx = pvpSession.myIndex;
    app.myName = pvpSession.myName || persistedName || (app.role === 'host' ? 'Host' : 'Guest');
    app.state = createGameState(2, myIdx as 0 | 1, [
      myIdx === 0 ? app.myName : (pvpSession.oppName || 'Opponent'),
      myIdx === 1 ? app.myName : (pvpSession.oppName || 'Opponent'),
    ]);
    app.oppName = pvpSession.oppName || 'Opponent';
    app.sessionId = sessionToken;
  } else {
    // Fresh join — 2-tab scenario: the first tab is host (no URL param),
    // the second tab opens the ?r= URL and is guest by default.
    app.roomId = r;
    app.role = 'guest';
    app.myName = persistedName || 'Guest';
    app.oppName = 'Opponent';
    app.state = createGameState(2, 1, [app.oppName, app.myName]);
    // Mint a new session token for this player.
    app.sessionId = mintPvpSession(r, { role: 'guest', myIndex: 1, myName: app.myName });
  }
  app.numPlayers = 2;

  $(IDS.yourNameLabel).textContent = app.myName;
  $(IDS.readyYouName).textContent = app.myName;
  $(IDS.roomCodeDisplay).textContent = r;
  // Share link includes only ?r= (no session token) so friends get a fresh
  // guest token when they click. The CURRENT tab keeps its own token in the URL.
  ($(IDS.shareLinkInput) as HTMLInputElement).value = `${window.location.origin}/poker/?r=${r}`;
  // Inject the session token into our own URL so a reload restores us.
  if (app.sessionId) {
    const url = new URL(window.location.href);
    url.searchParams.set('session', app.sessionId);
    window.history.replaceState({}, '', url.toString());
  }

  showScreen(IDS.screenWaiting);
  setConnStatus('connecting', 'Joining…');
  startTransports(r);
}

// ═══════════════════════════════════════════════════════════════════════
// Match log viewer — always-accessible modal with one row per session and
// expandable per-session details (hands + chat + system events).
// ═══════════════════════════════════════════════════════════════════════

function showMatchLog(kind: GameKind): void {
  const overlay = maybe$('match-log-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  renderMatchLogBody(kind);
  document.querySelectorAll<HTMLElement>('.match-log-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset['mlogKind'] === kind);
  });
}

function hideMatchLog(): void {
  const overlay = maybe$('match-log-overlay');
  if (overlay) overlay.style.display = 'none';
}

function renderMatchLogBody(kind: GameKind): void {
  const body = maybe$('match-log-body');
  if (!body) return;
  const sessions = listLogSessions(kind);
  if (sessions.length === 0) {
    body.innerHTML = `<div class="mlog-empty">No ${kind} sessions logged yet.<br>Play a match to start building your journal.</div>`;
    return;
  }
  body.innerHTML = '';
  for (const session of sessions) {
    body.appendChild(renderSessionCard(session));
  }
}

function renderSessionCard(session: LoggedSession): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mlog-session';
  const delta = session.finalDelta;
  const deltaClass = delta === null || delta === 0 ? '' : delta > 0 ? 'pos' : 'neg';
  const deltaText = delta === null ? '—' : delta > 0 ? `+$${delta}` : `−$${Math.abs(delta)}`;
  wrap.innerHTML = `
    <div class="mlog-session-header">
      <div>
        <div class="mlog-session-label">${escapeHtml(session.label)}</div>
      </div>
      <div class="mlog-session-meta">
        <span class="mlog-session-mode">${session.mode.toUpperCase()}</span>
        <span class="mlog-session-delta ${deltaClass}">${deltaText}</span>
        <span class="mlog-session-time">${relativeTime(session.startedAt)}</span>
      </div>
    </div>
    <div class="mlog-session-entries"></div>
  `;
  const header = wrap.querySelector<HTMLElement>('.mlog-session-header')!;
  const entries = wrap.querySelector<HTMLElement>('.mlog-session-entries')!;
  header.addEventListener('click', () => {
    wrap.classList.toggle('expanded');
    if (wrap.classList.contains('expanded') && entries.children.length === 0) {
      populateEntries(entries, session.entries);
    }
  });
  return wrap;
}

function populateEntries(container: HTMLElement, entries: LogEntry[]): void {
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'mlog-entry ' + entry.kind;
    const time = new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let bodyHtml = '';
    if (entry.kind === 'chat') {
      bodyHtml = `<span class="mlog-chat-from">${escapeHtml(entry.from)}:</span>${escapeHtml(entry.text)}`;
    } else if (entry.kind === 'hand') {
      bodyHtml = escapeHtml(entry.summary);
    } else {
      bodyHtml = escapeHtml(entry.text);
    }
    row.innerHTML = `<span class="mlog-entry-ts">${time}</span><span class="mlog-entry-body">${bodyHtml}</span>`;
    container.appendChild(row);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function attachEventListeners(): void {
  // Two-step solo picker: difficulty tabs + count tiles
  buildSoloPicker();

  // Chat panel — always visible during any game session (bot or PvP).
  // In P2P mode: messages go through the signed transport to the opponent.
  // In bot mode: the input is disabled with a helpful system message, but
  // the panel stays visible so the journal is always reachable.
  initChatPanel({
    onSend: (text) => {
      if (app.mode !== 'pvp') {
        appendChatSystem('Chat requires a multiplayer session. Use "INVITE FRIEND" from the lobby.');
        return false;
      }
      const msg = {
        type: 'chat' as const,
        from: app.myName || 'You',
        text,
        ts: Date.now(),
      };
      try { send(msg); } catch { return false; }
      appendChatMessage(msg, { mine: true });
      if (app.logSessionId) {
        appendLogEntry(app.gameKind, app.logSessionId, {
          kind: 'chat', ts: msg.ts, from: msg.from, text: msg.text,
        });
      }
      return true;
    },
  });

  // Match log viewer — triggered by the journal button in header-chrome.
  maybe$('btn-match-log')?.addEventListener('click', () => showMatchLog('poker'));
  maybe$('match-log-close')?.addEventListener('click', hideMatchLog);
  document.querySelectorAll<HTMLElement>('.match-log-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset['mlogKind'] as GameKind | undefined;
      if (!kind) return;
      showMatchLog(kind);
    });
  });
  maybe$('match-log-overlay')?.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).id === 'match-log-overlay') hideMatchLog();
  });

  // Blackjack entry — route change so the URL reflects the game kind.
  maybe$('btn-blackjack')?.addEventListener('click', () => navigateTo('#/blackjack'));
  // Blackjack P2P — generate a room code, jump to the waiting flow.
  maybe$('btn-blackjack-pvp')?.addEventListener('click', () => {
    const code = 'BJ' + Math.random().toString(36).slice(2, 7).toUpperCase();
    const url = new URL(window.location.href);
    url.searchParams.set('r', code);
    url.searchParams.set('game', 'blackjack');
    url.hash = '#/blackjack';
    window.location.href = url.toString();
  });
  wireBlackjackHandlers();

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

  // FIND MATCH — server-assisted matchmaker. Hides itself if disabled
  // via `localStorage.setItem('iamjacke-matchmaking-disabled', '1')`.
  const findBtn = maybe$(IDS.btnFindMatch);
  if (findBtn) {
    if (!clientConfig.matchmakingEnabled) {
      findBtn.style.display = 'none';
    } else {
      findBtn.addEventListener('click', () => {
        if (app.ws || app.bc || app.peer) return;
        const persistedName = loadPlayerName() || 'You';
        startMatchmakerFlow(persistedName);
      });
    }
  }

  // Create PvP game
  maybe$(IDS.btnCreateGame)?.addEventListener('click', () => {
    if (app.bc || app.peer) return;
    const newRoomId = genRoomId();
    app.mode = 'pvp';
    app.roomId = newRoomId;
    app.role = 'host';
    // Use the persisted player name as the seat label, not default 'Host'.
    const persistedName = loadPlayerName();
    app.myName = persistedName || 'Host';
    app.oppName = 'Opponent';
    app.state = createGameState(2, 0, [app.myName, app.oppName]);
    app.numPlayers = 2;
    // Mint a per-player session token for resume.
    app.sessionId = mintPvpSession(newRoomId, { role: 'host', myIndex: 0, myName: app.myName });
    // Push a URL with both r= and session= so a reload re-seats this player.
    window.history.pushState({}, '', `/poker/?r=${newRoomId}&session=${app.sessionId}`);
    $(IDS.yourNameLabel).textContent = app.myName;
    $(IDS.readyYouName).textContent = app.myName;
    $(IDS.roomCodeDisplay).textContent = newRoomId;
    // The share link has ONLY the room code — friend gets their own token.
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

  // Language toggle — on ready screen (.lang-btn pills) AND header chrome (#btn-lang).
  const langButtons = document.querySelectorAll<HTMLElement>('.lang-btn');
  const langCodeEl = maybe$('lang-code');
  const syncLangUI = () => {
    const cur = getLang();
    langButtons.forEach(b => b.classList.toggle('active', b.dataset['lang'] === cur));
    if (langCodeEl) langCodeEl.textContent = cur.toUpperCase();
  };
  const applyLangChange = (lang: Lang) => {
    const current = loadSettings();
    const next: Settings = { ...current, lang };
    saveSettings(next);
    applySettings(next);
    setLang(lang);
    syncLangUI();
    // Re-render every piece of UI whose strings come from JS, not data-i18n.
    buildSoloPicker();
    if (maybe$(IDS.screenReady)?.classList.contains('active')) setupReadyScreen();
    // Repopulate rules content in both side panel + modal.
    const html = rulesHtml();
    const sideBody = document.querySelector('.rules-aside-body');
    const modalBody = maybe$('rules-modal-body');
    if (sideBody) sideBody.innerHTML = html;
    if (modalBody) modalBody.innerHTML = html;
    // Action-button texts below slider use t() too — rerun updateActionUI
    // to refresh 'Call $X', 'Check', 'Waiting for ...' prompts.
    updateActionUI(app.state);
  };
  langButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset['lang'] as Lang | undefined;
      if (lang) applyLangChange(lang);
    });
  });
  // Header chrome language button — round-robin toggle.
  maybe$('btn-lang')?.addEventListener('click', () => {
    const next: Lang = getLang() === 'en' ? 'ru' : 'en';
    applyLangChange(next);
  });
  syncLangUI();

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

  // Rules: context-sensitive.
  //   - On blackjack screen → open the bilingual blackjack help overlay.
  //   - During a live poker game → toggle the side-panel rules aside.
  //   - On the landing → show the full poker rules modal.
  maybe$('btn-rules')?.addEventListener('click', () => {
    if (app.gameKind === 'blackjack') {
      bjShowHelp(getLang() as 'en' | 'ru');
      return;
    }
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

  // Export last match as PokerStars HHF text
  maybe$('btn-export-hhf')?.addEventListener('click', () => {
    const m = loadMatch();
    if (!m) {
      alert('No completed match to export yet. Play a bot game to game-over first.');
      return;
    }
    const text = matchToHHF(m);
    downloadHHF(text, 'iamjacke-poker');
  });

  // Export lifetime match history as CSV (one row per match)
  maybe$('btn-export-csv')?.addEventListener('click', () => {
    const history = loadHistory();
    if (history.length === 0) {
      alert('No lifetime stats yet. Finish at least one match first.');
      return;
    }
    const csv = matchHistoryToCsv(history);
    downloadCsv(csv, 'iamjacke-stats');
  });

  // Export lifetime summary as a key-value CSV digest
  maybe$('btn-export-summary')?.addEventListener('click', () => {
    const history = loadHistory();
    const csv = lifetimeSummaryToCsv(history);
    downloadCsv(csv, 'iamjacke-summary');
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

// ═══════════════════════════════════════════════════════════════════════
// Player name persistence
// ═══════════════════════════════════════════════════════════════════════

const PLAYER_NAME_KEY = 'iamjacke-poker-player-name';

function loadPlayerName(): string {
  try { return localStorage.getItem(PLAYER_NAME_KEY) ?? ''; }
  catch { return ''; }
}

function savePlayerName(name: string): void {
  try {
    if (name) localStorage.setItem(PLAYER_NAME_KEY, name);
    else localStorage.removeItem(PLAYER_NAME_KEY);
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════
// PvP session resume via URL token
// ═══════════════════════════════════════════════════════════════════════

interface PvpSessionSnapshot {
  role: Role;
  myIndex: number;
  myName: string;
  oppName?: string;
  createdAt: number;
}

function pvpSessionKey(roomId: string, token: string): string {
  return `iamjacke-poker-pvp:${roomId}:${token}`;
}

function mintPvpSession(roomId: string, data: Omit<PvpSessionSnapshot, 'createdAt'>): string {
  const token = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? (crypto as { randomUUID: () => string }).randomUUID().slice(0, 12)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const snap: PvpSessionSnapshot = { ...data, createdAt: Date.now() };
  try { localStorage.setItem(pvpSessionKey(roomId, token), JSON.stringify(snap)); }
  catch { /* ignore */ }
  return token;
}

function loadPvpSession(roomId: string, token: string): PvpSessionSnapshot | null {
  try {
    const raw = localStorage.getItem(pvpSessionKey(roomId, token));
    if (!raw) return null;
    return JSON.parse(raw) as PvpSessionSnapshot;
  } catch { return null; }
}

function updatePvpSession(roomId: string, token: string, patch: Partial<PvpSessionSnapshot>): void {
  const existing = loadPvpSession(roomId, token);
  if (!existing) return;
  try {
    localStorage.setItem(pvpSessionKey(roomId, token), JSON.stringify({ ...existing, ...patch }));
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════
// Ready screen setup — variant card, name input, lang toggle
// ═══════════════════════════════════════════════════════════════════════

function setupReadyScreen(): void {
  const nameInput = maybe$('ready-name-input') as HTMLInputElement | null;
  if (nameInput) {
    nameInput.value = app.myName || loadPlayerName() || '';
    nameInput.placeholder = t('ready.yourName');
    nameInput.addEventListener('input', () => {
      const v = nameInput.value.trim().slice(0, 18);
      app.myName = v || (app.role === 'host' ? 'Host' : 'Guest');
      savePlayerName(v);
      if (app.state) {
        app.state.names[app.state.myIndex] = app.myName;
      }
      const yourLabel = maybe$(IDS.readyYouName);
      if (yourLabel) yourLabel.textContent = app.myName;
      // Re-announce to peer so they update their oppName label instantly.
      try { send({ type: 'hello', name: app.myName }); } catch { /* ignore */ }
      // Persist the updated name into the pvp session snapshot.
      if (app.mode === 'pvp' && app.sessionId) {
        updatePvpSession(app.roomId, app.sessionId, {
          myName: app.myName,
          oppName: app.oppName,
        });
      }
    });
  }

  // Populate variant card from current state/config.
  const config = app.state.config ?? { variant: 'holdem', holeCards: 2 };
  const variant = (config.variant ?? 'holdem') as string;
  const variantNameMap: Record<string, string> = {
    holdem: 'ready.variantHoldem',
    omaha: 'ready.variantOmaha',
    shortdeck: 'ready.variantShortDeck',
    pineapple: 'ready.variantPineapple',
    crazypineapple: 'ready.variantCrazyPineapple',
    irish: 'ready.variantIrish',
  };
  const nameKey = variantNameMap[variant] ?? 'ready.variantHoldem';
  const nameEl = maybe$('ready-variant-name');
  if (nameEl) nameEl.textContent = t(nameKey);
  const holeEl = maybe$('ready-holecards');
  if (holeEl) holeEl.textContent = String(config.holeCards ?? 2);
  const blindsEl = maybe$('ready-blinds');
  if (blindsEl) blindsEl.textContent = '10 / 20';
  const buyinEl = maybe$('ready-buyin');
  if (buyinEl) buyinEl.textContent = `$${app.matchStartChips || 1000}`;
  const playersEl = maybe$('ready-playercount');
  if (playersEl) playersEl.textContent = String(app.state.numPlayers);

  // Variant blurb
  const descMap: Record<string, string> = {
    holdem: '',
    omaha: 'Must use exactly 2 hole cards + 3 from the board.',
    shortdeck: '36-card deck · A-6-7-8-9 is the lowest straight',
    pineapple: '3 hole cards · discard 1 before the flop',
    crazypineapple: '3 hole cards · discard 1 after the flop',
    irish: '4 hole cards · discard 2 before the turn',
  };
  const descEl = maybe$('ready-variant-desc');
  if (descEl) descEl.textContent = descMap[variant] ?? '';
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
import { buildTimeline, snapshotAt, totalFrames, type Timeline } from './history/replay-engine.js';

// Replay session lives at module scope so the control bar's handlers can
// reach into it. Only ever one active replay at a time.
interface ReplaySession {
  timeline: Timeline;
  current: number;
  playing: boolean;
  playTimer: ReturnType<typeof setTimeout> | null;
}
let replaySession: ReplaySession | null = null;

function startReplay(match: Match): void {
  if (app.botTimer) { clearTimeout(app.botTimer); app.botTimer = null; }
  app.mode = 'bot'; // prevents any networking path
  app.tournament = null;
  const timeline = buildTimeline(match);
  replaySession = { timeline, current: 0, playing: false, playTimer: null };

  // Seed the app with an initial state sized for the match so the seats
  // render immediately; snapshotAt below rehydrates the real values.
  app.state = createGameState(match.numPlayers, 0, match.names);
  app.numPlayers = match.numPlayers;
  setConnStatus('connected', 'Replay');
  clearLog();
  showScreen(IDS.screenGame);
  ensureReplayControls();
  renderReplayFrame();
  addLog({
    icon: 'info',
    text: `Replay loaded — ${match.hands.length} hand${match.hands.length === 1 ? '' : 's'}, ${totalFrames(timeline)} frames`,
    category: 'system',
  });
}

function renderReplayFrame(): void {
  if (!replaySession) return;
  const { timeline, current } = replaySession;
  const frame = timeline.frames[current]!;
  // Showdown + end-of-hand frames reveal all cards.
  const revealAll = frame.kind === 'end';
  app.state = snapshotAt(timeline, current);
  renderTable(app.state, revealAll);
  updateActionUI(app.state);
  updateReplayControls();
}

function stopReplayPlayback(): void {
  if (!replaySession) return;
  replaySession.playing = false;
  if (replaySession.playTimer) {
    clearTimeout(replaySession.playTimer);
    replaySession.playTimer = null;
  }
}

function scheduleReplayStep(): void {
  if (!replaySession || !replaySession.playing) return;
  replaySession.playTimer = setTimeout(() => {
    if (!replaySession || !replaySession.playing) return;
    if (replaySession.current >= totalFrames(replaySession.timeline) - 1) {
      stopReplayPlayback();
      updateReplayControls();
      return;
    }
    replaySession.current++;
    renderReplayFrame();
    scheduleReplayStep();
  }, 650);
}

function ensureReplayControls(): void {
  if (maybe$('replay-controls')) return;
  const bar = document.createElement('div');
  bar.id = 'replay-controls';
  bar.className = 'replay-controls';
  bar.innerHTML = `
    <button type="button" class="rc-btn" data-rc="first" title="First">⏮</button>
    <button type="button" class="rc-btn" data-rc="prev"  title="Step back">◀</button>
    <button type="button" class="rc-btn rc-play" data-rc="play" title="Play">▶</button>
    <button type="button" class="rc-btn" data-rc="next"  title="Step forward">▶|</button>
    <button type="button" class="rc-btn" data-rc="last"  title="Last">⏭</button>
    <input type="range" class="rc-seek" data-rc="seek" min="0" max="0" value="0">
    <span class="rc-pos" data-rc="pos">0 / 0</span>
    <span class="rc-label" data-rc="label"></span>
    <button type="button" class="rc-btn rc-exit" data-rc="exit" title="Exit replay">✕</button>
  `;
  // Attach to the game screen.
  const screen = document.getElementById(IDS.screenGame);
  if (screen) screen.appendChild(bar);
  bar.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const action = target.dataset['rc'];
    if (!action || !replaySession) return;
    switch (action) {
      case 'first':
        stopReplayPlayback();
        replaySession.current = 0;
        renderReplayFrame();
        break;
      case 'prev':
        stopReplayPlayback();
        replaySession.current = Math.max(0, replaySession.current - 1);
        renderReplayFrame();
        break;
      case 'play':
        if (replaySession.playing) {
          stopReplayPlayback();
        } else {
          replaySession.playing = true;
          if (replaySession.current >= totalFrames(replaySession.timeline) - 1) {
            replaySession.current = 0;
          }
          renderReplayFrame();
          scheduleReplayStep();
        }
        updateReplayControls();
        break;
      case 'next': {
        stopReplayPlayback();
        const max = totalFrames(replaySession.timeline) - 1;
        replaySession.current = Math.min(max, replaySession.current + 1);
        renderReplayFrame();
        break;
      }
      case 'last':
        stopReplayPlayback();
        replaySession.current = totalFrames(replaySession.timeline) - 1;
        renderReplayFrame();
        break;
      case 'exit':
        exitReplay();
        break;
    }
  });
  const seek = bar.querySelector<HTMLInputElement>('[data-rc="seek"]');
  seek?.addEventListener('input', () => {
    if (!replaySession) return;
    stopReplayPlayback();
    replaySession.current = Number(seek.value);
    renderReplayFrame();
  });
}

function updateReplayControls(): void {
  if (!replaySession) return;
  const bar = maybe$('replay-controls');
  if (!bar) return;
  const total = totalFrames(replaySession.timeline);
  const cur = replaySession.current;
  const seek = bar.querySelector<HTMLInputElement>('[data-rc="seek"]');
  if (seek) {
    seek.max = String(total - 1);
    seek.value = String(cur);
  }
  const pos = bar.querySelector<HTMLElement>('[data-rc="pos"]');
  if (pos) pos.textContent = `${cur + 1} / ${total}`;
  const labelEl = bar.querySelector<HTMLElement>('[data-rc="label"]');
  const frame = replaySession.timeline.frames[cur];
  if (labelEl && frame) labelEl.textContent = frame.label;
  const playBtn = bar.querySelector<HTMLElement>('[data-rc="play"]');
  if (playBtn) playBtn.textContent = replaySession.playing ? '⏸' : '▶';
}

function exitReplay(): void {
  stopReplayPlayback();
  const bar = maybe$('replay-controls');
  if (bar) bar.remove();
  replaySession = null;
  setConnStatus('connecting', '');
  showScreen(IDS.screenLanding);
}
