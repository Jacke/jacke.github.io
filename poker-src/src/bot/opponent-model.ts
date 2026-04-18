/**
 * Opponent model — tracks per-seat behavioural statistics across the current
 * match. Used by the grandmaster bot to exploit loose/tight/passive/aggressive
 * opponents.
 *
 * Metrics tracked (standard online poker terminology):
 *  - VPIP  (Voluntarily Put $ In Pot)  — % of hands where the player calls
 *           or raises preflop (blinds don't count).
 *  - PFR   (Pre-Flop Raise)            — % of hands where they raised preflop.
 *  - AF    (Aggression Factor)         — (bets + raises) / calls across all streets.
 *  - 3-bet — count of preflop re-raises over an existing open.
 *  - CBet  — count of flop bets when the player was the last preflop raiser.
 *
 * Stats are reset on `newMatch()` so they don't leak across matches. Within
 * a match, 20-30 hands is usually enough for meaningful read.
 *
 * The model is fed by app.ts after every action event via `record()`.
 */

export interface PlayerStats {
  handsSeen: number;
  // Preflop commitment
  vpip: number;
  pfr: number;
  // Full-hand aggression
  bets: number;
  raises: number;
  calls: number;
  checks: number;
  folds: number;
  // 3-bet opportunities & conversions
  threeBets: number;
  threeBetOpportunities: number;
  // CBet opportunities & conversions (flop bet when you were PFR)
  cbets: number;
  cbetOpportunities: number;
}

function emptyStats(): PlayerStats {
  return {
    handsSeen: 0,
    vpip: 0,
    pfr: 0,
    bets: 0,
    raises: 0,
    calls: 0,
    checks: 0,
    folds: 0,
    threeBets: 0,
    threeBetOpportunities: 0,
    cbets: 0,
    cbetOpportunities: 0,
  };
}

class OpponentModel {
  private stats = new Map<number, PlayerStats>();
  private inHand = new Set<number>();
  /** Every seat dealt into the current hand — folders stay here even after `inHand` removes them. */
  private seatedThisHand = new Set<number>();
  /** Whether a voluntary raise has already occurred this preflop (for 3-bet detection). */
  private preflopRaises = 0;
  /** Who made the last preflop raise (for CBet detection). */
  private lastPreflopRaiser: number | null = null;
  /** Did the PFR actually fire a flop cbet? (reset each hand) */
  private cbetConsumed = false;

  /** Full reset — call at the start of a new match. */
  reset(): void {
    this.stats.clear();
    this.inHand.clear();
    this.seatedThisHand.clear();
    this.preflopRaises = 0;
    this.lastPreflopRaiser = null;
    this.cbetConsumed = false;
  }

  /** Called when a new hand is dealt — marks all seats as in-hand. */
  newHand(playerIndices: number[]): void {
    this.inHand.clear();
    this.seatedThisHand.clear();
    this.preflopRaises = 0;
    this.lastPreflopRaiser = null;
    this.cbetConsumed = false;
    for (const p of playerIndices) {
      this.inHand.add(p);
      this.seatedThisHand.add(p);
      if (!this.stats.has(p)) this.stats.set(p, emptyStats());
    }
  }

  /** Called after each engine action event. */
  record(
    player: number,
    kind: 'fold' | 'check' | 'call' | 'raise' | 'discard',
    phase: 'preflop' | 'flop' | 'turn' | 'river' | string,
    isFirstFlopAction: boolean = false,
  ): void {
    const s = this.stats.get(player) ?? emptyStats();
    this.stats.set(player, s);

    switch (kind) {
      case 'fold':
        s.folds++;
        this.inHand.delete(player);
        break;
      case 'check':
        s.checks++;
        // CBet opportunity consumed without firing: if player was PFR and
        // this is the first flop action, their CBet chance is passing.
        if (phase === 'flop' && isFirstFlopAction && player === this.lastPreflopRaiser) {
          s.cbetOpportunities++;
          this.cbetConsumed = true;
        }
        break;
      case 'call':
        s.calls++;
        if (phase === 'preflop') s.vpip++;
        break;
      case 'raise':
        s.raises++;
        if (phase === 'preflop') {
          s.vpip++;
          s.pfr++;
          if (this.preflopRaises >= 1) {
            s.threeBets++;
            s.threeBetOpportunities++;
          }
          this.preflopRaises++;
          this.lastPreflopRaiser = player;
        }
        if (phase === 'flop' && player === this.lastPreflopRaiser && !this.cbetConsumed) {
          s.cbets++;
          s.cbetOpportunities++;
          this.cbetConsumed = true;
        }
        break;
      case 'discard':
        // Discard is not a betting action, don't count.
        break;
    }
  }

  /** Called at end of each hand to credit "handsSeen" to everyone who was dealt in. */
  endHand(): void {
    for (const p of this.seatedThisHand) {
      const s = this.stats.get(p);
      if (s) s.handsSeen++;
    }
    this.inHand.clear();
    this.seatedThisHand.clear();
  }

  // ═════════════ Derived stats ═════════════

  vpip(player: number): number | null {
    const s = this.stats.get(player);
    if (!s || s.handsSeen === 0) return null;
    return s.vpip / s.handsSeen;
  }
  pfr(player: number): number | null {
    const s = this.stats.get(player);
    if (!s || s.handsSeen === 0) return null;
    return s.pfr / s.handsSeen;
  }
  /** Aggression factor. Null if no calls yet. */
  af(player: number): number | null {
    const s = this.stats.get(player);
    if (!s || s.calls === 0) return null;
    return (s.bets + s.raises) / s.calls;
  }
  threeBetPct(player: number): number | null {
    const s = this.stats.get(player);
    if (!s || s.threeBetOpportunities === 0) return null;
    return s.threeBets / s.threeBetOpportunities;
  }
  cbetPct(player: number): number | null {
    const s = this.stats.get(player);
    if (!s || s.cbetOpportunities === 0) return null;
    return s.cbets / s.cbetOpportunities;
  }
  handsSeen(player: number): number {
    return this.stats.get(player)?.handsSeen ?? 0;
  }

  /** Raw stats for a player — for tests and HUD display. */
  getStats(player: number): Readonly<PlayerStats> | null {
    return this.stats.get(player) ?? null;
  }

  /**
   * Categorise a player based on VPIP + AF. Common archetypes:
   *  - "rock"      — tight-passive (vpip<18, af<1)
   *  - "nit"       — tight-passive even more (vpip<15)
   *  - "tag"       — tight-aggressive (vpip 18-24, af>1.5)
   *  - "lag"       — loose-aggressive (vpip>28, af>2)
   *  - "fish"      — loose-passive (vpip>35, af<1)
   *  - "maniac"    — very high aggression (af>3)
   *  - "unknown"   — not enough samples yet
   */
  archetype(player: number): 'rock' | 'tag' | 'lag' | 'fish' | 'maniac' | 'unknown' {
    const hs = this.handsSeen(player);
    if (hs < 6) return 'unknown';
    const v = this.vpip(player) ?? 0.25;
    const a = this.af(player) ?? 1.5;
    if (a > 3.5) return 'maniac';
    if (v > 0.35 && a < 1) return 'fish';
    if (v > 0.28 && a >= 2) return 'lag';
    if (v < 0.20 && a < 1) return 'rock';
    if (v >= 0.18 && v <= 0.26 && a >= 1.5) return 'tag';
    return 'unknown';
  }
}

/** Module-level singleton — one model per app lifetime, reset on new match. */
export const opponentModel = new OpponentModel();
