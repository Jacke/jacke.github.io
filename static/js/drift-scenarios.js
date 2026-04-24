// Shared drift test scenarios — used by both the in-game autopilot and the node sim.
// Each scenario is a list of phases; each phase has `dur` (seconds) and `input` (keyboard state).
// Keys: throttle, brake, ebrake, left, right.

export const scenarios = {
  basic: {
    title: 'Enter right drift → release steer+gas centers → release SPACE exits (+BOOST)',
    phases: [
      { dur: 0.6, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 0.7, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'SPC+→ build angle' },
      { dur: 1.5, input: { throttle: 1, ebrake: 1 },                      label: 'SPC+gas center' },
      { dur: 0.8, input: { throttle: 1 },                                 label: 'release (expect boost)' },
    ],
  },
  'hold-right': {
    title: 'Hold SPACE+right indefinitely — find equilibrium slip angle',
    phases: [
      { dur: 0.5, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 3.0, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'SPC+→ held' },
      { dur: 0.5, input: { throttle: 1 },                                 label: 'release' },
    ],
  },
  'hold-left': {
    title: 'Hold SPACE+LEFT indefinitely — mirror check',
    phases: [
      { dur: 0.5, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 3.0, input: { throttle: 1, ebrake: 1, left: 1 },             label: 'SPC+← held' },
      { dur: 0.5, input: { throttle: 1 },                                 label: 'release' },
    ],
  },
  'no-gas': {
    title: 'Drift without throttle — speed should bleed quickly',
    phases: [
      { dur: 0.5, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 0.4, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'seed drift' },
      { dur: 2.5, input: { ebrake: 1, right: 1 },                         label: 'SPC+→ NO gas' },
      { dur: 0.5, input: {},                                              label: 'release' },
    ],
  },
  counter: {
    title: 'Counter-steer — enter right, counter-steer left to exit',
    phases: [
      { dur: 0.5, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 0.6, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'SPC+→' },
      { dur: 0.5, input: { throttle: 1, ebrake: 1, left: 1 },             label: 'SPC+← counter' },
      { dur: 0.5, input: { throttle: 1 },                                 label: 'release' },
    ],
  },
  'tap-fail': {
    title: 'Quick SPACE tap without steer → false-start exit, no boost',
    phases: [
      { dur: 0.5, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 0.25, input: { throttle: 1, ebrake: 1 },                     label: 'SPC tap' },
      { dur: 0.5, input: { throttle: 1 },                                 label: 'release' },
    ],
  },
  'max-boost': {
    title: 'Grind ULTRA boost — hold steep angle long',
    phases: [
      { dur: 0.5, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 1.5, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'SPC+→ long' },
      { dur: 0.8, input: { throttle: 1 },                                 label: 'release (ULTRA)' },
    ],
  },
  's-curve': {
    title: 'S-curve: drift right, release, drift left (chained)',
    phases: [
      { dur: 0.5, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 0.6, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'drift →' },
      { dur: 0.4, input: { throttle: 1 },                                 label: 'release 1' },
      { dur: 0.6, input: { throttle: 1, ebrake: 1, left: 1 },             label: 'drift ←' },
      { dur: 0.4, input: { throttle: 1 },                                 label: 'release 2' },
    ],
  },
  'release-steer-hold-space': {
    title: 'Build angle → release steer keep SPACE (no gas) → angle should stick',
    phases: [
      { dur: 0.5, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 0.7, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'build angle' },
      { dur: 2.0, input: { ebrake: 1 },                                   label: 'SPC only, no gas' },
      { dur: 0.5, input: {},                                              label: 'release' },
    ],
  },
};

// Pre-compute cumulative time per phase for easy lookup
for (const scn of Object.values(scenarios)) {
  let t = 0;
  for (const p of scn.phases) {
    p.tStart = t;
    t += p.dur;
    p.tEnd = t;
  }
  scn.totalDur = t;
}

// Given elapsed time, return active phase + input. Returns null if finished.
export function scenarioInputAt(scn, elapsed) {
  if (elapsed >= scn.totalDur) return null;
  for (const p of scn.phases) {
    if (elapsed >= p.tStart && elapsed < p.tEnd) {
      return { input: p.input, phase: p.label, tInPhase: elapsed - p.tStart, tTotal: elapsed };
    }
  }
  return null;
}
