/**
 * User-facing visual settings (card-back style, table background).
 * Persisted in localStorage, applied as body classes so CSS handles the rest.
 */

export type CardBackTheme = 'classic' | 'hatch' | 'wave' | 'grid';
export type TableTheme = 'felt' | 'onyx' | 'burgundy' | 'noir';
export type ChipStyle = 'classic' | 'minimal' | 'retro' | 'neon';
export type ColorMode = 'dark' | 'light';
export type BgAnimation = 'static' | 'particles' | 'aurora' | 'starfield';

export interface Settings {
  cardBack: string;
  tableBg: string;
  chipStyle: string;
  mode: string;
  bgAnim: string;
  sound: boolean;
  reducedMotion: boolean;
  lang: string;
}

const STORAGE_KEY = 'iamjacke-poker-settings';

const DEFAULTS: Settings = {
  cardBack: 'hatch',
  tableBg: 'felt',
  chipStyle: 'classic',
  mode: 'dark',
  bgAnim: 'static',
  sound: true,
  reducedMotion: false,
  lang: 'en',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      cardBack: parsed.cardBack ?? DEFAULTS.cardBack,
      tableBg: parsed.tableBg ?? DEFAULTS.tableBg,
      chipStyle: parsed.chipStyle ?? DEFAULTS.chipStyle,
      mode: parsed.mode ?? DEFAULTS.mode,
      bgAnim: parsed.bgAnim ?? DEFAULTS.bgAnim,
      sound: parsed.sound ?? DEFAULTS.sound,
      reducedMotion: parsed.reducedMotion ?? DEFAULTS.reducedMotion,
      lang: parsed.lang ?? DEFAULTS.lang,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** Apply settings by setting data-* attributes on <body>. CSS keys off these. */
export function applySettings(s: Settings): void {
  document.body.dataset['cardback'] = s.cardBack;
  document.body.dataset['tablebg'] = s.tableBg;
  document.body.dataset['chipstyle'] = s.chipStyle;
  document.body.dataset['mode'] = s.mode;
  document.body.dataset['bganim'] = s.bgAnim;
  document.body.dataset['reducedmotion'] = s.reducedMotion ? 'on' : 'off';
  document.body.dataset['sound'] = s.sound ? 'on' : 'off';
  document.body.dataset['lang'] = s.lang;
}
