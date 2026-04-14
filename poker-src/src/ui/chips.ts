/**
 * Poker chip rendering — SVG chips with traditional casino styling:
 * circular rim, eight edge marks, inner ring, denomination text, gloss.
 *
 * A stack is several chips offset vertically so you see the rim of each
 * underlying chip plus the full top face.
 */

interface ChipStyle {
  /** Rim/body color. */
  bg: string;
  /** Darker inner ring color for contrast. */
  bgDark: string;
  /** Accent color used for edge marks and denomination. */
  accent: string;
  /** Display denomination on the face. */
  denom: string;
}

/** Denomination tiers in descending order with associated colors. */
const CHIP_TIERS: Array<{ min: number; style: ChipStyle }> = [
  { min: 1000, style: { bg: '#d88a40', bgDark: '#a8641f', accent: '#fff4d6', denom: '1K' } }, // orange
  { min: 500,  style: { bg: '#6b3b8a', bgDark: '#4a2360', accent: '#f0d8ff', denom: '500' } }, // purple
  { min: 100,  style: { bg: '#1f1f1f', bgDark: '#0f0f0f', accent: '#d4af6a', denom: '100' } }, // black
  { min: 25,   style: { bg: '#3d8a5f', bgDark: '#225236', accent: '#d6f4dd', denom: '25'  } }, // green
  { min: 5,    style: { bg: '#d63d3d', bgDark: '#962626', accent: '#ffdbdb', denom: '5'   } }, // red
  { min: 0,    style: { bg: '#e8e4da', bgDark: '#c4bfae', accent: '#1a1a1a', denom: '1'   } }, // white
];

export function topChipStyle(amount: number): ChipStyle {
  for (const tier of CHIP_TIERS) {
    if (amount >= tier.min) return tier.style;
  }
  return CHIP_TIERS[CHIP_TIERS.length - 1]!.style;
}

/** Build the full palette used by a stack — top chip is dominant, lower tiers below. */
function stackStyles(amount: number, count: number): ChipStyle[] {
  if (amount <= 0 || count <= 0) return [];
  // Find the starting tier for the amount — that tier goes on top.
  let topTier = CHIP_TIERS.findIndex(t => amount >= t.min);
  if (topTier < 0) topTier = CHIP_TIERS.length - 1;
  const styles: ChipStyle[] = [];
  // Bottom chip first (lowest in the stack DOM), top chip last.
  for (let i = count - 1; i >= 0; i--) {
    const idx = Math.min(CHIP_TIERS.length - 1, topTier + i);
    styles.push(CHIP_TIERS[idx]!.style);
  }
  return styles;
}

let gradientCounter = 0;

/** Currently-selected chip style — mutated by settings, read at render time. */
let currentChipStyle: 'classic' | 'minimal' | 'retro' | 'neon' = 'classic';
export function setChipStyle(style: 'classic' | 'minimal' | 'retro' | 'neon'): void {
  currentChipStyle = style;
}

/**
 * Single SVG chip (top-down view). Rendering varies by the current chipStyle.
 */
export function chipSvg(style: ChipStyle, opts: { size?: number; showDenom?: boolean } = {}): string {
  switch (currentChipStyle) {
    case 'minimal': return chipSvgMinimal(style, opts);
    case 'retro':   return chipSvgRetro(style, opts);
    case 'neon':    return chipSvgNeon(style, opts);
    default:        return chipSvgClassic(style, opts);
  }
}

function chipSvgClassic(style: ChipStyle, opts: { size?: number; showDenom?: boolean } = {}): string {
  const size = opts.size ?? 46;
  const showDenom = opts.showDenom ?? true;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 1;
  const id = `cg${gradientCounter++}`;
  const markW = size * 0.11;
  const markH = size * 0.18;
  const marks = [0, 45, 90, 135, 180, 225, 270, 315]
    .map(deg => `<rect x="${cx - markW / 2}" y="${1.5}" width="${markW}" height="${markH}" rx="1" fill="${style.accent}" transform="rotate(${deg} ${cx} ${cy})"/>`)
    .join('');
  const innerR = size * 0.32;
  const coreR = size * 0.28;
  return `<svg class="chip-svg" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="${id}" cx="50%" cy="35%" r="65%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.45)"/>
        <stop offset="50%" stop-color="rgba(255,255,255,0.08)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
      </radialGradient>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${outerR}" fill="${style.bg}" stroke="rgba(0,0,0,0.6)" stroke-width="0.6"/>
    ${marks}
    <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="${style.bgDark}" stroke="${style.accent}" stroke-width="0.6"/>
    <circle cx="${cx}" cy="${cy}" r="${coreR}" fill="none" stroke="${style.accent}" stroke-width="0.3" stroke-dasharray="1.5 1"/>
    ${showDenom ? `<text x="${cx}" y="${cy + size * 0.08}" font-family="Impact, 'Arial Black', sans-serif" font-size="${size * 0.26}" text-anchor="middle" font-weight="900" fill="${style.accent}" letter-spacing="-0.03em">${style.denom}</text>` : ''}
    <ellipse cx="${cx}" cy="${size * 0.32}" rx="${size * 0.38}" ry="${size * 0.18}" fill="url(#${id})" pointer-events="none"/>
  </svg>`;
}

/** Flat/minimal style: solid circle, no edge marks, just denomination. */
function chipSvgMinimal(style: ChipStyle, opts: { size?: number; showDenom?: boolean } = {}): string {
  const size = opts.size ?? 46;
  const showDenom = opts.showDenom ?? true;
  const cx = size / 2;
  const cy = size / 2;
  return `<svg class="chip-svg" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${size/2 - 1}" fill="${style.bg}"/>
    <circle cx="${cx}" cy="${cy}" r="${size/2 - 2}" fill="none" stroke="${style.accent}" stroke-width="0.8" opacity="0.55"/>
    ${showDenom ? `<text x="${cx}" y="${cy + size * 0.1}" font-family="'Futura Now Headline', 'Helvetica Neue', sans-serif" font-size="${size * 0.32}" text-anchor="middle" font-weight="700" fill="${style.accent}" letter-spacing="-0.05em">${style.denom}</text>` : ''}
  </svg>`;
}

/** Retro pixel style: blocky edges, limited palette, flat. */
function chipSvgRetro(style: ChipStyle, opts: { size?: number; showDenom?: boolean } = {}): string {
  const size = opts.size ?? 46;
  const showDenom = opts.showDenom ?? true;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  // Octagon approximation for a "pixelated" feel
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8 - Math.PI / 8;
    pts.push(`${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`);
  }
  return `<svg class="chip-svg" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <polygon points="${pts.join(' ')}" fill="${style.bg}" stroke="${style.accent}" stroke-width="2"/>
    <polygon points="${pts.join(' ')}" fill="none" stroke="#000" stroke-width="1" opacity="0.3" transform="translate(1 1)"/>
    ${showDenom ? `<text x="${cx}" y="${cy + size * 0.12}" font-family="'Courier New', monospace" font-size="${size * 0.3}" text-anchor="middle" font-weight="900" fill="${style.accent}">${style.denom}</text>` : ''}
  </svg>`;
}

/** Neon / cyberpunk style: glow, bright edges, high contrast. */
function chipSvgNeon(style: ChipStyle, opts: { size?: number; showDenom?: boolean } = {}): string {
  const size = opts.size ?? 46;
  const showDenom = opts.showDenom ?? true;
  const cx = size / 2;
  const cy = size / 2;
  const id = `ng${gradientCounter++}`;
  return `<svg class="chip-svg chip-neon" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${size/2 - 1}" fill="#0a0612" stroke="${style.bg}" stroke-width="2" filter="url(#${id})"/>
    <circle cx="${cx}" cy="${cy}" r="${size/2 - 4}" fill="none" stroke="${style.accent}" stroke-width="0.8" opacity="0.6" stroke-dasharray="2 1"/>
    ${showDenom ? `<text x="${cx}" y="${cy + size * 0.1}" font-family="'Futura Now Headline', monospace" font-size="${size * 0.3}" text-anchor="middle" font-weight="900" fill="${style.bg}" filter="url(#${id})">${style.denom}</text>` : ''}
  </svg>`;
}

/**
 * Build a horizontal fan of chips, each one offset slightly right of the
 * previous so you see about 40% of each underlying chip's face. Reads like
 * a loose hand of coins on the table rather than a tight vertical stack.
 */
export function chipStackHtml(amount: number, opts: { maxVisible?: number; showLabel?: boolean; size?: number } = {}): string {
  const maxVisible = opts.maxVisible ?? 5;
  const showLabel = opts.showLabel ?? true;
  const size = opts.size ?? 40;
  if (amount <= 0) {
    return `<div class="chip-stack empty">${showLabel ? '<div class="chip-label">$0</div>' : ''}</div>`;
  }
  const count = Math.min(maxVisible, 1 + Math.floor(Math.log10(amount + 1) * 1.2));
  const styles = stackStyles(amount, count);

  // Each chip after the first is shifted right by ~60% of its width —
  // enough to see the underlying chip's denomination, not so much the row
  // sprawls across the screen.
  const chipStep = Math.round(size * 0.6);
  const totalWidth = size + chipStep * (count - 1);

  const chips = styles.map((style, i) => {
    const isTop = i === styles.length - 1;
    const left = i * chipStep;
    // Tiny vertical jitter so chips look organically placed, not lined up by ruler.
    const jitter = ((i * 37) % 5) - 2;
    const rot = ((i * 17) % 10) - 5;
    return `<div class="chip-in-stack" style="left:${left}px;top:${jitter}px;transform:rotate(${rot}deg)">${chipSvg(style, { size, showDenom: isTop })}</div>`;
  }).join('');

  return `
    <div class="chip-stack" data-amount="${amount}" style="--chip-stack-width:${totalWidth}px;--chip-stack-height:${size + 4}px">
      <div class="chip-stack-chips">${chips}</div>
      ${showLabel ? `<div class="chip-label">$${amount}</div>` : ''}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Denomination breakdown
// ═══════════════════════════════════════════════════════════════════════

export interface ChipBreakdown {
  denom: number;
  count: number;
  style: ChipStyle;
}

/** Break an amount into standard poker denominations. */
export function breakdownChips(amount: number): ChipBreakdown[] {
  const denoms: Array<{ value: number; style: ChipStyle }> = [
    { value: 1000, style: CHIP_TIERS[0]!.style },
    { value: 500,  style: CHIP_TIERS[1]!.style },
    { value: 100,  style: CHIP_TIERS[2]!.style },
    { value: 25,   style: CHIP_TIERS[3]!.style },
    { value: 5,    style: CHIP_TIERS[4]!.style },
    { value: 1,    style: CHIP_TIERS[5]!.style },
  ];
  const result: ChipBreakdown[] = [];
  let remaining = amount;
  for (const d of denoms) {
    const count = Math.floor(remaining / d.value);
    if (count > 0) {
      result.push({ denom: d.value, count, style: d.style });
      remaining -= count * d.value;
    }
  }
  return result;
}

/** Render a full breakdown popover for a given amount. */
export function breakdownHtml(amount: number): string {
  const parts = breakdownChips(amount);
  const rows = parts.map(p => {
    const chip = chipSvg(p.style, { size: 32, showDenom: true });
    const subtotal = p.denom * p.count;
    return `
      <div class="bd-row">
        <div class="bd-chip">${chip}</div>
        <div class="bd-text">
          <span class="bd-count">${p.count}<span class="bd-times">×</span></span>
          <span class="bd-denom">$${p.denom}</span>
        </div>
        <div class="bd-subtotal">$${subtotal}</div>
      </div>`;
  }).join('');
  return `
    <div class="chip-breakdown">
      <div class="bd-header">Chip breakdown</div>
      <div class="bd-rows">${rows || '<div class="bd-empty">no chips</div>'}</div>
      <div class="bd-total">
        <span>TOTAL</span>
        <span class="bd-total-amount">$${amount}</span>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Flying chip (animation)
// ═══════════════════════════════════════════════════════════════════════

/** Tiny chip element used for the flying-chip animation. */
function flyingChipEl(style: ChipStyle): HTMLElement {
  const el = document.createElement('div');
  el.className = 'flying-chip';
  el.innerHTML = chipSvg(style, { size: 26, showDenom: true });
  return el;
}

function rectCenter(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Fly a small chip from `from` to `to`. Spawns a transient element,
 * animates via CSS, removes itself after the animation.
 */
export function flyChip(
  from: Element | null,
  to: Element | null,
  options: { amount?: number; count?: number; delay?: number; reverse?: boolean } = {},
): void {
  if (!from || !to) return;
  const fromC = rectCenter(from);
  const toC   = rectCenter(to);
  const style = topChipStyle(options.amount ?? 25);
  const count = options.count ?? 1;
  const baseDelay = options.delay ?? 0;
  for (let i = 0; i < count; i++) {
    const chip = flyingChipEl(style);
    chip.style.left = `${fromC.x}px`;
    chip.style.top  = `${fromC.y}px`;
    chip.style.setProperty('--fly-dx', `${toC.x - fromC.x}px`);
    chip.style.setProperty('--fly-dy', `${toC.y - fromC.y}px`);
    chip.style.animationDelay = `${baseDelay + i * 40}ms`;
    if (options.reverse) chip.classList.add('reverse');
    document.body.appendChild(chip);
    const duration = 560 + i * 40;
    setTimeout(() => chip.remove(), duration + baseDelay + 100);
  }
}
