/**
 * Konami Code → Synthwave mode.
 * ↑↑↓↓←→←→BA
 *
 * Full retrowave scene: perspective grid, retro sun, DeLorean silhouette,
 * procedural synthwave music via Web Audio API. Runs 30s or until Escape.
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

  var cv, cx, actx, masterGain, teardownTimer, animId;
  var startTime = 0;
  var DURATION = 30;

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

    resize();
    window.addEventListener('resize', resize);

    // Music
    actx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = actx.createGain();
    masterGain.gain.value = 0;
    masterGain.gain.linearRampToValueAtTime(0.35, actx.currentTime + 1.5);
    masterGain.connect(actx.destination);
    startMusic();

    startTime = performance.now();
    animId = requestAnimationFrame(frame);

    teardownTimer = setTimeout(teardown, DURATION * 1000);
  }

  function teardown() {
    if (!active) return;
    active = false;
    clearTimeout(teardownTimer);
    cancelAnimationFrame(animId);

    // Fade out
    if (cv) cv.style.opacity = '0';
    if (masterGain && actx) {
      masterGain.gain.linearRampToValueAtTime(0, actx.currentTime + 1);
      setTimeout(function () { try { actx.close(); } catch (e) {} }, 1200);
    }

    ['hero-canvas', 'cursor-canvas', 'mesh-bg'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.opacity = '';
    });
    var ed = document.getElementById('editorial');
    if (ed) ed.style.opacity = '';

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
    var pulse = 0.5 + Math.sin(t * 3) * 0.15; // beat pulse

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

    // Sun horizontal stripes (scan lines through sun)
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

    // Horizontal lines (receding to horizon)
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

    // Vertical lines (perspective vanishing point)
    var vLines = 24;
    var scrollOffset = (t * 0.4) % 1; // vertical scroll animation
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

    // Scrolling horizontal grid lines for motion effect
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

    // ── Scanlines overlay
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

    // Text glow
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
    var carH = carW * 0.32;
    var carX = W / 2;
    var carY = H * 0.72 + Math.sin(t * 1.5) * 3; // slight bobbing
    var s = carW / 260; // scale factor

    cx.save();
    cx.translate(carX, carY);
    cx.scale(s, s);

    // Shadow under car
    cx.fillStyle = 'rgba(0,0,0,0.5)';
    cx.beginPath();
    cx.ellipse(0, 42, 135, 12, 0, 0, Math.PI * 2);
    cx.fill();

    // Body — DeLorean wedge silhouette
    cx.fillStyle = '#1a1824';
    cx.beginPath();
    // Bottom line
    cx.moveTo(-120, 30);
    // Front bumper
    cx.lineTo(-130, 25);
    cx.lineTo(-128, 10);
    // Hood (low wedge)
    cx.lineTo(-90, -5);
    // Windshield
    cx.lineTo(-50, -35);
    // Roof
    cx.lineTo(20, -40);
    // Rear window
    cx.lineTo(70, -25);
    // Trunk/rear deck
    cx.lineTo(110, -15);
    // Rear bumper
    cx.lineTo(125, 5);
    cx.lineTo(130, 25);
    cx.lineTo(125, 30);
    cx.closePath();
    cx.fill();

    // Body highlight (top edge)
    cx.strokeStyle = 'rgba(100,80,200,0.3)';
    cx.lineWidth = 1;
    cx.beginPath();
    cx.moveTo(-90, -5);
    cx.lineTo(-50, -35);
    cx.lineTo(20, -40);
    cx.lineTo(70, -25);
    cx.lineTo(110, -15);
    cx.stroke();

    // Windows
    cx.fillStyle = 'rgba(0,150,255,0.15)';
    cx.beginPath();
    cx.moveTo(-48, -33);
    cx.lineTo(-15, -37);
    cx.lineTo(-15, -8);
    cx.lineTo(-45, -8);
    cx.closePath();
    cx.fill();
    cx.beginPath();
    cx.moveTo(-10, -37);
    cx.lineTo(18, -38);
    cx.lineTo(65, -23);
    cx.lineTo(50, -8);
    cx.lineTo(-10, -8);
    cx.closePath();
    cx.fill();

    // Window reflections
    cx.strokeStyle = 'rgba(0,200,255,0.2)';
    cx.lineWidth = 0.5;
    cx.beginPath();
    cx.moveTo(-48, -33);
    cx.lineTo(-15, -37);
    cx.lineTo(18, -38);
    cx.lineTo(65, -23);
    cx.stroke();

    // Door line
    cx.strokeStyle = 'rgba(255,255,255,0.08)';
    cx.lineWidth = 0.5;
    cx.beginPath();
    cx.moveTo(-15, -37);
    cx.lineTo(-15, 25);
    cx.stroke();

    // Wheels
    var wheelR = 14;
    // Front wheel
    cx.fillStyle = '#0a0a0a';
    cx.beginPath();
    cx.arc(-85, 30, wheelR, 0, Math.PI * 2);
    cx.fill();
    cx.strokeStyle = '#333';
    cx.lineWidth = 2;
    cx.stroke();
    // Hub
    cx.fillStyle = '#222';
    cx.beginPath();
    cx.arc(-85, 30, 5, 0, Math.PI * 2);
    cx.fill();
    // Spokes (rotating)
    cx.save();
    cx.translate(-85, 30);
    cx.rotate(t * 8);
    cx.strokeStyle = '#333';
    cx.lineWidth = 1;
    for (var sp = 0; sp < 5; sp++) {
      cx.beginPath();
      cx.moveTo(0, 0);
      cx.lineTo(Math.cos(sp * Math.PI * 2 / 5) * 11, Math.sin(sp * Math.PI * 2 / 5) * 11);
      cx.stroke();
    }
    cx.restore();

    // Rear wheel
    cx.fillStyle = '#0a0a0a';
    cx.beginPath();
    cx.arc(90, 30, wheelR, 0, Math.PI * 2);
    cx.fill();
    cx.strokeStyle = '#333';
    cx.lineWidth = 2;
    cx.stroke();
    cx.fillStyle = '#222';
    cx.beginPath();
    cx.arc(90, 30, 5, 0, Math.PI * 2);
    cx.fill();
    cx.save();
    cx.translate(90, 30);
    cx.rotate(t * 8);
    cx.strokeStyle = '#333';
    cx.lineWidth = 1;
    for (var sp2 = 0; sp2 < 5; sp2++) {
      cx.beginPath();
      cx.moveTo(0, 0);
      cx.lineTo(Math.cos(sp2 * Math.PI * 2 / 5) * 11, Math.sin(sp2 * Math.PI * 2 / 5) * 11);
      cx.stroke();
    }
    cx.restore();

    // Headlights
    cx.fillStyle = 'rgba(255,220,100,0.9)';
    cx.beginPath();
    cx.ellipse(-126, 14, 4, 3, 0, 0, Math.PI * 2);
    cx.fill();
    cx.fillStyle = 'rgba(255,220,100,0.9)';
    cx.beginPath();
    cx.ellipse(-126, 22, 4, 3, 0, 0, Math.PI * 2);
    cx.fill();
    // Headlight beams
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
    // Tail light glow
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

  // ═══════════════════════════════════════════════════════════════════
  // MUSIC — procedural synthwave via Web Audio API
  // ═══════════════════════════════════════════════════════════════════

  function startMusic() {
    var BPM = 120;
    var beatSec = 60 / BPM;
    var bar = beatSec * 4;
    var now = actx.currentTime;
    var total = DURATION;
    var bars = Math.floor(total / bar);

    // Chord progression: Am – F – C – G (classic synthwave)
    var chords = [
      [220.00, 261.63, 329.63], // Am (A3, C4, E4)
      [174.61, 220.00, 261.63], // F  (F3, A3, C4)
      [261.63, 329.63, 392.00], // C  (C4, E4, G4)
      [196.00, 246.94, 293.66], // G  (G3, B3, D4)
    ];

    // ── Kick drum
    for (var ki = 0; ki < bars * 4; ki++) {
      var kt = now + ki * beatSec;
      if (kt > now + total) break;
      scheduleKick(kt);
    }

    // ── Snare on 2 and 4
    for (var sni = 0; sni < bars * 2; sni++) {
      var snt = now + sni * beatSec * 2 + beatSec;
      if (snt > now + total) break;
      scheduleSnare(snt);
    }

    // ── Hi-hat 8ths
    for (var hi = 0; hi < bars * 8; hi++) {
      var ht = now + hi * beatSec * 0.5;
      if (ht > now + total) break;
      scheduleHat(ht, hi % 2 === 0 ? 0.06 : 0.03);
    }

    // ── Bass (root notes, one per bar)
    var bassNotes = [110, 87.31, 130.81, 98]; // Am root, F root, C root, G root
    for (var bi = 0; bi < bars; bi++) {
      var bt = now + bi * bar;
      if (bt > now + total) break;
      scheduleBass(bt, bassNotes[bi % 4], bar);
    }

    // ── Arp synth (16th notes through chord tones)
    var sixteenth = beatSec / 4;
    for (var ai = 0; ai < bars * 16; ai++) {
      var at = now + ai * sixteenth;
      if (at > now + total) break;
      var barIdx = Math.floor(ai / 16) % 4;
      var noteIdx = ai % 3;
      var freq = chords[barIdx][noteIdx] * 2; // Octave up
      scheduleArp(at, freq, sixteenth * 0.8);
    }

    // ── Pad (sustained chords)
    for (var pi = 0; pi < bars; pi++) {
      var pt = now + pi * bar;
      if (pt > now + total) break;
      var ci = pi % 4;
      schedulePad(pt, chords[ci], bar);
    }
  }

  function scheduleKick(t) {
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.08);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 0.25);
  }

  function scheduleSnare(t) {
    // Noise burst
    var bufSize = actx.sampleRate * 0.08;
    var buf = actx.createBuffer(1, bufSize, actx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
    var src = actx.createBufferSource();
    src.buffer = buf;
    var g = actx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    var f = actx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 2000;
    src.connect(f); f.connect(g); g.connect(masterGain);
    src.start(t);

    // Body
    var o = actx.createOscillator();
    var g2 = actx.createGain();
    o.type = 'sine'; o.frequency.value = 180;
    g2.gain.setValueAtTime(0.2, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g2); g2.connect(masterGain);
    o.start(t); o.stop(t + 0.1);
  }

  function scheduleHat(t, vol) {
    var bufSize = actx.sampleRate * 0.03;
    var buf = actx.createBuffer(1, bufSize, actx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    var src = actx.createBufferSource();
    src.buffer = buf;
    var g = actx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    var f = actx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 8000;
    src.connect(f); f.connect(g); g.connect(masterGain);
    src.start(t);
  }

  function scheduleBass(t, freq, dur) {
    var o = actx.createOscillator();
    var g = actx.createGain();
    var flt = actx.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(300, t);
    flt.frequency.linearRampToValueAtTime(800, t + 0.1);
    flt.frequency.linearRampToValueAtTime(300, t + dur * 0.5);
    g.gain.setValueAtTime(0.18, t);
    g.gain.setValueAtTime(0.18, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(flt); flt.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + dur);
  }

  function scheduleArp(t, freq, dur) {
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.06, t);
    g.gain.setValueAtTime(0.06, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + dur + 0.01);
  }

  function schedulePad(t, freqs, dur) {
    for (var pi = 0; pi < freqs.length; pi++) {
      // Two detuned saws for thickness
      for (var d = -1; d <= 1; d += 2) {
        var o = actx.createOscillator();
        var g = actx.createGain();
        var flt = actx.createBiquadFilter();
        o.type = 'sawtooth';
        o.frequency.value = freqs[pi] + d * 0.8; // slight detune
        flt.type = 'lowpass';
        flt.frequency.value = 1200;
        flt.Q.value = 0.7;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.025, t + 0.4);
        g.gain.setValueAtTime(0.025, t + dur - 0.3);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(flt); flt.connect(g); g.connect(masterGain);
        o.start(t); o.stop(t + dur + 0.01);
      }
    }
  }
})();
