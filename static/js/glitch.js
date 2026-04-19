/**
 * Shake-to-glitch — mobile (DeviceMotion) + desktop (triple rapid click).
 *
 * 0.5s CSS glitch: hue-rotate + skewX + brightness flicker on <body>.
 * Cooldown 3s between triggers to prevent spam.
 */
(function () {
  'use strict';

  var cooldown = false;
  var COOLDOWN_MS = 3000;
  var GLITCH_MS = 500;

  function fireGlitch() {
    if (cooldown) return;
    cooldown = true;

    var b = document.body;
    // Inject glitch keyframes if not present
    if (!document.getElementById('glitch-kf')) {
      var s = document.createElement('style');
      s.id = 'glitch-kf';
      s.textContent =
        '@keyframes site-glitch{' +
        '0%{filter:none;transform:none}' +
        '10%{filter:hue-rotate(90deg) brightness(1.8) contrast(1.5);transform:skewX(-2deg) translateX(3px)}' +
        '20%{filter:hue-rotate(200deg) brightness(0.7) saturate(3);transform:skewX(1deg) translateX(-2px)}' +
        '30%{filter:invert(1) hue-rotate(30deg);transform:skewX(-1deg)}' +
        '40%{filter:hue-rotate(320deg) brightness(1.4) contrast(2);transform:translateY(2px)}' +
        '50%{filter:hue-rotate(180deg) saturate(0.3);transform:skewX(3deg) translateX(1px)}' +
        '60%{filter:brightness(2) contrast(0.8);transform:skewX(-2deg)}' +
        '70%{filter:hue-rotate(60deg) saturate(4);transform:translateX(-3px) translateY(-1px)}' +
        '80%{filter:invert(0.5) hue-rotate(270deg);transform:skewX(1deg)}' +
        '90%{filter:brightness(0.5) contrast(2) hue-rotate(140deg);transform:translateX(2px)}' +
        '100%{filter:none;transform:none}' +
        '}';
      document.head.appendChild(s);
    }

    b.style.animation = 'site-glitch ' + GLITCH_MS + 'ms linear';
    b.addEventListener('animationend', function handler() {
      b.style.animation = '';
      b.removeEventListener('animationend', handler);
    });

    setTimeout(function () { cooldown = false; }, COOLDOWN_MS);
  }

  // ── Mobile: DeviceMotion shake detection ──
  var shakeThreshold = 25;
  var lastAcc = { x: 0, y: 0, z: 0 };
  var shakeReady = false;

  window.addEventListener('devicemotion', function (e) {
    var a = e.accelerationIncludingGravity;
    if (!a) return;
    if (!shakeReady) {
      lastAcc.x = a.x || 0;
      lastAcc.y = a.y || 0;
      lastAcc.z = a.z || 0;
      shakeReady = true;
      return;
    }
    var dx = Math.abs((a.x || 0) - lastAcc.x);
    var dy = Math.abs((a.y || 0) - lastAcc.y);
    var dz = Math.abs((a.z || 0) - lastAcc.z);
    lastAcc.x = a.x || 0;
    lastAcc.y = a.y || 0;
    lastAcc.z = a.z || 0;
    if (dx + dy + dz > shakeThreshold) fireGlitch();
  });

  // ── Desktop: triple rapid click ──
  var clicks = [];
  document.addEventListener('click', function (e) {
    // Only fire on "empty" area — not links, buttons, inputs
    if (e.target.closest('a,button,input,textarea,select,canvas')) return;
    var now = Date.now();
    clicks.push(now);
    // Keep last 3 clicks
    while (clicks.length > 3) clicks.shift();
    if (clicks.length === 3 && clicks[2] - clicks[0] < 600) {
      clicks = [];
      fireGlitch();
    }
  });
})();
