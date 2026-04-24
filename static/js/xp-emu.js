/**
 * XP Emulator — v86 initialization, CRT shader, keyboard, light switch, screen glow
 */
(function() {
  'use strict';

  // ── Configuration ──
  // Change this to your cloud storage URL where xp.img and xp-state.bin are hosted
  const ASSETS_BASE = window.XP_ASSETS_BASE || '';

  // ── State ──
  let emulator = null;
  let crtEnabled = true;
  let glowInterval = null;
  let mouseLocked = false;

  // ── DOM refs ──
  const bootOverlay = document.getElementById('xp-boot-overlay');
  const bootStatus = document.getElementById('boot-status');
  const screenEl = document.getElementById('screen');
  const screenContainer = document.getElementById('screen_container');
  const crtCanvas = document.getElementById('crt-canvas');
  const screenGlow = document.getElementById('screen-glow');
  const keyboardEl = document.getElementById('keyboard');
  const lightSwitch = document.getElementById('light-switch');
  const monitorLed = document.getElementById('monitor-led');

  // ── Keyboard Layout ──
  const KEYBOARD_LAYOUT = [
    // Row 0: Function keys
    [
      { label: 'Esc', code: 1, w: '1-5u' },
      { label: '', w: '1u', dummy: true },
      { label: 'F1', code: 59, w: '1u' },
      { label: 'F2', code: 60, w: '1u' },
      { label: 'F3', code: 61, w: '1u' },
      { label: 'F4', code: 62, w: '1u' },
      { label: '', w: '0-5u', dummy: true },
      { label: 'F5', code: 63, w: '1u' },
      { label: 'F6', code: 64, w: '1u' },
      { label: 'F7', code: 65, w: '1u' },
      { label: 'F8', code: 66, w: '1u' },
      { label: '', w: '0-5u', dummy: true },
      { label: 'F9', code: 67, w: '1u' },
      { label: 'F10', code: 68, w: '1u' },
      { label: 'F11', code: 87, w: '1u' },
      { label: 'F12', code: 88, w: '1u' },
    ],
    // Row 1: Number row
    [
      { label: '`', code: 41, w: '1u' },
      { label: '1', code: 2, w: '1u' },
      { label: '2', code: 3, w: '1u' },
      { label: '3', code: 4, w: '1u' },
      { label: '4', code: 5, w: '1u' },
      { label: '5', code: 6, w: '1u' },
      { label: '6', code: 7, w: '1u' },
      { label: '7', code: 8, w: '1u' },
      { label: '8', code: 9, w: '1u' },
      { label: '9', code: 10, w: '1u' },
      { label: '0', code: 11, w: '1u' },
      { label: '-', code: 12, w: '1u' },
      { label: '=', code: 13, w: '1u' },
      { label: 'Bksp', code: 14, w: '2u', cls: 'dark' },
    ],
    // Row 2: QWERTY
    [
      { label: 'Tab', code: 15, w: '1-5u', cls: 'dark' },
      { label: 'Q', code: 16, w: '1u' },
      { label: 'W', code: 17, w: '1u' },
      { label: 'E', code: 18, w: '1u' },
      { label: 'R', code: 19, w: '1u' },
      { label: 'T', code: 20, w: '1u' },
      { label: 'Y', code: 21, w: '1u' },
      { label: 'U', code: 22, w: '1u' },
      { label: 'I', code: 23, w: '1u' },
      { label: 'O', code: 24, w: '1u' },
      { label: 'P', code: 25, w: '1u' },
      { label: '[', code: 26, w: '1u' },
      { label: ']', code: 27, w: '1u' },
      { label: '\\', code: 43, w: '1-5u' },
    ],
    // Row 3: Home row
    [
      { label: 'Caps', code: 58, w: '1-75u', cls: 'dark' },
      { label: 'A', code: 30, w: '1u' },
      { label: 'S', code: 31, w: '1u' },
      { label: 'D', code: 32, w: '1u' },
      { label: 'F', code: 33, w: '1u' },
      { label: 'G', code: 34, w: '1u' },
      { label: 'H', code: 35, w: '1u' },
      { label: 'J', code: 36, w: '1u' },
      { label: 'K', code: 37, w: '1u' },
      { label: 'L', code: 38, w: '1u' },
      { label: ';', code: 39, w: '1u' },
      { label: "'", code: 40, w: '1u' },
      { label: 'Enter', code: 28, w: '2-25u', cls: 'accent' },
    ],
    // Row 4: Shift row
    [
      { label: 'Shift', code: 42, w: '2-25u', cls: 'dark' },
      { label: 'Z', code: 44, w: '1u' },
      { label: 'X', code: 45, w: '1u' },
      { label: 'C', code: 46, w: '1u' },
      { label: 'V', code: 47, w: '1u' },
      { label: 'B', code: 48, w: '1u' },
      { label: 'N', code: 49, w: '1u' },
      { label: 'M', code: 50, w: '1u' },
      { label: ',', code: 51, w: '1u' },
      { label: '.', code: 52, w: '1u' },
      { label: '/', code: 53, w: '1u' },
      { label: 'Shift', code: 54, w: '2-75u', cls: 'dark' },
    ],
    // Row 5: Bottom row
    [
      { label: 'Ctrl', code: 29, w: '1-5u', cls: 'dark' },
      { label: 'Win', code: 0xE05B, w: '1-25u', cls: 'dark' },
      { label: 'Alt', code: 56, w: '1-25u', cls: 'dark' },
      { label: '', code: 57, w: 'space' },
      { label: 'Alt', code: 0xE038, w: '1-25u', cls: 'dark' },
      { label: 'Win', code: 0xE05C, w: '1-25u', cls: 'dark' },
      { label: 'Menu', code: 0xE05D, w: '1-25u', cls: 'dark' },
      { label: 'Ctrl', code: 0xE01D, w: '1-5u', cls: 'dark' },
    ],
  ];

  // ── Build Keyboard ──
  function buildKeyboard() {
    keyboardEl.innerHTML = '';
    KEYBOARD_LAYOUT.forEach(function(row) {
      var rowEl = document.createElement('div');
      rowEl.className = 'kb-row';
      row.forEach(function(key) {
        var keyEl = document.createElement('div');
        var widthClass = 'key-' + key.w;
        keyEl.className = 'key ' + widthClass;
        if (key.cls) keyEl.classList.add('key-' + key.cls);
        if (key.dummy) {
          keyEl.style.visibility = 'hidden';
          keyEl.style.width = key.w === '0-5u' ? '14px' : undefined;
        }
        keyEl.textContent = key.label;
        if (key.code && !key.dummy) {
          keyEl.dataset.scancode = key.code;
          keyEl.addEventListener('mousedown', function(e) {
            e.preventDefault();
            keyEl.classList.add('pressed');
            sendKey(key.code, true);
          });
          keyEl.addEventListener('mouseup', function() {
            keyEl.classList.remove('pressed');
            sendKey(key.code, false);
          });
          keyEl.addEventListener('mouseleave', function() {
            if (keyEl.classList.contains('pressed')) {
              keyEl.classList.remove('pressed');
              sendKey(key.code, false);
            }
          });
        }
        rowEl.appendChild(keyEl);
      });
      keyboardEl.appendChild(rowEl);
    });
  }

  // ── Send Key to Emulator ──
  function sendKey(scancode, down) {
    if (!emulator) return;
    // Extended scancodes (0xE0xx)
    if (scancode > 0xFF) {
      var ext = scancode & 0xFF;
      if (down) {
        emulator.keyboard_send_scancodes([0xE0, ext]);
      } else {
        emulator.keyboard_send_scancodes([0xE0, ext | 0x80]);
      }
    } else {
      if (down) {
        emulator.keyboard_send_scancodes([scancode]);
      } else {
        emulator.keyboard_send_scancodes([scancode | 0x80]);
      }
    }
  }

  // ── CRT Shader (WebGL) ──
  function initCRTShader() {
    var gl = crtCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) {
      crtEnabled = false;
      return;
    }

    var vsSource = [
      'attribute vec2 a_position;',
      'varying vec2 v_texCoord;',
      'void main() {',
      '  gl_Position = vec4(a_position, 0.0, 1.0);',
      '  v_texCoord = (a_position + 1.0) / 2.0;',
      '  v_texCoord.y = 1.0 - v_texCoord.y;',
      '}',
    ].join('\n');

    var fsSource = [
      'precision mediump float;',
      'varying vec2 v_texCoord;',
      'uniform sampler2D u_texture;',
      'uniform vec2 u_resolution;',
      'uniform float u_curvature;',
      'uniform float u_scanlines;',
      '',
      'vec2 barrelDistort(vec2 uv) {',
      '  vec2 cc = uv - 0.5;',
      '  float dist = dot(cc, cc);',
      '  return uv + cc * dist * u_curvature;',
      '}',
      '',
      'void main() {',
      '  vec2 uv = barrelDistort(v_texCoord);',
      '  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {',
      '    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);',
      '    return;',
      '  }',
      '  vec4 color = texture2D(u_texture, uv);',
      '  // Scanlines',
      '  float scanline = sin(uv.y * u_resolution.y * 3.14159) * 0.5 + 0.5;',
      '  color.rgb *= 1.0 - u_scanlines * (1.0 - scanline);',
      '  // Subtle vignette',
      '  vec2 vig = uv * (1.0 - uv);',
      '  float vigAmount = pow(vig.x * vig.y * 15.0, 0.25);',
      '  color.rgb *= vigAmount;',
      '  gl_FragColor = color;',
      '}',
    ].join('\n');

    function compileShader(type, source) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    var vs = compileShader(gl.VERTEX_SHADER, vsSource);
    var fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) { crtEnabled = false; return; }

    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error');
      crtEnabled = false;
      return;
    }

    gl.useProgram(program);

    // Fullscreen quad
    var verts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    var posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Uniforms
    var uRes = gl.getUniformLocation(program, 'u_resolution');
    var uCurv = gl.getUniformLocation(program, 'u_curvature');
    var uScan = gl.getUniformLocation(program, 'u_scanlines');
    var uTex = gl.getUniformLocation(program, 'u_texture');

    gl.uniform2f(uRes, crtCanvas.width, crtCanvas.height);
    gl.uniform1f(uCurv, -0.02);
    gl.uniform1f(uScan, 0.12);
    gl.uniform1i(uTex, 0);

    // Texture from v86 canvas
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    function renderCRT() {
      if (!crtEnabled) return;
      var v86Canvas = screenContainer.querySelector('canvas');
      if (v86Canvas && v86Canvas.width > 0) {
        crtCanvas.width = v86Canvas.width;
        crtCanvas.height = v86Canvas.height;
        gl.viewport(0, 0, crtCanvas.width, crtCanvas.height);
        gl.uniform2f(uRes, crtCanvas.width, crtCanvas.height);

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v86Canvas);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      requestAnimationFrame(renderCRT);
    }

    requestAnimationFrame(renderCRT);
  }

  // ── Screen Glow ──
  function startScreenGlow() {
    glowInterval = setInterval(function() {
      var v86Canvas = screenContainer.querySelector('canvas');
      if (!v86Canvas || v86Canvas.width === 0) return;

      // Sample at low resolution
      var sample = document.createElement('canvas');
      sample.width = 8;
      sample.height = 8;
      var ctx = sample.getContext('2d');
      ctx.drawImage(v86Canvas, 0, 0, 8, 8);
      var data = ctx.getImageData(0, 0, 8, 8).data;

      var r = 0, g = 0, b = 0, count = 0;
      for (var i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i+1];
        b += data[i+2];
        count++;
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);

      screenGlow.style.boxShadow =
        '0 0 80px 40px rgba(' + r + ',' + g + ',' + b + ', 0.3), ' +
        '0 0 160px 80px rgba(' + r + ',' + g + ',' + b + ', 0.15)';
    }, 500);
  }

  // ── Mouse Capture ──
  function initMouseCapture() {
    // Click on screen area to request pointer lock
    screenEl.addEventListener('click', function() {
      if (!emulator || mouseLocked) return;
      var v86Canvas = screenContainer.querySelector('canvas');
      if (v86Canvas) {
        v86Canvas.requestPointerLock();
      }
    });

    // Also allow clicking CRT overlay to capture
    crtCanvas.addEventListener('click', function() {
      if (!emulator || mouseLocked) return;
      var v86Canvas = screenContainer.querySelector('canvas');
      if (v86Canvas) {
        v86Canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', function() {
      mouseLocked = !!document.pointerLockElement;
      if (mouseLocked) {
        screenEl.classList.add('mouse-captured');
      } else {
        screenEl.classList.remove('mouse-captured');
      }
    });

    // ESC exits pointer lock (browser default), no extra handling needed
  }

  // ── Light Switch ──
  function initLightSwitch() {
    lightSwitch.addEventListener('click', function() {
      document.documentElement.classList.toggle('lights-off');
    });
  }

  // ── Boot Overlay ──
  function updateBootStatus(msg) {
    if (bootStatus) bootStatus.textContent = msg;
  }

  function hideBootOverlay() {
    if (bootOverlay) {
      bootOverlay.classList.add('fade-out');
      setTimeout(function() {
        bootOverlay.style.display = 'none';
      }, 700);
    }
  }

  // ── Initialize Emulator ──
  function initEmulator() {
    if (typeof V86 === 'undefined') {
      updateBootStatus('Error: v86 emulator not loaded');
      return;
    }

    var imgBase = ASSETS_BASE || '';
    var stateUrl = imgBase + '/xp-state.bin';

    // Check if saved state exists
    updateBootStatus('Loading Windows XP...');

    fetch(stateUrl, { method: 'HEAD' })
      .then(function(response) {
        if (!response.ok) throw new Error('No saved state');
        return startWithState(imgBase, stateUrl);
      })
      .catch(function() {
        // No saved state — check for disk image
        var testXhr = new XMLHttpRequest();
        testXhr.open('HEAD', imgBase + '/xp.img', false);
        try {
          testXhr.send();
          if (testXhr.status === 200) {
            startColdBoot(imgBase);
          } else {
            showDemoMode();
          }
        } catch(e) {
          showDemoMode();
        }
      });
  }

  function createEmulator(imgBase, autostart) {
    var config = {
      wasm_path: '/v86/v86.wasm',
      memory_size: 512 * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024,
      screen_container: screenContainer,
      bios: { url: '/v86/seabios.bin' },
      vga_bios: { url: '/v86/vgabios.bin' },
      hda: {
        url: imgBase + '/xp.img',
        async: true,
        size: 2 * 1024 * 1024 * 1024,
      },
      autostart: autostart,
      cpuid_level: 2,
      acpi: false,
    };

    emulator = new V86(config);
    return emulator;
  }

  function startWithState(imgBase, stateUrl) {
    updateBootStatus('Restoring saved state...');
    createEmulator(imgBase, false);

    fetch(stateUrl)
      .then(function(response) { return response.arrayBuffer(); })
      .then(function(state) {
        emulator.restore_state(state);
        emulator.run();
        updateBootStatus('Welcome to Windows XP');
        setTimeout(hideBootOverlay, 800);
        setTimeout(function() {
          initCRTShader();
          startScreenGlow();
        }, 500);
      });
  }

  function startColdBoot(imgBase) {
    updateBootStatus('Booting Windows XP (this may take a minute)...');
    createEmulator(imgBase, true);
    setTimeout(hideBootOverlay, 3000);
    setTimeout(function() {
      initCRTShader();
      startScreenGlow();
    }, 1000);
  }

  // ── Demo Mode (no disk image configured) ──
  function showDemoMode() {
    var canvas = screenContainer.querySelector('canvas');
    if (canvas) {
      canvas.style.display = 'block';
      canvas.width = 800;
      canvas.height = 600;
      var ctx = canvas.getContext('2d');

      // Classic XP "Bliss" wallpaper approximation
      var skyGrad = ctx.createLinearGradient(0, 0, 0, 350);
      skyGrad.addColorStop(0, '#4A90D9');
      skyGrad.addColorStop(0.3, '#6BA4E7');
      skyGrad.addColorStop(0.6, '#89B8F0');
      skyGrad.addColorStop(1, '#A8D4A0');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, 800, 400);

      // Rolling green hills
      var hillGrad = ctx.createLinearGradient(0, 300, 0, 570);
      hillGrad.addColorStop(0, '#5DAA3C');
      hillGrad.addColorStop(0.5, '#4A9A2E');
      hillGrad.addColorStop(1, '#3D8824');
      ctx.fillStyle = hillGrad;
      ctx.beginPath();
      ctx.moveTo(0, 380);
      ctx.bezierCurveTo(200, 320, 350, 400, 500, 350);
      ctx.bezierCurveTo(650, 300, 750, 370, 800, 340);
      ctx.lineTo(800, 570);
      ctx.lineTo(0, 570);
      ctx.closePath();
      ctx.fill();

      // Second hill layer
      var hill2 = ctx.createLinearGradient(0, 380, 0, 570);
      hill2.addColorStop(0, '#4FA832');
      hill2.addColorStop(1, '#3A8520');
      ctx.fillStyle = hill2;
      ctx.beginPath();
      ctx.moveTo(0, 450);
      ctx.bezierCurveTo(100, 410, 300, 460, 450, 420);
      ctx.bezierCurveTo(600, 380, 700, 430, 800, 400);
      ctx.lineTo(800, 570);
      ctx.lineTo(0, 570);
      ctx.closePath();
      ctx.fill();

      // Clouds
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      drawCloud(ctx, 120, 80, 60);
      drawCloud(ctx, 500, 50, 50);
      drawCloud(ctx, 680, 110, 40);

      // Desktop icons
      drawDesktopIcon(ctx, 30, 20, '\uD83D\uDCBB', 'My Computer');
      drawDesktopIcon(ctx, 30, 100, '\uD83D\uDCC1', 'My Documents');
      drawDesktopIcon(ctx, 30, 180, '\uD83C\uDF10', 'Internet Explorer');
      drawDesktopIcon(ctx, 30, 260, '\u267B\uFE0F', 'Recycle Bin');

      // Taskbar
      var taskGrad = ctx.createLinearGradient(0, 570, 0, 600);
      taskGrad.addColorStop(0, '#2456D6');
      taskGrad.addColorStop(0.1, '#3264E0');
      taskGrad.addColorStop(0.9, '#1E48B8');
      taskGrad.addColorStop(1, '#1941A5');
      ctx.fillStyle = taskGrad;
      ctx.fillRect(0, 570, 800, 30);

      // Start button
      var startGrad = ctx.createLinearGradient(0, 572, 0, 598);
      startGrad.addColorStop(0, '#3A9A2F');
      startGrad.addColorStop(0.5, '#2D8823');
      startGrad.addColorStop(1, '#237818');
      ctx.fillStyle = startGrad;
      roundRect(ctx, 2, 572, 100, 26, 4);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px "Segoe UI", Tahoma, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('start', 32, 585);

      // Windows flag in start button (simple colored squares)
      var fx = 10, fy = 578;
      ctx.fillStyle = '#F25022'; ctx.fillRect(fx, fy, 6, 6);
      ctx.fillStyle = '#7FBA00'; ctx.fillRect(fx+7, fy, 6, 6);
      ctx.fillStyle = '#00A4EF'; ctx.fillRect(fx, fy+7, 6, 6);
      ctx.fillStyle = '#FFB900'; ctx.fillRect(fx+7, fy+7, 6, 6);

      // System tray
      ctx.fillStyle = '#0F3AA5';
      ctx.fillRect(720, 570, 80, 30);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '11px "Segoe UI", Tahoma, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      var now = new Date();
      var hours = now.getHours();
      var mins = now.getMinutes();
      ctx.fillText((hours < 10 ? '0' : '') + hours + ':' + (mins < 10 ? '0' : '') + mins, 790, 585);

      // Notepad window with welcome message
      drawNotepadWindow(ctx);

      ctx.textBaseline = 'alphabetic';
    }

    setTimeout(function() {
      initCRTShader();
      startScreenGlow();
    }, 100);

    setTimeout(hideBootOverlay, 1500);
  }

  function drawCloud(ctx, x, y, size) {
    ctx.beginPath();
    ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
    ctx.arc(x + size * 0.4, y - size * 0.2, size * 0.4, 0, Math.PI * 2);
    ctx.arc(x + size * 0.7, y, size * 0.35, 0, Math.PI * 2);
    ctx.arc(x + size * 0.3, y + size * 0.1, size * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDesktopIcon(ctx, x, y, emoji, label) {
    ctx.font = '28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(emoji, x + 24, y + 32);
    ctx.font = '11px "Segoe UI", Tahoma, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.fillText(label, x + 24, y + 52);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawNotepadWindow(ctx) {
    var wx = 200, wy = 120, ww = 440, wh = 300;

    // Window shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, wx + 4, wy + 4, ww, wh, 6);
    ctx.fill();

    // Window body
    ctx.fillStyle = '#ECE9D8';
    roundRect(ctx, wx, wy, ww, wh, 6);
    ctx.fill();
    ctx.strokeStyle = '#0054E3';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Title bar
    var tbGrad = ctx.createLinearGradient(wx, wy, wx, wy + 28);
    tbGrad.addColorStop(0, '#0A246A');
    tbGrad.addColorStop(0.3, '#3A6EA5');
    tbGrad.addColorStop(0.5, '#0A246A');
    tbGrad.addColorStop(1, '#0A246A');
    ctx.fillStyle = tbGrad;
    roundRect(ctx, wx + 1, wy + 1, ww - 2, 26, 5);
    ctx.fill();

    // Title text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px "Segoe UI", Tahoma, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('welcome.txt - Notepad', wx + 8, wy + 18);

    // Window buttons
    var bx = wx + ww - 58;
    ['#ccc', '#ccc', '#D64541'].forEach(function(c, i) {
      ctx.fillStyle = '#ccc';
      roundRect(ctx, bx + i * 18, wy + 5, 16, 16, 2);
      ctx.fill();
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    // X on close button
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx + 39, wy + 9); ctx.lineTo(bx + 49, wy + 17);
    ctx.moveTo(bx + 49, wy + 9); ctx.lineTo(bx + 39, wy + 17);
    ctx.stroke();

    // Menu bar
    ctx.fillStyle = '#ECE9D8';
    ctx.fillRect(wx + 1, wy + 27, ww - 2, 20);
    ctx.fillStyle = '#333';
    ctx.font = '11px "Segoe UI", Tahoma, sans-serif';
    ['File', 'Edit', 'Format', 'View', 'Help'].forEach(function(m, i) {
      ctx.fillText(m, wx + 10 + i * 50, wy + 41);
    });

    // Content area
    ctx.fillStyle = '#fff';
    ctx.fillRect(wx + 4, wy + 48, ww - 8, wh - 52);

    // Text content
    ctx.fillStyle = '#000';
    ctx.font = '13px "Consolas", "Courier New", monospace';
    ctx.textAlign = 'left';
    var text = [
      'Hello! Welcome to my desktop.',
      '',
      "I'm Stan Sobolev — Staff Engineer,",
      'system architect, and mentor.',
      '',
      'This is a Windows XP emulator',
      'running entirely in your browser.',
      '',
      'Feel free to explore!',
      '',
      '> github.com/Jacke',
      '> linkedin.com/in/jacke1',
      '> iamjacke.com',
    ];
    text.forEach(function(line, i) {
      ctx.fillText(line, wx + 12, wy + 68 + i * 18);
    });
  }

  // ── Mobile Detection ──
  function isMobile() {
    return window.innerWidth <= 1100 ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  // ── Init ──
  function init() {
    if (isMobile()) {
      if (bootOverlay) bootOverlay.style.display = 'none';
      return;
    }

    buildKeyboard();
    initLightSwitch();
    initMouseCapture();
    initEmulator();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
