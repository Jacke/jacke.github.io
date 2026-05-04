// Theme: dark | light. Hermes-style 2-mode switch.
// Yellow midpoint shows during 0.6s keyframe transition between modes.
(function () {
  'use strict';

  const PALETTE = {
    dark:  { background:[13,10,7],     foreground:[255,253,248], midground:[200,168,130], dim:[216,206,195], mute:[109,100,93], glow:[149,95,59] },
    light: { background:[255,255,255], foreground:[13,10,7],     midground:[164,126,59],  dim:[60,55,50],    mute:[136,136,136],glow:[164,126,59] }
  };
  const THEMES = ['dark','light'];
  const STORAGE_KEY = 'theme';
  // Animation runs 300ms in CSS; cleanup waits a beat after to avoid killing
  // the animation early (browsers stop running animations whose matching rule
  // is removed mid-flight, which would clip the yellow midpoint).
  const TRANSITION_MS = 380;

  function getTheme() { return document.documentElement.dataset.theme || 'dark'; }

  function detect() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.includes(stored)) return stored;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function rgb(arr, alpha) {
    const [r,g,b] = arr;
    return alpha != null ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`;
  }

  window.tc = function (key, alpha) {
    const p = PALETTE[getTheme()] || PALETTE.dark;
    return rgb(p[key] || [0,0,0], alpha);
  };
  window.__themePalette = PALETTE;

  function setMetaThemeColor(theme) {
    const p = PALETTE[theme];
    let m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
    m.content = rgb(p.background);
  }

  function applyTheme(theme, persist, animate) {
    if (!THEMES.includes(theme)) theme = 'dark';
    const root = document.documentElement;
    if (animate) {
      root.dataset.toggling = 'to-' + theme;
      setTimeout(() => { delete root.dataset.toggling; }, TRANSITION_MS);
    }
    root.dataset.theme = theme;
    setMetaThemeColor(theme);
    if (persist) localStorage.setItem(STORAGE_KEY, theme);
    root.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  // (Pre-paint script in HTML already set data-theme; just ensure consistency.)
  if (!document.documentElement.dataset.theme) applyTheme(detect(), false, false);
  setMetaThemeColor(getTheme());

  // 2-stop Hermes-style pill switch (sun/moon icons, sliding knob).
  function buildToggle() {
    const wrap = document.createElement('button');
    wrap.id = 'theme-toggle';
    wrap.type = 'button';
    wrap.setAttribute('aria-label', 'Toggle dark/light theme');
    wrap.innerHTML = `
      <svg class="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="5"></circle>
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
      </svg>
      <svg class="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
      <span class="theme-knob" aria-hidden="true"></span>
    `;
    return wrap;
  }

  function syncToggle(toggle) {
    const t = getTheme();
    toggle.dataset.theme = t;
    toggle.setAttribute('aria-pressed', t === 'light' ? 'true' : 'false');
    toggle.setAttribute('aria-label', `Switch to ${t === 'light' ? 'dark' : 'light'} mode`);
  }

  function mountToggle() {
    if (document.getElementById('theme-toggle')) return;
    const toggle = buildToggle();
    toggle.addEventListener('click', () => {
      const next = getTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next, true, true);
      syncToggle(toggle);
    });
    document.body.appendChild(toggle);
    syncToggle(toggle);
    document.documentElement.addEventListener('themechange', () => syncToggle(toggle));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToggle);
  } else {
    mountToggle();
  }
})();
