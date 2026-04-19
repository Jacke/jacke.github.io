/**
 * Konami Code → Synthwave mode.
 * ↑↑↓↓←→←→BA
 *
 * Full retrowave scene: perspective grid, retro sun, DeLorean silhouette,
 * music from mp3. Runs until track ends or Escape.
 */
(function () {
  'use strict';

  var SEQ = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
  var pos = 0;
  var active = false;

  document.addEventListener('keydown', function (e) {
    if (active && e.key === 'Escape') { teardown(); return; }
    if (active) return;
    if (e.keyCode === SEQ[pos]) {
      pos++;
      if (pos === SEQ.length) { pos = 0; activate(); }
    } else {
      pos = e.keyCode === SEQ[0] ? 1 : 0;
    }
  });

  var cv, cx, audio, animId;
  var startTime = 0;

  function activate() {
    if (active) return;
    active = true;

    // Canvas overlay
    cv = document.createElement('canvas');
    cv.id = 'synthwave-scene';
    cv.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9998;opacity:0;transition:opacity 0.8s ease;';
    document.body.appendChild(cv);
    requestAnimationFrame(function () { cv.style.opacity = '1'; });

    // Dim existing canvases
    ['hero-canvas', 'cursor-canvas', 'mesh-bg'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.style.transition = 'opacity 0.8s'; el.style.opacity = '0.05'; }
    });
    var ed = document.getElementById('editorial');
    if (ed) { ed.style.transition = 'opacity 0.8s'; ed.style.opacity = '0.1'; }
    var nav = document.getElementById('site-nav');
    if (nav) { nav.style.transition = 'opacity 0.4s'; nav.style.opacity = '0'; nav.style.pointerEvents = 'none'; }

    resize();
    window.addEventListener('resize', resize);

    // Music — mp3
    audio = new Audio('/js/synthwave.mp3');
    audio.volume = 0;
    audio.play().catch(function () {});
    // Fade in
    var fadeIn = setInterval(function () {
      if (!audio) { clearInterval(fadeIn); return; }
      if (audio.volume < 0.8) audio.volume = Math.min(0.8, audio.volume + 0.05);
      else clearInterval(fadeIn);
    }, 80);
    // End when track finishes
    audio.addEventListener('ended', teardown);

    startTime = performance.now();
    animId = requestAnimationFrame(frame);
  }

  function teardown() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(animId);

    // Fade out canvas
    if (cv) cv.style.opacity = '0';

    // Fade out audio
    if (audio) {
      var fadeOut = setInterval(function () {
        if (!audio) { clearInterval(fadeOut); return; }
        if (audio.volume > 0.05) audio.volume = Math.max(0, audio.volume - 0.05);
        else { clearInterval(fadeOut); audio.pause(); audio = null; }
      }, 60);
    }

    ['hero-canvas', 'cursor-canvas', 'mesh-bg'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.opacity = '';
    });
    var ed = document.getElementById('editorial');
    if (ed) ed.style.opacity = '';
    var nav = document.getElementById('site-nav');
    if (nav) { nav.style.opacity = ''; nav.style.pointerEvents = ''; }

    setTimeout(function () {
      if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
      cv = null;
    }, 1000);
  }

  var W, H, dpr;
  function resize() {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCENE
  // ═══════════════════════════════════════════════════════════════════

  var stars = [];
  for (var i = 0; i < 120; i++) {
    stars.push({ x: Math.random(), y: Math.random() * 0.45, s: 0.5 + Math.random() * 1.5, b: Math.random() });
  }

  function frame(now) {
    if (!active) return;
    animId = requestAnimationFrame(frame);
    var t = (now - startTime) / 1000;

    cx = cv.getContext('2d');
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, W, H);

    var horizon = H * 0.52;
    var pulse = 0.5 + Math.sin(t * 3) * 0.15;

    // ── Sky gradient
    var sky = cx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#0a0012');
    sky.addColorStop(0.4, '#1a0030');
    sky.addColorStop(0.7, '#3a0050');
    sky.addColorStop(1, '#ff006030');
    cx.fillStyle = sky;
    cx.fillRect(0, 0, W, horizon);

    // ── Stars
    for (var si = 0; si < stars.length; si++) {
      var st = stars[si];
      var twinkle = 0.3 + Math.sin(t * 2 + st.b * 10) * 0.3;
      cx.fillStyle = 'rgba(255,255,255,' + (twinkle * 0.7) + ')';
      cx.fillRect(st.x * W, st.y * H, st.s, st.s);
    }

    // ── Sun
    var sunR = Math.min(W, H) * 0.18;
    var sunX = W / 2;
    var sunY = horizon - sunR * 0.3;
    var sunG = cx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
    sunG.addColorStop(0, '#ff4080');
    sunG.addColorStop(0.3, '#ff2060');
    sunG.addColorStop(0.6, '#cc1050');
    sunG.addColorStop(1, '#80004020');
    cx.fillStyle = sunG;
    cx.beginPath();
    cx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    cx.fill();

    // Sun horizontal stripes
    cx.save();
    cx.beginPath();
    cx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    cx.clip();
    cx.fillStyle = '#0a0012';
    var stripeH = sunR * 0.08;
    for (var sy = sunY - sunR; sy < sunY + sunR; sy += stripeH * 2.8) {
      var offset = sy - (sunY - sunR);
      var grow = offset / (sunR * 2);
      cx.fillRect(sunX - sunR, sy + grow * stripeH * 3, sunR * 2, stripeH * (0.3 + grow * 1.5));
    }
    cx.restore();

    // Sun glow
    cx.save();
    cx.globalCompositeOperation = 'screen';
    var glowG = cx.createRadialGradient(sunX, sunY, sunR * 0.5, sunX, sunY, sunR * 2.5);
    glowG.addColorStop(0, 'rgba(255,0,128,' + (0.08 + pulse * 0.04) + ')');
    glowG.addColorStop(1, 'transparent');
    cx.fillStyle = glowG;
    cx.fillRect(0, 0, W, horizon + 40);
    cx.restore();

    // ── Ground
    cx.fillStyle = '#0a0012';
    cx.fillRect(0, horizon, W, H - horizon);

    // ── Perspective grid
    cx.strokeStyle = 'rgba(255,0,180,' + (0.25 + pulse * 0.1) + ')';
    cx.lineWidth = 1;

    var gridLines = 20;
    for (var gi = 0; gi <= gridLines; gi++) {
      var frac = gi / gridLines;
      var y = horizon + (H - horizon) * Math.pow(frac, 1.8);
      cx.globalAlpha = 0.15 + frac * 0.5;
      cx.beginPath();
      cx.moveTo(0, y);
      cx.lineTo(W, y);
      cx.stroke();
    }

    var vLines = 24;
    cx.globalAlpha = 1;
    for (var vi = -vLines; vi <= vLines; vi++) {
      var xFrac = vi / (vLines * 0.6);
      var topX = W / 2 + xFrac * 2;
      var botX = W / 2 + xFrac * W * 0.8;
      var alpha = Math.max(0, 0.3 - Math.abs(xFrac) * 0.15);
      cx.strokeStyle = 'rgba(0,200,255,' + alpha + ')';
      cx.beginPath();
      cx.moveTo(topX, horizon);
      cx.lineTo(botX, H);
      cx.stroke();
    }

    var scrollOffset = (t * 0.4) % 1;
    cx.strokeStyle = 'rgba(255,0,180,0.2)';
    for (var mi = 0; mi < 8; mi++) {
      var mFrac = ((mi / 8 + scrollOffset) % 1);
      var my = horizon + (H - horizon) * Math.pow(mFrac, 1.6);
      cx.globalAlpha = 0.1 + mFrac * 0.25;
      cx.beginPath();
      cx.moveTo(0, my);
      cx.lineTo(W, my);
      cx.stroke();
    }
    cx.globalAlpha = 1;

    // ── DeLorean
    drawCar(t, pulse);

    // ── Scanlines
    cx.fillStyle = 'rgba(0,0,0,0.06)';
    for (var sl = 0; sl < H; sl += 3) {
      cx.fillRect(0, sl, W, 1);
    }

    // ── "SYNTHWAVE" text
    var textSize = Math.min(W * 0.12, 80);
    cx.font = 'bold ' + textSize + 'px "Futura Now Headline", Impact, sans-serif';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    var textY = H * 0.15;
    cx.save();
    cx.shadowColor = '#ff00b4';
    cx.shadowBlur = 30 + pulse * 20;
    cx.fillStyle = '#ff00b4';
    cx.fillText('SYNTHWAVE', W / 2, textY);
    cx.shadowColor = '#00c8ff';
    cx.shadowBlur = 20;
    cx.fillText('SYNTHWAVE', W / 2 + 2, textY + 2);
    cx.restore();
    cx.fillStyle = '#fff';
    cx.globalAlpha = 0.9;
    cx.fillText('SYNTHWAVE', W / 2, textY);
    cx.globalAlpha = 1;

    // ── ESC hint
    cx.font = '12px "Dank Mono", monospace';
    cx.fillStyle = 'rgba(255,255,255,0.3)';
    cx.textAlign = 'right';
    cx.fillText('ESC to exit', W - 20, H - 16);
  }

  function drawCar(t, pulse) {
    var carW = Math.min(W * 0.28, 260);
    var carX = W / 2;
    var carY = H * 0.72 + Math.sin(t * 1.5) * 3;
    var s = carW / 260;

    cx.save();
    cx.translate(carX, carY);
    cx.scale(s, s);

    // Shadow
    cx.fillStyle = 'rgba(0,0,0,0.5)';
    cx.beginPath();
    cx.ellipse(0, 42, 135, 12, 0, 0, Math.PI * 2);
    cx.fill();

    // Body
    cx.fillStyle = '#1a1824';
    cx.beginPath();
    cx.moveTo(-120, 30);
    cx.lineTo(-130, 25); cx.lineTo(-128, 10); cx.lineTo(-90, -5);
    cx.lineTo(-50, -35); cx.lineTo(20, -40); cx.lineTo(70, -25);
    cx.lineTo(110, -15); cx.lineTo(125, 5); cx.lineTo(130, 25); cx.lineTo(125, 30);
    cx.closePath();
    cx.fill();

    // Body highlight
    cx.strokeStyle = 'rgba(100,80,200,0.3)';
    cx.lineWidth = 1;
    cx.beginPath();
    cx.moveTo(-90, -5); cx.lineTo(-50, -35); cx.lineTo(20, -40);
    cx.lineTo(70, -25); cx.lineTo(110, -15);
    cx.stroke();

    // Windows
    cx.fillStyle = 'rgba(0,150,255,0.15)';
    cx.beginPath();
    cx.moveTo(-48, -33); cx.lineTo(-15, -37); cx.lineTo(-15, -8); cx.lineTo(-45, -8);
    cx.closePath(); cx.fill();
    cx.beginPath();
    cx.moveTo(-10, -37); cx.lineTo(18, -38); cx.lineTo(65, -23);
    cx.lineTo(50, -8); cx.lineTo(-10, -8);
    cx.closePath(); cx.fill();

    cx.strokeStyle = 'rgba(0,200,255,0.2)';
    cx.lineWidth = 0.5;
    cx.beginPath();
    cx.moveTo(-48, -33); cx.lineTo(-15, -37); cx.lineTo(18, -38); cx.lineTo(65, -23);
    cx.stroke();

    // Door line
    cx.strokeStyle = 'rgba(255,255,255,0.08)';
    cx.beginPath(); cx.moveTo(-15, -37); cx.lineTo(-15, 25); cx.stroke();

    // Wheels
    function drawWheel(wx) {
      cx.fillStyle = '#0a0a0a';
      cx.beginPath(); cx.arc(wx, 30, 14, 0, Math.PI * 2); cx.fill();
      cx.strokeStyle = '#333'; cx.lineWidth = 2; cx.stroke();
      cx.fillStyle = '#222';
      cx.beginPath(); cx.arc(wx, 30, 5, 0, Math.PI * 2); cx.fill();
      cx.save(); cx.translate(wx, 30); cx.rotate(t * 8);
      cx.strokeStyle = '#333'; cx.lineWidth = 1;
      for (var sp = 0; sp < 5; sp++) {
        cx.beginPath(); cx.moveTo(0, 0);
        cx.lineTo(Math.cos(sp * Math.PI * 2 / 5) * 11, Math.sin(sp * Math.PI * 2 / 5) * 11);
        cx.stroke();
      }
      cx.restore();
    }
    drawWheel(-85);
    drawWheel(90);

    // Headlights
    cx.fillStyle = 'rgba(255,220,100,0.9)';
    cx.beginPath(); cx.ellipse(-126, 14, 4, 3, 0, 0, Math.PI * 2); cx.fill();
    cx.beginPath(); cx.ellipse(-126, 22, 4, 3, 0, 0, Math.PI * 2); cx.fill();
    cx.save();
    cx.globalCompositeOperation = 'screen';
    var beam = cx.createRadialGradient(-130, 18, 5, -130, 18, 120);
    beam.addColorStop(0, 'rgba(255,220,100,' + (0.15 + pulse * 0.05) + ')');
    beam.addColorStop(1, 'transparent');
    cx.fillStyle = beam;
    cx.fillRect(-260, -20, 150, 80);
    cx.restore();

    // Tail lights
    cx.fillStyle = 'rgba(255,0,60,' + (0.7 + pulse * 0.3) + ')';
    cx.fillRect(122, 8, 6, 16);
    cx.save();
    cx.globalCompositeOperation = 'screen';
    var tailG = cx.createRadialGradient(128, 16, 3, 128, 16, 50);
    tailG.addColorStop(0, 'rgba(255,0,60,' + (0.2 + pulse * 0.1) + ')');
    tailG.addColorStop(1, 'transparent');
    cx.fillStyle = tailG;
    cx.fillRect(100, -30, 80, 100);
    cx.restore();

    // Neon underglow
    cx.save();
    cx.globalCompositeOperation = 'screen';
    var under = cx.createRadialGradient(0, 40, 10, 0, 40, 140);
    under.addColorStop(0, 'rgba(0,200,255,' + (0.12 + pulse * 0.06) + ')');
    under.addColorStop(1, 'transparent');
    cx.fillStyle = under;
    cx.fillRect(-150, 20, 300, 60);
    cx.restore();

    cx.restore();
  }
})();
