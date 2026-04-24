#!/usr/bin/env node
// Standalone drift simulator — mirrors synth3d-racing.js drift state machine.
//
// Usage:
//   node sim/drift-sim.mjs                     # run all scenarios
//   node sim/drift-sim.mjs basic               # run one named scenario
//   node sim/drift-sim.mjs --list              # list scenarios
//   node sim/drift-sim.mjs basic --frames      # dump per-frame telemetry
//   node sim/drift-sim.mjs basic --no-map      # skip ASCII map
//
// Output:
//   - ASCII top-down map with car trail, nose direction, phase markers
//   - Timeline table (phase | t | speed | slip | chassis yaw | dir yaw | notes)
//   - Entry/exit events
//
// Adapt the TUNING block below, then re-run. When it feels right, copy the
// constants/formulas back into static/js/synth3d-racing.js.

// ─────────────────────────────────────────────────────────
// TUNING (edit these, re-run)
// ─────────────────────────────────────────────────────────
const TUNE = {
  MAX_SLIP_DEG: 30,            // hard cap on chassis offset
  ENGAGE_SLIP_DEG: 5,          // arm the drift
  STEER_RATE: 2.0,             // rad/s at full stick
  STEER_TAPER_POW: 1.0,        // 1.0 = linear taper, 2.0 = quadratic (easy at low)
  CENTER_K_SOLO: 3.0,          // proportional centering when no steer (rad/s per rad)
  CENTER_K_WITH_STEER: 1.5,    // proportional centering when steer held
  TRAJECTORY_CURVE: 0.6,       // rad/s trajectory-direction turn per steer
  DRAG_COEF_GAS: 0.2,          // quadratic drag per (slipFrac)^2 with throttle
  DRAG_COEF_IDLE: 0.8,         // quadratic drag without throttle
  THRUST_LOW: 9,               // m/s^2 below cap
  THRUST_HIGH: 2,              // m/s^2 above cap
  BOOST_SPEED_CAP: 280,        // km/h, thrust reduces above this
  ENTRY_SPEED_MIN: 12,         // km/h to enter drift
  EXIT_SPEED_MIN: 5,           // km/h forced exit
  COOLDOWN: 0.3,               // seconds between drifts
  MINI_TURBO_TIERS: [
    { counter: 1.5, boost: 5,  label: 'MINI' },
    { counter: 2.5, boost: 9,  label: 'SUPER' },
    { counter: 3.5, boost: 14, label: 'ULTRA' },
  ],
  COUNTER_RATE_STEEP: 5,       // per sec when slip > 20°
  COUNTER_RATE_SOFT: 2,        // per sec when slip > ENGAGE but < 20°
};

// Derived
const MAX_SLIP = TUNE.MAX_SLIP_DEG * Math.PI / 180;
const ENGAGE_SLIP = TUNE.ENGAGE_SLIP_DEG * Math.PI / 180;

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
function createState() {
  return {
    // world
    posX: 0, posZ: 0,
    velX: 0, velZ: -30,          // moving -Z at ~108 km/h
    yaw: 0,                      // chassis world yaw (CW-positive; 0 = facing -Z)
    // drift
    driftActive: false,
    driftArmed: false,
    driftCooldown: 0,
    driftSpeed: 0,
    driftDirAngle: 0,
    driftChassisAngle: 0,
    driftCounter: 0,
    lastMiniTurbo: 0,
    lastEvent: null,
  };
}

// ─────────────────────────────────────────────────────────
// ONE SIMULATION STEP — kept as close to game code as possible
// ─────────────────────────────────────────────────────────
function step(s, dt, input) {
  const vx = s.velX, vz = s.velZ;
  const speedMs = Math.sqrt(vx * vx + vz * vz);
  const speed = speedMs * 3.6;
  const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);

  const wasDrifting = s.driftActive;
  if (s.driftCooldown > 0) s.driftCooldown = Math.max(0, s.driftCooldown - dt);

  s.lastEvent = null;

  // FRESH ENTRY
  if (!s.driftActive && input.ebrake && s.driftCooldown <= 0 && speed > TUNE.ENTRY_SPEED_MIN) {
    s.driftActive = true;
    s.driftArmed = false;
    s.driftCounter = 0;
    s.lastMiniTurbo = 0;
    s.driftSpeed = speedMs;
    s.driftDirAngle = Math.atan2(vx, -vz);
    s.driftChassisAngle = 0;
    s.lastEvent = 'ENTER';
  }

  if (s.driftActive) {
    // (a) angle integrator
    let angleRate = 0;
    if (Math.abs(steerInput) > 0.1) {
      const pushing = Math.sign(-steerInput) === Math.sign(s.driftChassisAngle);
      const frac = Math.abs(s.driftChassisAngle) / MAX_SLIP;
      const taper = pushing ? Math.max(0, Math.pow(1 - frac, TUNE.STEER_TAPER_POW)) : 1;
      angleRate += -steerInput * TUNE.STEER_RATE * taper;
    }
    if (input.throttle) {
      const k = Math.abs(steerInput) > 0.1 ? TUNE.CENTER_K_WITH_STEER : TUNE.CENTER_K_SOLO;
      angleRate -= s.driftChassisAngle * k;
    }
    s.driftChassisAngle += angleRate * dt;
    if (s.driftChassisAngle > MAX_SLIP) s.driftChassisAngle = MAX_SLIP;
    if (s.driftChassisAngle < -MAX_SLIP) s.driftChassisAngle = -MAX_SLIP;

    // (b) trajectory curve
    s.driftDirAngle += -steerInput * TUNE.TRAJECTORY_CURVE * dt;

    // (c) speed integrator — quadratic drag
    const slipMag = Math.abs(s.driftChassisAngle);
    const slipFrac = slipMag / MAX_SLIP;
    const dragCoef = input.throttle ? TUNE.DRAG_COEF_GAS : TUNE.DRAG_COEF_IDLE;
    const dragMag = slipFrac * slipFrac * dragCoef;
    s.driftSpeed *= Math.max(0, 1 - dragMag * dt);
    if (input.throttle) {
      const thrust = s.driftSpeed * 3.6 < TUNE.BOOST_SPEED_CAP ? TUNE.THRUST_LOW : TUNE.THRUST_HIGH;
      s.driftSpeed += thrust * dt;
    }

    // (c2) mini-turbo counter
    if (slipMag > ENGAGE_SLIP) {
      const rate = slipMag > 20 * Math.PI / 180 ? TUNE.COUNTER_RATE_STEEP : TUNE.COUNTER_RATE_SOFT;
      s.driftCounter += rate * dt;
    }

    // arm
    if (slipMag > ENGAGE_SLIP) s.driftArmed = true;

    // apply kinematic state
    const dirX = Math.sin(s.driftDirAngle);
    const dirZ = -Math.cos(s.driftDirAngle);
    s.velX = dirX * s.driftSpeed;
    s.velZ = dirZ * s.driftSpeed;
    s.posX += s.velX * dt;
    s.posZ += s.velZ * dt;
    s.yaw = s.driftDirAngle + s.driftChassisAngle;
  } else {
    // normal driving: simple — velocity integrated with gentle thrust/drag, heading aligns
    if (input.throttle) {
      const thrust = speed < TUNE.BOOST_SPEED_CAP ? 7 : 1.5;   // m/s^2 along heading
      const hx = Math.sin(s.yaw);
      const hz = -Math.cos(s.yaw);
      s.velX += hx * thrust * dt;
      s.velZ += hz * thrust * dt;
    }
    // Natural wheel friction aligns velocity to heading over time (strong pull)
    if (speedMs > 1) {
      const targetHx = Math.sin(s.yaw);
      const targetHz = -Math.cos(s.yaw);
      const ALIGN = 5.0;  // per second
      s.velX += (targetHx * speedMs - s.velX) * Math.min(1, ALIGN * dt);
      s.velZ += (targetHz * speedMs - s.velZ) * Math.min(1, ALIGN * dt);
    }
    // Mild air drag
    if (speed > 50) {
      const f = Math.max(0, 1 - 0.0004 * (speed - 50) * dt);
      s.velX *= f; s.velZ *= f;
    }
    // Steering rotates yaw (simple kinematic)
    if (Math.abs(steerInput) > 0.1) {
      const rate = steerInput * 1.2 * Math.max(0.3, 1 - speed / 260); // rad/s
      s.yaw -= rate * dt;
    }
    s.posX += s.velX * dt;
    s.posZ += s.velZ * dt;
  }

  // EXIT
  if (s.driftActive) {
    if (!input.ebrake) s.driftActive = false;
    if (speed < TUNE.EXIT_SPEED_MIN) s.driftActive = false;
  }

  if (wasDrifting && !s.driftActive) {
    let boost = 0;
    let tierLabel = '';
    for (const t of TUNE.MINI_TURBO_TIERS) {
      if (s.driftArmed && s.driftCounter >= t.counter) {
        boost = t.boost; tierLabel = t.label;
      }
    }
    if (boost > 0) {
      const vL = Math.sqrt(s.velX * s.velX + s.velZ * s.velZ);
      if (vL > 0.1) {
        s.velX += (s.velX / vL) * boost;
        s.velZ += (s.velZ / vL) * boost;
      }
      s.lastMiniTurbo = boost;
    }
    // snap chassis yaw to velocity direction (mirrors game's exit snap)
    s.yaw = Math.atan2(s.velX, -s.velZ);
    s.driftCooldown = TUNE.COOLDOWN;
    s.lastEvent = `EXIT ${tierLabel ? '+' + tierLabel : ''}`;
  }

  return {
    speed,
    slip: s.driftChassisAngle,
    slipDeg: s.driftChassisAngle * 180 / Math.PI,
    yaw: s.yaw,
    yawDeg: s.yaw * 180 / Math.PI,
    velDir: Math.atan2(s.velX, -s.velZ),
    velDirDeg: Math.atan2(s.velX, -s.velZ) * 180 / Math.PI,
    driftActive: s.driftActive,
    driftArmed: s.driftArmed,
    counter: s.driftCounter,
    boost: s.lastMiniTurbo,
    pos: [s.posX, s.posZ],
    event: s.lastEvent,
  };
}

// ─────────────────────────────────────────────────────────
// SCENARIOS — edit these to explore different inputs
// ─────────────────────────────────────────────────────────
const scenarios = {
  basic: {
    title: 'Basic: enter right drift, release steer+throttle centers, release SPACE exits',
    phases: [
      { dur: 0.3, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 0.7, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'SPC+→' },
      { dur: 1.5, input: { throttle: 1, ebrake: 1 },                      label: 'SPC+gas' },
      { dur: 0.5, input: { throttle: 1 },                                 label: 'release' },
    ],
  },
  'hold-right': {
    title: 'Hold SPACE+right indefinitely — find equilibrium slip angle',
    phases: [
      { dur: 0.3, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 2.5, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'SPC+→' },
      { dur: 0.3, input: { throttle: 1 },                                 label: 'release' },
    ],
  },
  'no-gas': {
    title: 'Drift without throttle — how fast does speed bleed?',
    phases: [
      { dur: 0.3, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 0.4, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'SPC+→' },
      { dur: 2.0, input: { ebrake: 1, right: 1 },                         label: 'SPC+→ no gas' },
      { dur: 0.3, input: {},                                              label: 'release' },
    ],
  },
  counter: {
    title: 'Counter-steer exit — enter right, counter-steer left',
    phases: [
      { dur: 0.3, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 0.6, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'SPC+→' },
      { dur: 0.4, input: { throttle: 1, ebrake: 1, left: 1 },             label: 'SPC+←' },
      { dur: 0.5, input: { throttle: 1 },                                 label: 'release' },
    ],
  },
  'tap-fail': {
    title: 'Quick tap SPACE without steer — should exit false-start, no boost',
    phases: [
      { dur: 0.3, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 0.2, input: { throttle: 1, ebrake: 1 },                      label: 'SPC tap' },
      { dur: 0.3, input: { throttle: 1 },                                 label: 'release' },
    ],
  },
  'max-boost': {
    title: 'Max boost grind — hold steep angle long enough for ULTRA',
    phases: [
      { dur: 0.3, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 1.2, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'SPC+→ long' },
      { dur: 0.4, input: { throttle: 1 },                                 label: 'release+boost' },
    ],
  },
  's-curve': {
    title: 'S-curve: drift right, flick left, drift left',
    phases: [
      { dur: 0.3, input: { throttle: 1 },                                 label: 'cruise' },
      { dur: 0.6, input: { throttle: 1, ebrake: 1, right: 1 },            label: 'SPC+→' },
      { dur: 0.4, input: { throttle: 1 },                                 label: 'release' },
      { dur: 0.6, input: { throttle: 1, ebrake: 1, left: 1 },             label: 'SPC+←' },
      { dur: 0.4, input: { throttle: 1 },                                 label: 'release' },
    ],
  },
};

// ─────────────────────────────────────────────────────────
// RUN + TRACE
// ─────────────────────────────────────────────────────────
function runScenario(name, scenario, opts = {}) {
  const s = createState();
  const dt = 1 / 60;
  let t = 0;
  const trail = [];
  const events = [];
  let currentPhase = '';
  for (const phase of scenario.phases) {
    currentPhase = phase.label;
    const frames = Math.round(phase.dur / dt);
    for (let i = 0; i < frames; i++) {
      const out = step(s, dt, phase.input);
      trail.push({ t: +t.toFixed(3), phase: currentPhase, ...out });
      if (out.event) events.push({ t: +t.toFixed(3), phase: currentPhase, event: out.event, slipDeg: +out.slipDeg.toFixed(1), speed: +out.speed.toFixed(1), counter: +s.driftCounter.toFixed(2) });
      t += dt;
    }
  }
  return { name, scenario, trail, events };
}

// ─────────────────────────────────────────────────────────
// ASCII TOP-DOWN MAP
// ─────────────────────────────────────────────────────────
function renderMap(trail, width = 80, height = 28) {
  const xs = trail.map(f => f.pos[0]);
  const zs = trail.map(f => f.pos[1]);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const padX = Math.max(2, (maxX - minX) * 0.1);
  const padZ = Math.max(2, (maxZ - minZ) * 0.1);
  minX -= padX; maxX += padX; minZ -= padZ; maxZ += padZ;
  if (maxX - minX < 10) { const mid = (minX + maxX) / 2; minX = mid - 5; maxX = mid + 5; }
  if (maxZ - minZ < 10) { const mid = (minZ + maxZ) / 2; minZ = mid - 5; maxZ = mid + 5; }

  const toCol = x => Math.floor(((x - minX) / (maxX - minX)) * (width - 1));
  // Z axis: -Z is "forward" in the game — render with -Z at top of screen.
  const toRow = z => Math.floor(((z - minZ) / (maxZ - minZ)) * (height - 1));

  const grid = Array.from({ length: height }, () => Array(width).fill(' '));

  // Axes / origin
  const c0 = toCol(0), r0 = toRow(0);
  if (c0 >= 0 && c0 < width && r0 >= 0 && r0 < height) grid[r0][c0] = '+';

  // Trail: dense dots. Mark drift frames differently.
  for (let i = 0; i < trail.length; i++) {
    const f = trail[i];
    const col = toCol(f.pos[0]);
    const row = toRow(f.pos[1]);
    if (col < 0 || col >= width || row < 0 || row >= height) continue;
    const prev = grid[row][col];
    if (prev === '█' || prev === '*') continue;
    grid[row][col] = f.driftActive ? (f.driftArmed ? '#' : '-') : '.';
  }

  // Event markers
  const eventFrames = trail.filter(f => f.event);
  for (const f of eventFrames) {
    const col = toCol(f.pos[0]);
    const row = toRow(f.pos[1]);
    if (col < 0 || col >= width || row < 0 || row >= height) continue;
    if (f.event === 'ENTER') grid[row][col] = 'E';
    else if (f.event && f.event.startsWith('EXIT')) grid[row][col] = 'X';
  }

  // Every 20 frames, draw a chassis arrow so you can see nose direction over time.
  const SAMPLE = 15;
  for (let i = 0; i < trail.length; i += SAMPLE) {
    const f = trail[i];
    drawArrow(grid, toCol(f.pos[0]), toRow(f.pos[1]), f.yaw, width, height);
  }

  // Final car state
  const last = trail[trail.length - 1];
  drawArrow(grid, toCol(last.pos[0]), toRow(last.pos[1]), last.yaw, width, height, '@');

  // Header / footer
  const xRangeStr = `X: [${minX.toFixed(1)} .. ${maxX.toFixed(1)}] m   (width ${(maxX-minX).toFixed(1)})`;
  const zRangeStr = `Z: [${minZ.toFixed(1)} .. ${maxZ.toFixed(1)}] m   (-Z = forward)`;
  const lines = [
    '┌' + '─'.repeat(width) + '┐',
    ...grid.map(r => '│' + r.join('') + '│'),
    '└' + '─'.repeat(width) + '┘',
    xRangeStr,
    zRangeStr,
    'Legend: . trail  - drift(unarmed)  # drift(armed)  ▲▶▼◀ chassis nose  @ final  E enter  X exit  + origin',
  ];
  return lines.join('\n');
}

function drawArrow(grid, col, row, yaw, width, height, char) {
  if (col < 0 || col >= width || row < 0 || row >= height) return;
  // yaw in CW-positive convention (0 = -Z = up on screen).
  // Pick nearest 8-way arrow.
  const n = normalizeAngle(yaw);
  const slots = ['▲', '↗', '▶', '↘', '▼', '↙', '◀', '↖'];
  const idx = ((Math.round(n / (Math.PI / 4)) % 8) + 8) % 8;
  grid[row][col] = char || slots[idx];
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ─────────────────────────────────────────────────────────
// TIMELINE TABLE
// ─────────────────────────────────────────────────────────
function renderTimeline(trail) {
  const rows = [];
  rows.push('   t   | phase        |  spd  | slip° | chassis° | velDir° | state       | counter | event');
  rows.push('───────┼──────────────┼───────┼───────┼──────────┼─────────┼─────────────┼─────────┼──────────');
  // sample every 0.1s + events
  const sampled = new Set();
  for (let i = 0; i < trail.length; i++) {
    const f = trail[i];
    if (f.event) sampled.add(i);
    if (Math.round(f.t * 10) !== Math.round((trail[i - 1]?.t ?? -1) * 10)) sampled.add(i);
  }
  sampled.add(trail.length - 1);
  const sortedIdx = Array.from(sampled).sort((a, b) => a - b);
  for (const i of sortedIdx) {
    const f = trail[i];
    const state = f.driftActive ? (f.driftArmed ? 'DRIFT[arm]' : 'DRIFT')
                                 : (f.boost > 0 ? `boost +${f.boost}` : 'normal');
    rows.push(
      ` ${f.t.toFixed(2).padStart(5)} | ${f.phase.padEnd(12)} | ${f.speed.toFixed(1).padStart(5)} | ${f.slipDeg.toFixed(1).padStart(5)} | ${f.yawDeg.toFixed(1).padStart(8)} | ${f.velDirDeg.toFixed(1).padStart(7)} | ${state.padEnd(11)} | ${f.counter.toFixed(2).padStart(7)} | ${f.event ?? ''}`
    );
  }
  return rows.join('\n');
}

// ─────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────
function listScenarios() {
  console.log('Available scenarios:\n');
  for (const [name, scn] of Object.entries(scenarios)) {
    console.log(`  ${name.padEnd(14)} ${scn.title}`);
  }
  console.log('');
}

function printScenario(result, opts) {
  const { name, scenario, trail, events } = result;
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log(`║ [${name}] ${scenario.title.padEnd(73 - name.length)}║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  if (!opts.noMap) {
    console.log(renderMap(trail));
    console.log('');
  }

  console.log('EVENTS:');
  if (events.length === 0) console.log('  (none)');
  for (const e of events) {
    console.log(`  t=${e.t.toFixed(2).padStart(5)}  ${e.event.padEnd(20)} slip=${e.slipDeg.toFixed(1).padStart(5)}°  speed=${e.speed.toFixed(1).padStart(5)} km/h  counter=${e.counter.toFixed(2)}`);
  }
  console.log('');

  console.log('TIMELINE:');
  console.log(renderTimeline(trail));
  console.log('');
}

const args = process.argv.slice(2);
const opts = {
  noMap: args.includes('--no-map'),
  frames: args.includes('--frames'),
  list: args.includes('--list'),
};

if (opts.list) { listScenarios(); process.exit(0); }

const requested = args.find(a => !a.startsWith('--'));
const runList = requested ? [requested] : Object.keys(scenarios);

for (const key of runList) {
  if (!scenarios[key]) {
    console.error(`Unknown scenario: ${key}. Available: ${Object.keys(scenarios).join(', ')}`);
    process.exit(1);
  }
  const result = runScenario(key, scenarios[key], opts);
  printScenario(result, opts);
}
