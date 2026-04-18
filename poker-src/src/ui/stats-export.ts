/**
 * Stats export — flatten lifetime match history into a CSV the user can
 * open in Excel / Numbers / Sheets to slice by difficulty, variant, date.
 *
 * Pairs with `loadHistory()` from bank.ts. One row per match.
 */

import type { MatchRecord } from './bank.js';

/** CSV-escape a single cell. Handles commas, newlines, embedded quotes. */
export function csvEscape(v: string | number | boolean): string {
  const s = String(v);
  if (/[,"\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Flatten a match history array into a CSV string with a header row. */
export function matchHistoryToCsv(history: ReadonlyArray<MatchRecord>): string {
  const header = [
    'timestamp',
    'date',
    'difficulty',
    'num_players',
    'hands',
    'start_chips',
    'end_chips',
    'delta',
    'won',
  ];
  const rows: string[] = [header.map(csvEscape).join(',')];
  for (const rec of history) {
    const date = new Date(rec.timestamp).toISOString();
    rows.push([
      rec.timestamp,
      date,
      rec.difficulty,
      rec.numPlayers,
      rec.hands,
      rec.startChips,
      rec.endChips,
      rec.delta,
      rec.won ? 1 : 0,
    ].map(csvEscape).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

/**
 * Aggregate lifetime-stats summary rows. Returns a CSV with a small number
 * of key-value pairs — one row per stat. Useful for "print a digest" flows.
 */
export function lifetimeSummaryToCsv(history: ReadonlyArray<MatchRecord>): string {
  const n = history.length;
  const wins = history.filter(r => r.won).length;
  const totalDelta = history.reduce((a, r) => a + r.delta, 0);
  const totalHands = history.reduce((a, r) => a + r.hands, 0);
  const avgDelta = n > 0 ? totalDelta / n : 0;
  const avgHands = n > 0 ? totalHands / n : 0;
  const winRate = n > 0 ? wins / n : 0;

  const byDifficulty = new Map<string, { n: number; delta: number; wins: number }>();
  for (const r of history) {
    const d = byDifficulty.get(r.difficulty) ?? { n: 0, delta: 0, wins: 0 };
    d.n++;
    d.delta += r.delta;
    if (r.won) d.wins++;
    byDifficulty.set(r.difficulty, d);
  }

  const rows: string[] = [];
  rows.push(['stat', 'value'].map(csvEscape).join(','));
  rows.push(['total_matches', n].map(csvEscape).join(','));
  rows.push(['win_rate', winRate.toFixed(4)].map(csvEscape).join(','));
  rows.push(['total_delta', totalDelta].map(csvEscape).join(','));
  rows.push(['avg_delta', avgDelta.toFixed(2)].map(csvEscape).join(','));
  rows.push(['total_hands', totalHands].map(csvEscape).join(','));
  rows.push(['avg_hands_per_match', avgHands.toFixed(1)].map(csvEscape).join(','));
  for (const [diff, d] of byDifficulty) {
    rows.push([`matches_${diff}`, d.n].map(csvEscape).join(','));
    rows.push([`delta_${diff}`, d.delta].map(csvEscape).join(','));
    rows.push([`winrate_${diff}`, (d.wins / d.n).toFixed(4)].map(csvEscape).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

/** Browser helper — trigger a CSV file download. */
export function downloadCsv(text: string, filenameHint: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = `${filenameHint}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
