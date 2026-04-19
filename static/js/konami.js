/**
 * Konami Code → 10-second synthwave/neon mode.
 * ↑↑↓↓←→←→BA
 *
 * Injects a full-screen overlay with scanlines, shifts particle hue to
 * magenta/cyan via a CSS filter on hero-canvas, and pulses a neon glow.
 * Reverts cleanly after 10 seconds.
 */
(function () {
  'use strict';

  var SEQ = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65]; // ↑↑↓↓←→←→BA
  var pos = 0;
  var active = false;

  document.addEventListener('keydown', function (e) {
    if (active) return;
    if (e.keyCode === SEQ[pos]) {
      pos++;
      if (pos === SEQ.length) {
        pos = 0;
        activate();
      }
    } else {
      pos = e.keyCode === SEQ[0] ? 1 : 0;
    }
  });

  function activate() {
    if (active) return;
    active = true;

    // Overlay with scanlines
    var ov = document.createElement('div');
    ov.id = 'synthwave-overlay';
    ov.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;' +
      'pointer-events:none;opacity:0;transition:opacity 0.6s ease;' +
      'background:linear-gradient(180deg,' +
        'transparent 0%,rgba(255,0,128,0.03) 2%,transparent 4%);' +
      'background-size:100% 4px;' +
      'mix-blend-mode:screen;';
    document.body.appendChild(ov);

    // Neon glow under content
    var glow = document.createElement('div');
    glow.id = 'synthwave-glow';
    glow.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2;' +
      'pointer-events:none;opacity:0;transition:opacity 0.8s ease;' +
      'background:radial-gradient(ellipse at 50% 60%,' +
        'rgba(255,0,180,0.12) 0%,' +
        'rgba(0,200,255,0.06) 40%,' +
        'transparent 70%);';
    document.body.appendChild(glow);

    // CSS filter on hero canvas for neon hue
    var hero = document.getElementById('hero-canvas');
    var cursor = document.getElementById('cursor-canvas');
    var mesh = document.getElementById('mesh-bg');
    var origFilter = '';
    if (hero) {
      origFilter = hero.style.filter;
      hero.style.transition = 'filter 0.6s ease';
      hero.style.filter = 'hue-rotate(280deg) saturate(2.5) brightness(1.3)';
    }
    if (cursor) {
      cursor.style.transition = 'filter 0.6s ease';
      cursor.style.filter = 'hue-rotate(280deg) saturate(2)';
    }
    if (mesh) {
      mesh.style.transition = 'filter 0.6s ease';
      mesh.style.filter = 'hue-rotate(260deg) saturate(3) brightness(1.5)';
    }

    // Animate in
    requestAnimationFrame(function () {
      ov.style.opacity = '1';
      glow.style.opacity = '1';
    });

    // Flash announcement
    var msg = document.createElement('div');
    msg.style.cssText =
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10000;' +
      'font-family:"Futura Now Headline",Impact,sans-serif;font-weight:bold;' +
      'font-size:clamp(28px,5vw,56px);color:#ff00b4;' +
      'text-shadow:0 0 40px #ff00b4,0 0 80px #00c8ff,0 0 120px #ff00b4;' +
      'letter-spacing:0.15em;text-transform:uppercase;' +
      'opacity:0;transition:opacity 0.4s ease;pointer-events:none;';
    msg.textContent = 'SYNTHWAVE';
    document.body.appendChild(msg);
    requestAnimationFrame(function () { msg.style.opacity = '1'; });
    setTimeout(function () {
      msg.style.opacity = '0';
      setTimeout(function () { msg.remove(); }, 500);
    }, 2000);

    // Revert after 10s
    setTimeout(function () {
      ov.style.opacity = '0';
      glow.style.opacity = '0';
      if (hero) hero.style.filter = origFilter;
      if (cursor) cursor.style.filter = '';
      if (mesh) mesh.style.filter = '';
      setTimeout(function () {
        ov.remove();
        glow.remove();
        active = false;
      }, 800);
    }, 10000);
  }
})();
