/**
 * Tiny Web Audio sound effects — no files shipped, everything synthesized
 * on the fly via oscillators and noise. Zero bundle cost beyond the module
 * itself. Respects the user's sound setting in localStorage.
 */

let audioCtx: AudioContext | null = null;
let enabled = true;

function ctx(): AudioContext | null {
  if (!enabled) return null;
  if (audioCtx) return audioCtx;
  try {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    audioCtx = new AC();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (!on && audioCtx && audioCtx.state !== 'closed') {
    // Don't destroy — just silence future calls; keeps context warm.
  }
}

/** Resume the audio context on first user gesture (browsers require this). */
export function unlockAudio(): void {
  const c = ctx();
  if (c && c.state === 'suspended') void c.resume();
}

function envTone(freq: number, duration: number, type: OscillatorType = 'sine', attackMs = 5, volume = 0.15): void {
  const c = ctx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + attackMs / 1000);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function noiseBurst(duration: number, bandpassHz: number, q: number, volume = 0.2): void {
  const c = ctx();
  if (!c) return;
  const now = c.currentTime;
  const bufferSize = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = bandpassHz;
  filter.Q.value = q;
  const gain = c.createGain();
  gain.gain.value = volume;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(c.destination);
  src.start(now);
}

/** Chip drop: short metallic clink. Two short bandpass noise bursts. */
export function sfxChipDrop(): void {
  noiseBurst(0.08, 4800, 6, 0.22);
  setTimeout(() => noiseBurst(0.05, 3200, 4, 0.14), 35);
}

/** Card deal: light swish. */
export function sfxCardDeal(): void {
  noiseBurst(0.12, 2200, 2, 0.15);
}

/** Card flip: short higher-pitched swish. */
export function sfxCardFlip(): void {
  noiseBurst(0.08, 3600, 3, 0.12);
}

/** Check: soft wood-knock. */
export function sfxCheck(): void {
  envTone(220, 0.1, 'triangle', 2, 0.18);
}

/** Call: ascending tone pair. */
export function sfxCall(): void {
  envTone(440, 0.08, 'sine', 4, 0.14);
  setTimeout(() => envTone(550, 0.1, 'sine', 4, 0.14), 60);
}

/** Raise: ascending triad — "going up". */
export function sfxRaise(): void {
  envTone(440, 0.08, 'triangle', 3, 0.15);
  setTimeout(() => envTone(554, 0.08, 'triangle', 3, 0.15), 50);
  setTimeout(() => envTone(659, 0.12, 'triangle', 3, 0.18), 100);
}

/** Fold: soft descending thud. */
export function sfxFold(): void {
  envTone(180, 0.18, 'sine', 4, 0.18);
  setTimeout(() => envTone(120, 0.2, 'sine', 4, 0.14), 50);
}

/** Win: triumphant short chord. */
export function sfxWin(): void {
  envTone(523, 0.22, 'triangle', 4, 0.16);
  setTimeout(() => envTone(659, 0.22, 'triangle', 4, 0.16), 80);
  setTimeout(() => envTone(784, 0.28, 'triangle', 4, 0.18), 160);
}

/** Lose: soft minor falloff. */
export function sfxLose(): void {
  envTone(440, 0.22, 'sine', 4, 0.14);
  setTimeout(() => envTone(370, 0.25, 'sine', 4, 0.12), 100);
}
