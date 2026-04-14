/**
 * Persistent bank — the human player's chip balance survives page reloads
 * and match-to-match. A short history of completed matches is also stored
 * so the action log can show "previous match" dividers.
 */

const BANK_KEY = 'iamjacke-poker-bank';
const HISTORY_KEY = 'iamjacke-poker-match-history';
const RELOAD_MIN = 1000;          // minimum "buy-in" after a bust
const RELOAD_TOP_UP = 1000;       // if bank drops below this, top up to 1000

export interface BankState {
  chips: number;
  /** Running net delta since the bank was first created, for UI stats. */
  netLifetime: number;
  /** Total matches completed. */
  matchesPlayed: number;
  updatedAt: number;
}

export interface MatchRecord {
  timestamp: number;
  numPlayers: number;
  difficulty: string;
  /** Chips you had at start of match. */
  startChips: number;
  /** Chips you ended with. */
  endChips: number;
  /** Net change (endChips - startChips). */
  delta: number;
  /** Did you win (more chips than you started with AND game-over)? */
  won: boolean;
  /** Number of hands played. */
  hands: number;
}

const DEFAULT_BANK: BankState = {
  chips: RELOAD_MIN,
  netLifetime: 0,
  matchesPlayed: 0,
  updatedAt: Date.now(),
};

// ═══════════════════════════════════════════════════════════════════════
// Bank read/write
// ═══════════════════════════════════════════════════════════════════════

export function loadBank(): BankState {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    if (!raw) return { ...DEFAULT_BANK };
    const parsed = JSON.parse(raw) as Partial<BankState>;
    return {
      chips: parsed.chips ?? DEFAULT_BANK.chips,
      netLifetime: parsed.netLifetime ?? 0,
      matchesPlayed: parsed.matchesPlayed ?? 0,
      updatedAt: parsed.updatedAt ?? Date.now(),
    };
  } catch {
    return { ...DEFAULT_BANK };
  }
}

export function saveBank(bank: BankState): void {
  try {
    localStorage.setItem(BANK_KEY, JSON.stringify({ ...bank, updatedAt: Date.now() }));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function resetBank(): void {
  try { localStorage.removeItem(BANK_KEY); } catch { /* ignore */ }
}

/**
 * Return the chip amount to start a new match with. Tops up if the user
 * busted last time — a bottomless casino wallet beats a dead-end.
 */
export function buyIn(): number {
  const bank = loadBank();
  if (bank.chips <= 0) {
    bank.chips = RELOAD_TOP_UP;
    saveBank(bank);
    return RELOAD_TOP_UP;
  }
  return bank.chips;
}

/**
 * Commit the result of a match to the bank + history.
 * Called at game-over time.
 */
export function commitMatch(result: {
  startChips: number;
  endChips: number;
  numPlayers: number;
  difficulty: string;
  hands: number;
}): BankState {
  const bank = loadBank();
  const delta = result.endChips - result.startChips;
  bank.chips = result.endChips;
  bank.netLifetime += delta;
  bank.matchesPlayed += 1;
  saveBank(bank);

  const record: MatchRecord = {
    timestamp: Date.now(),
    numPlayers: result.numPlayers,
    difficulty: result.difficulty,
    startChips: result.startChips,
    endChips: result.endChips,
    delta,
    won: delta > 0 && result.endChips > 0,
    hands: result.hands,
  };
  pushHistory(record);
  return bank;
}

// ═══════════════════════════════════════════════════════════════════════
// Match history (rolling buffer)
// ═══════════════════════════════════════════════════════════════════════

const MAX_HISTORY = 20;

export function loadHistory(): MatchRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MatchRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(list: MatchRecord[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch {
    /* ignore */
  }
}

export function pushHistory(rec: MatchRecord): void {
  const list = loadHistory();
  list.unshift(rec);
  saveHistory(list);
}

export function clearHistory(): void {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}

/** Short human summary like "+$420 · 12 hands · 3 bots hard". */
export function formatMatchSummary(rec: MatchRecord): string {
  const sign = rec.delta >= 0 ? '+' : '';
  const bots = rec.numPlayers - 1;
  return `${sign}$${rec.delta} · ${rec.hands} hand${rec.hands === 1 ? '' : 's'} · ${bots} ${rec.difficulty} bot${bots === 1 ? '' : 's'}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Lifetime stats — derived from bank + history
// ═══════════════════════════════════════════════════════════════════════

export interface LifetimeStats {
  bank: number;
  lifetime: number;
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  handsPlayed: number;
  biggestWin: number;
  biggestLoss: number;
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreak: { kind: 'win' | 'loss' | 'none'; length: number };
  favouriteDifficulty: string;
}

export function computeStats(): LifetimeStats {
  const bank = loadBank();
  const history = loadHistory();

  let wins = 0;
  let losses = 0;
  let handsPlayed = 0;
  let biggestWin = 0;
  let biggestLoss = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let runKind: 'win' | 'loss' | 'none' = 'none';
  let runLength = 0;
  const diffCounts: Record<string, number> = {};

  // History is most-recent-first. Walk oldest → newest for streak logic.
  for (let i = history.length - 1; i >= 0; i--) {
    const rec = history[i]!;
    handsPlayed += rec.hands;
    if (rec.delta > biggestWin) biggestWin = rec.delta;
    if (rec.delta < biggestLoss) biggestLoss = rec.delta;
    diffCounts[rec.difficulty] = (diffCounts[rec.difficulty] ?? 0) + 1;

    const isWin = rec.delta > 0;
    const isLoss = rec.delta < 0;
    if (isWin) {
      wins++;
      if (runKind === 'win') runLength++;
      else { runKind = 'win'; runLength = 1; }
      if (runLength > longestWinStreak) longestWinStreak = runLength;
    } else if (isLoss) {
      losses++;
      if (runKind === 'loss') runLength++;
      else { runKind = 'loss'; runLength = 1; }
      if (runLength > longestLossStreak) longestLossStreak = runLength;
    } else {
      // Break even — resets streak.
      runKind = 'none';
      runLength = 0;
    }
  }

  const totalNonTie = wins + losses;
  const winRate = totalNonTie > 0 ? wins / totalNonTie : 0;
  const favouriteDifficulty = Object.entries(diffCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';

  return {
    bank: bank.chips,
    lifetime: bank.netLifetime,
    matches: bank.matchesPlayed,
    wins,
    losses,
    winRate,
    handsPlayed,
    biggestWin,
    biggestLoss,
    longestWinStreak,
    longestLossStreak,
    currentStreak: { kind: runKind, length: runLength },
    favouriteDifficulty,
  };
}

/** Build an SVG sparkline of per-match deltas (most recent on the right). */
export function sparklineSvg(width = 280, height = 60): string {
  const history = loadHistory().slice(0, 20).reverse(); // oldest → newest
  if (history.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}"><text x="${width / 2}" y="${height / 2 + 4}" text-anchor="middle" fill="rgba(200,168,130,0.4)" font-family="monospace" font-size="11">no history yet</text></svg>`;
  }

  const maxAbs = Math.max(1, ...history.map(h => Math.abs(h.delta)));
  const barGap = 4;
  const barWidth = (width - barGap * (history.length - 1)) / history.length;
  const midY = height / 2;

  const bars = history.map((rec, i) => {
    const x = i * (barWidth + barGap);
    const barH = (Math.abs(rec.delta) / maxAbs) * (height / 2 - 2);
    const y = rec.delta >= 0 ? midY - barH : midY;
    const color = rec.delta >= 0 ? '#5a9e6f' : '#d63d3d';
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(1, barH)}" rx="1.5" fill="${color}" opacity="0.85">
      <title>${rec.delta >= 0 ? '+' : ''}$${rec.delta} · ${rec.hands} hands</title>
    </rect>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="sparkline-svg">
    <line x1="0" y1="${midY}" x2="${width}" y2="${midY}" stroke="rgba(200,168,130,0.2)" stroke-dasharray="2 3"/>
    ${bars}
  </svg>`;
}
