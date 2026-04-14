/**
 * Procedural animated backgrounds rendered to a single fixed canvas behind
 * everything. Switchable via `body[data-bganim]` setting.
 *
 * All animations respect `prefers-reduced-motion` and the settings toggle —
 * when motion is reduced we just paint one static frame and stop.
 */

type AnimMode = 'static' | 'particles' | 'aurora' | 'starfield';

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let rafId: number | null = null;
let currentMode: AnimMode = 'static';
let startTime = 0;

interface Particle { x: number; y: number; vx: number; vy: number; size: number; alpha: number; }
let particles: Particle[] = [];
interface Star { x: number; y: number; size: number; phase: number; speed: number; }
let stars: Star[] = [];

function ensureCanvas(): void {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.id = 'bg-canvas';
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    zIndex: '-1',
    pointerEvents: 'none',
  } as CSSStyleDeclaration);
  document.body.prepend(canvas);
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize, { passive: true });
}

function resize(): void {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  if (ctx) ctx.scale(dpr, dpr);
  initScene(currentMode);
}

function initScene(mode: AnimMode): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  particles = [];
  stars = [];
  if (mode === 'particles') {
    const count = Math.max(30, Math.floor((w * h) / 18000));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        size: 0.6 + Math.random() * 1.8,
        alpha: 0.2 + Math.random() * 0.4,
      });
    }
  } else if (mode === 'starfield') {
    const count = Math.max(60, Math.floor((w * h) / 6000));
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: 0.5 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 1.4,
      });
    }
  }
}

function drawStaticBackdrop(w: number, h: number): void {
  if (!ctx) return;
  const mode = document.body.dataset['mode'] ?? 'dark';
  if (mode === 'light') {
    const g = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.5, Math.max(w, h));
    g.addColorStop(0, '#f4efe2');
    g.addColorStop(1, '#d8cfb9');
    ctx.fillStyle = g;
  } else {
    const g = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.5, Math.max(w, h));
    g.addColorStop(0, '#0f0a07');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, w, h);
}

function drawParticles(w: number, h: number, t: number): void {
  if (!ctx) return;
  const mode = document.body.dataset['mode'] ?? 'dark';
  const tint = mode === 'light' ? '90, 80, 55' : '200, 168, 130';
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0) p.x += w;
    if (p.x > w) p.x -= w;
    if (p.y < 0) p.y += h;
    if (p.y > h) p.y -= h;
    ctx.fillStyle = `rgba(${tint}, ${p.alpha * (0.7 + Math.sin(t * 0.001 + p.x * 0.01) * 0.3)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAurora(w: number, h: number, t: number): void {
  if (!ctx) return;
  const mode = document.body.dataset['mode'] ?? 'dark';
  const s = t * 0.0002;
  const a = (Math.sin(s) + 1) / 2;
  const b = (Math.sin(s + 2) + 1) / 2;
  if (mode === 'light') {
    const g1 = ctx.createRadialGradient(w * (0.3 + a * 0.4), h * (0.3 + b * 0.2), 0, w * 0.5, h * 0.5, w * 0.9);
    g1.addColorStop(0, 'rgba(255,220,170,0.35)');
    g1.addColorStop(1, 'rgba(245,236,218,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);
    const g2 = ctx.createRadialGradient(w * (0.7 - a * 0.2), h * (0.6 + b * 0.2), 0, w * 0.5, h * 0.5, w * 0.8);
    g2.addColorStop(0, 'rgba(180,200,160,0.25)');
    g2.addColorStop(1, 'rgba(245,236,218,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  } else {
    const g1 = ctx.createRadialGradient(w * (0.3 + a * 0.4), h * (0.3 + b * 0.2), 0, w * 0.5, h * 0.5, w * 0.9);
    g1.addColorStop(0, 'rgba(90, 60, 140, 0.28)');
    g1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);
    const g2 = ctx.createRadialGradient(w * (0.7 - a * 0.2), h * (0.6 + b * 0.2), 0, w * 0.5, h * 0.5, w * 0.8);
    g2.addColorStop(0, 'rgba(30, 120, 90, 0.22)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawStars(w: number, h: number, t: number): void {
  if (!ctx) return;
  const mode = document.body.dataset['mode'] ?? 'dark';
  for (const s of stars) {
    s.y -= s.speed * 0.08;
    if (s.y < 0) { s.y = h; s.x = Math.random() * w; }
    const twinkle = 0.4 + Math.sin(t * 0.003 + s.phase) * 0.3;
    ctx.fillStyle = mode === 'light'
      ? `rgba(90, 80, 55, ${twinkle * 0.5})`
      : `rgba(230, 220, 200, ${twinkle})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function frame(t: number): void {
  if (!canvas || !ctx) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  drawStaticBackdrop(w, h);
  if (currentMode === 'particles') drawParticles(w, h, t);
  else if (currentMode === 'aurora') drawAurora(w, h, t);
  else if (currentMode === 'starfield') drawStars(w, h, t);
  rafId = requestAnimationFrame(frame);
}

/** Switch background animation mode. */
export function setBgAnimation(mode: AnimMode): void {
  ensureCanvas();
  currentMode = mode;
  initScene(mode);

  // Stop any existing loop.
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  const reduced = document.body.dataset['reducedmotion'] === 'on'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (mode === 'static' || reduced) {
    // Paint one frame and stop.
    if (ctx) {
      drawStaticBackdrop(window.innerWidth, window.innerHeight);
      if (mode === 'particles') drawParticles(window.innerWidth, window.innerHeight, 0);
      else if (mode === 'aurora') drawAurora(window.innerWidth, window.innerHeight, 0);
      else if (mode === 'starfield') drawStars(window.innerWidth, window.innerHeight, 0);
    }
    return;
  }

  startTime = performance.now();
  rafId = requestAnimationFrame(frame);
}
