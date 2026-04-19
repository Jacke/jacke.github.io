/**
 * Dark mesh gradient background — WebGL fragment shader.
 *
 * 4 soft blobs of near-black tones that drift slowly. The palette stays
 * within #0d0a07 … #1a1612 so the gradient reads as subtle depth rather
 * than colour. GPU-only, no JS animation loop overhead beyond a single
 * uniform update per frame.
 */
(function () {
  'use strict';
  const c = document.getElementById('mesh-bg');
  if (!c) return;
  const gl = c.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) return;

  const vs = `attribute vec2 a;void main(){gl_Position=vec4(a,0,1);}`;
  const fs = `
precision mediump float;
uniform float t;
uniform vec2 r;

// Smooth noise via sin
float N(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float sn(vec2 p){
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(N(i),N(i+vec2(1,0)),f.x),mix(N(i+vec2(0,1)),N(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
  float v=0.0,a=0.5;
  for(int i=0;i<4;i++){v+=a*sn(p);p*=2.0;a*=0.5;}
  return v;
}

void main(){
  vec2 uv=gl_FragCoord.xy/r;
  float s=t*0.02;

  // 4 drifting blob centers
  vec2 c1=vec2(0.3+sin(s*0.7)*0.2, 0.4+cos(s*0.5)*0.25);
  vec2 c2=vec2(0.7+cos(s*0.6)*0.2, 0.3+sin(s*0.8)*0.2);
  vec2 c3=vec2(0.5+sin(s*0.9)*0.15,0.7+cos(s*0.4)*0.2);
  vec2 c4=vec2(0.2+cos(s*0.5)*0.15,0.8+sin(s*0.7)*0.15);

  // Soft radial falloff per blob
  float d1=1.0-smoothstep(0.0,0.55,length(uv-c1));
  float d2=1.0-smoothstep(0.0,0.50,length(uv-c2));
  float d3=1.0-smoothstep(0.0,0.45,length(uv-c3));
  float d4=1.0-smoothstep(0.0,0.40,length(uv-c4));

  // FBM distortion for organic edges
  float n=fbm(uv*3.0+s*0.3)*0.12;

  // Combine — each blob tints slightly differently within dark range
  // Base: #0d0a07 = rgb(13,10,7)/255 ≈ (0.051, 0.039, 0.027)
  vec3 base=vec3(0.051,0.039,0.027);
  vec3 col=base;
  col+=d1*vec3(0.025,0.020,0.015); // warm dark brown
  col+=d2*vec3(0.015,0.018,0.022); // cool dark blue-grey
  col+=d3*vec3(0.022,0.016,0.012); // amber shadow
  col+=d4*vec3(0.012,0.015,0.020); // slate
  col+=n*vec3(0.008,0.006,0.005);  // noise detail

  // Clamp to stay dark — never brighter than ~#1e1a16
  col=min(col,vec3(0.118,0.102,0.086));

  gl_FragColor=vec4(col,1.0);
}`;

  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('mesh-bg shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  const v = sh(gl.VERTEX_SHADER, vs);
  const f = sh(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return;
  const pg = gl.createProgram();
  gl.attachShader(pg, v);
  gl.attachShader(pg, f);
  gl.linkProgram(pg);
  if (!gl.getProgramParameter(pg, gl.LINK_STATUS)) return;
  gl.useProgram(pg);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const al = gl.getAttribLocation(pg, 'a');
  gl.enableVertexAttribArray(al);
  gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);

  const ut = gl.getUniformLocation(pg, 't');
  const ur = gl.getUniformLocation(pg, 'r');

  let w = 0, h = 0, paused = false;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    gl.viewport(0, 0, c.width, c.height);
    gl.uniform2f(ur, c.width, c.height);
  }
  resize();
  window.addEventListener('resize', resize);

  // Listen for pause state from the main animation
  const obs = new MutationObserver(function () {
    const btn = document.getElementById('pause-trigger');
    paused = btn ? btn.classList.contains('is-paused') : false;
  });
  const btn = document.getElementById('pause-trigger');
  if (btn) obs.observe(btn, { attributes: true, attributeFilter: ['class'] });

  let time = 0, last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!paused) {
      const dt = last ? (now - last) / 1000 : 0.016;
      time += dt;
    }
    last = now;
    gl.uniform1f(ut, time);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  requestAnimationFrame(frame);
})();
