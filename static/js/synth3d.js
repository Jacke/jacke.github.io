/**
 * Synthwave 3D scene — complete Three.js renderer.
 * Sky, sun, grid floor, road, DeLorean, tank, drones, particles, effects.
 * No 2D canvas — this is the only visual layer.
 */
import * as THREE from 'https://esm.sh/three@0.170.0?bundle';
import { GLTFLoader } from 'https://esm.sh/three@0.170.0/addons/loaders/GLTFLoader.js?bundle';
import { DRACOLoader } from 'https://esm.sh/three@0.170.0/addons/loaders/DRACOLoader.js?bundle';

let W = window.innerWidth, H = window.innerHeight;

// ═══════════════════════════════════════════
// SCENE + CAMERA + RENDERER
// ═══════════════════════════════════════════
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);
camera.position.set(0, 9, 14);
camera.lookAt(0, 0, -2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;
renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:1';
document.body.appendChild(renderer.domElement);
console.log('[synth3d] renderer attached');

// Bloom
// No bloom — direct render (faster load, no extra deps)

// ═══════════════════════════════════════════
// SKY (gradient background texture)
// ═══════════════════════════════════════════
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 512;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#020008');
  gr.addColorStop(0.3, '#08001a');
  gr.addColorStop(0.55, '#1a0038');
  gr.addColorStop(0.75, '#3d0058');
  gr.addColorStop(0.9, '#70003a');
  gr.addColorStop(1, '#0a0015');
  g.fillStyle = gr;
  g.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  return tex;
}
scene.background = makeSkyTexture();

// ═══════════════════════════════════════════
// LIGHTING
// ═══════════════════════════════════════════
// Synthwave lighting — bright, neon-saturated
scene.add(new THREE.AmbientLight(0x6644ff, 2.0)); // stronger purple ambient
scene.add(new THREE.HemisphereLight(0x4400cc, 0x220044, 1.5)); // vivid sky/ground
const sunLight = new THREE.DirectionalLight(0xff6688, 3.0); // warm pink sun
sunLight.position.set(0, 10, -20);
scene.add(sunLight);
const fillLight = new THREE.DirectionalLight(0x8888ff, 1.5); // cool fill
fillLight.position.set(-5, 5, 8);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xff00b4, 2.0); // hot magenta rim
rimLight.position.set(3, 2, -5);
scene.add(rimLight);
// Extra: cyan uplight from ground (reflects off everything)
const groundUp = new THREE.DirectionalLight(0x00ccff, 0.8);
groundUp.position.set(0, -3, 0);
scene.add(groundUp);

// ═══════════════════════════════════════════
// SUN (disc with horizontal stripe cutouts)
// ═══════════════════════════════════════════
const sunMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { pulse: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vUv;
    uniform float pulse;
    void main(){
      vec2 c=vUv-0.5;
      float r=length(c);
      if(r>0.5) discard;
      // Horizontal stripes (8 bands, thicker toward bottom)
      float y=vUv.y;
      float band=fract(y*9.0);
      float thickness=0.05+y*0.25;
      if(band<thickness && y<0.7) discard;
      // Radial gradient
      float g=1.0-smoothstep(0.0,0.5,r);
      vec3 col=mix(vec3(0.55,0.06,0.25), vec3(1.0,0.3,0.5), g);
      float alpha=g*(0.85+pulse*0.15);
      gl_FragColor=vec4(col,alpha);
    }`
});
const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), sunMat);
sunMesh.position.set(0, 6, -80);
scene.add(sunMesh);

// Sun glow (large soft sprite behind)
const glowMat = new THREE.SpriteMaterial({
  color: 0xff0066,
  transparent: true, opacity: 0.12,
  blending: THREE.AdditiveBlending
});
const sunGlow = new THREE.Sprite(glowMat);
sunGlow.position.set(0, 6, -81);
sunGlow.scale.set(80, 80, 1);
scene.add(sunGlow);

// ═══════════════════════════════════════════
// STARS (Points)
// ═══════════════════════════════════════════
const starCount = 300;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  starPos[i * 3] = (Math.random() - 0.5) * 200;
  starPos[i * 3 + 1] = Math.random() * 40 + 5;
  starPos[i * 3 + 2] = -Math.random() * 150 - 20;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.6 });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

// ═══════════════════════════════════════════
// GROUND — canvas-textured grid (reliable)
// ═══════════════════════════════════════════
const GRID_TEX_SIZE = 512;
const gridCanvas = document.createElement('canvas');
gridCanvas.width = GRID_TEX_SIZE;
gridCanvas.height = GRID_TEX_SIZE;
const gx = gridCanvas.getContext('2d');

function drawGridTexture() {
  gx.fillStyle = '#0c0016';
  gx.fillRect(0, 0, GRID_TEX_SIZE, GRID_TEX_SIZE);
  const cellsX = 20, cellsY = 20;
  const cw = GRID_TEX_SIZE / cellsX, ch = GRID_TEX_SIZE / cellsY;
  // Horizontal lines (bright magenta)
  gx.strokeStyle = '#ff00cc';
  gx.lineWidth = 2;
  gx.globalAlpha = 0.55;
  for (let i = 0; i <= cellsY; i++) {
    gx.beginPath(); gx.moveTo(0, i * ch); gx.lineTo(GRID_TEX_SIZE, i * ch); gx.stroke();
  }
  // Vertical lines (bright cyan)
  gx.strokeStyle = '#00ddff';
  gx.lineWidth = 2;
  gx.globalAlpha = 0.45;
  for (let i = 0; i <= cellsX; i++) {
    gx.beginPath(); gx.moveTo(i * cw, 0); gx.lineTo(i * cw, GRID_TEX_SIZE); gx.stroke();
  }
  gx.globalAlpha = 1;
}
drawGridTexture();

const gridTex = new THREE.CanvasTexture(gridCanvas);
gridTex.wrapS = THREE.RepeatWrapping;
gridTex.wrapT = THREE.RepeatWrapping;
gridTex.repeat.set(8, 8);

const groundMat = new THREE.MeshBasicMaterial({ map: gridTex, side: THREE.DoubleSide });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
scene.add(ground);

// Road surface (darker strip)
const roadMat = new THREE.MeshBasicMaterial({ color: 0x0e0020, side: THREE.DoubleSide }); // lighter road
const road = new THREE.Mesh(new THREE.PlaneGeometry(12, 300), roadMat);
road.rotation.x = -Math.PI / 2;
road.position.y = -0.01;
scene.add(road);

// Road neon edges — BRIGHTER, wider
const edgeMat = new THREE.MeshBasicMaterial({ color: 0xff22cc });
const edgeL = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 300), edgeMat);
edgeL.rotation.x = -Math.PI / 2; edgeL.position.set(-6, 0.005, 0); scene.add(edgeL);
const edgeR = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 300), edgeMat);
edgeR.rotation.x = -Math.PI / 2; edgeR.position.set(6, 0.005, 0); scene.add(edgeR);
// Second inner edge lines (cyan)
const innerEdgeMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.4 });
const innerL = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 300), innerEdgeMat);
innerL.rotation.x = -Math.PI / 2; innerL.position.set(-4, 0.005, 0); scene.add(innerL);
const innerR = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 300), innerEdgeMat);
innerR.rotation.x = -Math.PI / 2; innerR.position.set(4, 0.005, 0); scene.add(innerR);

// Center dashes (thin white line)
const centerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 });
const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 300), centerMat);
centerLine.rotation.x = -Math.PI / 2; centerLine.position.y = 0; scene.add(centerLine);

// ═══════════════════════════════════════════
// BUILDINGS (Outrun-style silhouettes along road)
// ═══════════════════════════════════════════
const buildings = [];
const buildingMats = [
  new THREE.MeshStandardMaterial({ color: 0x1a0030, emissive: 0x0a0018, emissiveIntensity: 0.3, metalness: 0.3, roughness: 0.8 }),
  new THREE.MeshStandardMaterial({ color: 0x200038, emissive: 0x0c001e, emissiveIntensity: 0.3, metalness: 0.3, roughness: 0.8 }),
  new THREE.MeshStandardMaterial({ color: 0x150028, emissive: 0x080014, emissiveIntensity: 0.3, metalness: 0.3, roughness: 0.8 }),
];
for (let i = 0; i < 40; i++) {
  const side = i < 20 ? -1 : 1;
  const idx = i % 20;
  const w = 2 + Math.random() * 4;
  const h = 3 + Math.random() * 12;
  const d = 3 + Math.random() * 5;
  const geo = new THREE.BoxGeometry(w, h, d);
  const bld = new THREE.Mesh(geo, buildingMats[i % 3]);
  const x = side * (9 + Math.random() * 8);
  const z = -idx * 14 - Math.random() * 6;
  bld.position.set(x, h / 2, z);
  scene.add(bld);
  buildings.push(bld);
  // Random lit windows
  if (Math.random() > 0.4) {
    const winCount = Math.floor(Math.random() * 4) + 1;
    for (let wi = 0; wi < winCount; wi++) {
      const win = new THREE.Mesh(
        new THREE.PlaneGeometry(0.4, 0.3),
        new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.4 + Math.random() * 0.4 })
      );
      win.position.set(
        side > 0 ? -w / 2 - 0.01 : w / 2 + 0.01,
        -h / 2 + 1 + wi * 1.5 + Math.random(),
        (Math.random() - 0.5) * d * 0.6
      );
      win.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      bld.add(win);
    }
  }
}

// ═══════════════════════════════════════════
// SIDE BARRIERS (neon fence posts)
// ═══════════════════════════════════════════
const barrierPosts = [];
const barrierMat = new THREE.MeshBasicMaterial({ color: 0xff00b4 });
const barrierTopMat = new THREE.MeshBasicMaterial({ color: 0xff00b4, transparent: true, opacity: 0.8 });
for (let i = 0; i < 40; i++) {
  const side = i < 20 ? -1 : 1;
  const idx = i % 20;
  // Post
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), barrierMat);
  post.position.set(side * 7, 0.6, -idx * 12);
  scene.add(post);
  barrierPosts.push(post);
  // Glowing top
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), barrierTopMat);
  top.position.y = 0.65;
  post.add(top);
}
// Horizontal neon rail (long thin boxes connecting posts)
[-7, 7].forEach(x => {
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.03, 240),
    new THREE.MeshBasicMaterial({ color: 0xff00b4, transparent: true, opacity: 0.3 })
  );
  rail.position.set(x, 1.0, -110);
  scene.add(rail);
});

// ═══════════════════════════════════════════
// RAIN PARTICLES
// ═══════════════════════════════════════════
const RAIN_COUNT = 600;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_COUNT * 3);
const rainVel = new Float32Array(RAIN_COUNT); // fall speed
for (let i = 0; i < RAIN_COUNT; i++) {
  rainPos[i * 3] = (Math.random() - 0.5) * 40;
  rainPos[i * 3 + 1] = Math.random() * 20;
  rainPos[i * 3 + 2] = Math.random() * 40 - 30;
  rainVel[i] = 0.2 + Math.random() * 0.3;
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.PointsMaterial({
  color: 0x8888cc, size: 0.05, transparent: true, opacity: 0
});
const rain = new THREE.Points(rainGeo, rainMat);
scene.add(rain);
let rainIntensity = 0; // 0 = off, 1 = full rain

// ═══════════════════════════════════════════
// DEBUG MODE (toggle with `)
// ═══════════════════════════════════════════
let debugMode = false;
const debugDiv = document.createElement('div');
debugDiv.style.cssText = 'position:fixed;top:40px;left:10px;z-index:999;font:11px monospace;color:#0f0;background:rgba(0,0,0,0.7);padding:8px;display:none;white-space:pre;pointer-events:none';
document.body.appendChild(debugDiv);
// Debug wireframe for car hitbox
const debugBox = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true })
);
debugBox.visible = false;
scene.add(debugBox);

window.addEventListener('keydown', e => {
  if (e.key === '`' || e.key === '~') {
    debugMode = !debugMode;
    debugDiv.style.display = debugMode ? 'block' : 'none';
    debugBox.visible = debugMode;
  }
});

// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// ROAD TRACK (segment-based — OutRun style)
// ═══════════════════════════════════════════
const TRACK = [];
const SEG_LEN = 5; // meters per segment

function easeIn(a, b, t) { return a + (b - a) * t * t; }
function easeOut(a, b, t) { return a + (b - a) * (1 - (1 - t) * (1 - t)); }
function easeInOut(a, b, t) { return a + (b - a) * (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)); }

function addSeg(curve, y, width) {
  TRACK.push({ curve: curve || 0, y: y || 0, width: width || 1.0 });
}
function addStraight(n, w) { for (let i = 0; i < n; i++) addSeg(0, 0, w); }
function addCurve(enter, hold, leave, curve, w) {
  for (let i = 0; i < enter; i++) addSeg(easeIn(0, curve, i / enter), 0, w);
  for (let i = 0; i < hold; i++) addSeg(curve, 0, w);
  for (let i = 0; i < leave; i++) addSeg(easeInOut(curve, 0, i / leave), 0, w);
}
function addHill(enter, hold, leave, height, w) {
  for (let i = 0; i < enter; i++) addSeg(0, easeIn(0, height, i / enter), w);
  for (let i = 0; i < hold; i++) addSeg(0, height, w);
  for (let i = 0; i < leave; i++) addSeg(0, easeInOut(height, 0, i / leave), w);
}
function addCurveHill(enter, hold, leave, curve, height, w) {
  for (let i = 0; i < enter; i++) addSeg(easeIn(0, curve, i / enter), easeIn(0, height, i / enter), w);
  for (let i = 0; i < hold; i++) addSeg(curve, height, w);
  for (let i = 0; i < leave; i++) addSeg(easeInOut(curve, 0, i / leave), easeInOut(height, 0, i / leave), w);
}

// Build Moscow → London track
function buildTrack() {
  // Zone 0: Russia (200 segs) — long straights, barely curves
  addStraight(40);
  addCurve(10, 30, 10, 0.3);
  addStraight(30);
  addCurve(10, 20, 10, -0.2);
  addStraight(40);

  // Zone 1: Eastern Europe (200 segs) — rolling hills, medium curves
  addCurve(15, 20, 15, 0.5);
  addHill(15, 10, 15, 1.5);
  addCurve(10, 15, 10, -0.6);
  addHill(10, 15, 10, -1.0);
  addStraight(15);
  addCurveHill(15, 15, 15, 0.4, 1.0);
  addCurve(10, 10, 10, -0.3);
  addHill(10, 10, 10, 0.8);

  // Zone 2: Central Europe (200 segs) — mountain pass, tight, narrow
  addCurveHill(10, 20, 10, 0.8, 2.0, 0.8);
  addCurveHill(10, 15, 10, -0.9, 1.5, 0.8);
  addHill(10, 10, 10, 2.5, 0.75);
  addCurve(8, 20, 8, 1.0, 0.8);
  addCurveHill(10, 10, 10, -0.7, -1.5, 0.8);
  addCurve(8, 15, 8, 0.6, 0.85);
  addHill(10, 15, 10, -2.0, 0.8);

  // Zone 3: Western Europe (200 segs) — sweeping fast curves, gentle
  addCurve(20, 30, 20, -0.4);
  addHill(15, 10, 15, 0.8);
  addCurve(15, 25, 15, 0.5);
  addStraight(20);
  addCurve(15, 20, 15, -0.3);
  addHill(10, 10, 10, -0.5);

  // Zone 4: London (200 segs) — S-curves then straighten
  addCurve(10, 15, 10, 0.6);
  addCurve(10, 15, 10, -0.6);
  addCurve(10, 10, 10, 0.4);
  addCurve(10, 10, 10, -0.4);
  addStraight(20);
  addHill(10, 5, 10, -0.3);
  addStraight(60); // final straight to London
}
buildTrack();
const TRACK_LEN = TRACK.length;

// Get segment at position (looping)
function getSegment(pos) {
  const idx = Math.floor(pos / SEG_LEN) % TRACK_LEN;
  return TRACK[idx >= 0 ? idx : 0];
}

// Accumulated curve over N segments ahead (for visual offset)
function getAccumulatedCurve(pos, count) {
  let acc = 0;
  const startIdx = Math.floor(pos / SEG_LEN);
  for (let i = 0; i < count; i++) {
    const seg = TRACK[(startIdx + i) % TRACK_LEN];
    acc += seg ? seg.curve : 0;
  }
  return acc;
}

// Export for index.html
export function getTrackLength() { return TRACK_LEN * SEG_LEN; }

// PALM TREES (synthwave classic)
const palmTrunkMat = new THREE.MeshBasicMaterial({ color: 0x1a0a00 });
const palmLeafMat = new THREE.MeshBasicMaterial({ color: 0x002a08, side: THREE.DoubleSide });
const palms = [];
for (let i = 0; i < 16; i++) {
  const side = i < 8 ? -1 : 1;
  const idx = i % 8;
  const pg = new THREE.Group();
  // Trunk (tapered cylinder, slight curve)
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 6, 6), palmTrunkMat);
  trunk.position.y = 3; trunk.rotation.z = side * 0.08;
  pg.add(trunk);
  // Leaves (6 flat planes radiating from top)
  for (let lf = 0; lf < 6; lf++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.6), palmLeafMat);
    leaf.position.set(0, 6.2, 0);
    leaf.rotation.y = lf * Math.PI / 3;
    leaf.rotation.x = 0.5 + Math.random() * 0.3;
    pg.add(leaf);
  }
  pg.position.set(side * (11 + Math.random() * 4), 0, -idx * 30 - Math.random() * 10);
  scene.add(pg);
  palms.push(pg);
}

// LAMP POSTS (neon road lights)
const lampMat = new THREE.MeshBasicMaterial({ color: 0x222233 });
const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xff00b4 });
const lamps = [];
for (let i = 0; i < 20; i++) {
  const side = i < 10 ? -1 : 1;
  const idx = i % 10;
  const lg = new THREE.Group();
  // Pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4, 6), lampMat);
  pole.position.y = 2;
  lg.add(pole);
  // Arm
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.04), lampMat);
  arm.position.set(side * -0.75, 4, 0);
  lg.add(arm);
  // Light bulb
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), lampGlowMat);
  bulb.position.set(side * -1.5, 3.9, 0);
  lg.add(bulb);
  // Point light (warm neon)
  const ll = new THREE.PointLight(0xff44aa, 0.8, 6);
  ll.position.set(side * -1.5, 3.8, 0);
  lg.add(ll);
  lg.position.set(side * 7.5, 0, -idx * 24 - 5);
  scene.add(lg);
  lamps.push(lg);
}

// TIRE MARKS (flat quads on ground, spawned during drift)
const TIRE_MARK_MAX = 60;
const tireMarkGeo = new THREE.PlaneGeometry(0.15, 0.8);
const tireMarkMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
const tireMarks = [];
let tireMarkIdx = 0;
for (let i = 0; i < TIRE_MARK_MAX; i++) {
  const tm = new THREE.Mesh(tireMarkGeo, tireMarkMat.clone());
  tm.rotation.x = -Math.PI / 2;
  tm.position.y = 0.005;
  tm.visible = false;
  scene.add(tm);
  tireMarks.push(tm);
}

// EXHAUST FLAME PARTICLES (behind car at high speed)
const EXHAUST_COUNT = 30;
const exhaustGeo = new THREE.BufferGeometry();
const exhaustPos = new Float32Array(EXHAUST_COUNT * 3);
exhaustGeo.setAttribute('position', new THREE.BufferAttribute(exhaustPos, 3));
const exhaustMat = new THREE.PointsMaterial({
  color: 0x4488ff, size: 0.15, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
});
const exhaustPts = new THREE.Points(exhaustGeo, exhaustMat);
scene.add(exhaustPts);

// MATERIALS
// ═══════════════════════════════════════════
// Helper: create mesh and position it
function m(geo, mat2, x, y, z, rx, ry, rz) {
  const mesh = new THREE.Mesh(geo, mat2);
  if (x !== undefined) mesh.position.set(x, y || 0, z || 0);
  if (rx) mesh.rotation.x = rx;
  if (ry) mesh.rotation.y = ry;
  if (rz) mesh.rotation.z = rz;
  return mesh;
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, metalness: opts.m ?? 0.5, roughness: opts.r ?? 0.4,
    emissive: opts.e ?? 0x000000, emissiveIntensity: opts.ei ?? 0,
    transparent: opts.t ?? false, opacity: opts.o ?? 1
  });
}
const M = {
  steel: mat(0xbbbbdd, { m: 0.95, r: 0.2 }),
  dark: mat(0x181820, { m: 0.4, r: 0.7 }),
  glass: mat(0x2244aa, { m: 0.2, r: 0.05, t: true, o: 0.4 }),
  tire: mat(0x0a0a0a, { m: 0.05, r: 0.95 }),
  rim: mat(0x888899, { m: 0.98, r: 0.1 }),
  tail: mat(0xff0030, { e: 0xff0020, ei: 5 }),
  head: mat(0xffffcc, { e: 0xffffaa, ei: 8 }),
  neonC: mat(0x00ffff, { e: 0x00ddff, ei: 6, t: true, o: 0.7 }),
  khaki: mat(0x4a5a2a, { m: 0.25, r: 0.75 }),
  khakiD: mat(0x2a3518, { m: 0.3, r: 0.7 }),
  carbon: mat(0x222228, { m: 0.35, r: 0.55 }),
};

// ═══════════════════════════════════════════
// DELOREAN DMC-12
// ═══════════════════════════════════════════
function buildDeLorean() {
  const g = new THREE.Group();
  // Body (extruded wedge)
  const pts = [[-1.05,0.3],[-1.1,0.5],[-1.1,0.85],[-0.95,1.15],[-0.7,1.38],[-0.5,1.42],
    [0.5,1.42],[0.7,1.38],[0.95,1.15],[1.1,0.85],[1.1,0.5],[1.05,0.3]].map(p=>new THREE.Vector2(p[0],p[1]));
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(pts),{depth:2.2,bevelEnabled:true,bevelSize:0.02,bevelThickness:0.02}), M.steel);
  body.position.z = -1.1; g.add(body);
  // Bumpers
  g.add((()=>{const _m=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.2,0.12),M.dark);_m.position.set(0,0.35,-1.15);return _m})());
  g.add((()=>{const _m=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.2,0.12),M.dark);_m.position.set(0,0.35,1.15);return _m})());
  // Windows
  const ws=new THREE.Mesh(new THREE.PlaneGeometry(1.6,0.65),M.glass);ws.position.set(0,1.35,-0.4);ws.rotation.x=0.55;g.add(ws);
  const rw=new THREE.Mesh(new THREE.PlaneGeometry(1.4,0.5),M.glass);rw.position.set(0,1.28,0.65);rw.rotation.x=-0.35;g.add(rw);
  [-1.12,1.12].forEach(x=>{const s=new THREE.Mesh(new THREE.PlaneGeometry(1,0.4),M.glass);s.position.set(x,1.2,0.1);s.rotation.y=x>0?Math.PI/2:-Math.PI/2;g.add(s)});
  // Door seams
  [-1.11,1.11].forEach(x=>g.add((()=>{const _m=new THREE.Mesh(new THREE.BoxGeometry(0.005,0.9,1.5),M.dark);_m.position.set(x,0.85,0);return _m})()));
  // Louvers
  for(let i=0;i<7;i++){const s=new THREE.Mesh(new THREE.BoxGeometry(1.4,0.015,0.04),M.dark);s.position.set(0,1+i*0.04,0.85+i*0.02);s.rotation.x=-0.2;g.add(s)}
  // Wheels
  function whl(x,z){const wg=new THREE.Group();
    wg.add(new THREE.Mesh(new THREE.TorusGeometry(0.28,0.1,8,24),M.tire));
    wg.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.2,0.08,12),M.rim));
    for(let s=0;s<5;s++){const sp=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.09,0.18),M.rim);sp.rotation.x=s*Math.PI*2/5;wg.add(sp)}
    wg.rotation.x=Math.PI/2;wg.position.set(x,0.28,z);return wg}
  const wheels=[whl(-1,-0.65),whl(1,-0.65),whl(-1,0.7),whl(1,0.7)];
  wheels.forEach(w=>g.add(w)); g.userData.wheels=wheels;
  // Tail lights
  [-0.75,0.75].forEach(x=>{g.add((()=>{const _m=new THREE.Mesh(new THREE.BoxGeometry(0.35,0.08,0.03),M.tail);_m.position.set(x,0.65,1.12);return _m})());
    const gl=new THREE.PointLight(0xff0030,1.5,3);gl.position.set(x,0.65,1.2);g.add(gl)});
  // Headlights
  [-0.7,0.7].forEach(x=>{g.add((()=>{const _m=new THREE.Mesh(new THREE.SphereGeometry(0.09,8,8),M.head);_m.position.set(x,0.7,-1.12);return _m})());
    const sl=new THREE.SpotLight(0xffffaa,5,15,0.4,0.5);sl.position.set(x,0.7,-1.2);sl.target.position.set(x,0,-10);g.add(sl);g.add(sl.target)});
  // Underglow
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.8,0.015,2),M.neonC));
  const ugL=new THREE.PointLight(0x00c8ff,3,5);ugL.position.set(0,0.05,0);g.add(ugL);g.userData.ugLight=ugL;
  [-1.12,1.12].forEach(x=>g.add((()=>{const _m=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.02,1.8),M.neonC);_m.position.set(x,0.08,0);return _m})()));
  // Exhaust
  [-0.35,0.35].forEach(x=>{const e=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.05,0.12,8),M.rim);e.rotation.x=Math.PI/2;e.position.set(x,0.22,1.16);g.add(e)});
  // Plate
  const pc=document.createElement('canvas');pc.width=128;pc.height=32;
  const px=pc.getContext('2d');px.fillStyle='#e8e0d0';px.fillRect(0,0,128,32);
  px.font='bold 18px Impact';px.fillStyle='#223';px.textAlign='center';px.fillText('OUTATIME',64,22);
  const plM=new THREE.Mesh(new THREE.PlaneGeometry(0.4,0.1),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(pc)}));plM.position.set(0,0.4,1.13);g.add(plM);
  g.scale.set(1.1,1.1,1.1);
  g.rotation.y = 0; // camera is behind, we see the rear
  return g;
}

// ═══════════════════════════════════════════
// TANK T-72
// ═══════════════════════════════════════════
function buildTank() {
  const g = new THREE.Group();
  const km = mat(0x5a6a3a, { m: 0.25, r: 0.75, e: 0x2a3518, ei: 0.4 });
  const kd = mat(0x3a4520, { m: 0.3, r: 0.7, e: 0x1a2510, ei: 0.35 });
  const tm = mat(0x151515, { m: 0.3, r: 0.9, e: 0x0a0a0a, ei: 0.2 });
  const wm = mat(0x3a3a3a, { m: 0.8, r: 0.3, e: 0x1a1a1a, ei: 0.2 });
  const eraMat = mat(0x667744, { m: 0.2, r: 0.7, e: 0x334422, ei: 0.3 });

  // ── Hull (custom BufferGeometry — proper T-72 wedge shape)
  const hullVerts = new Float32Array([
    // Bottom face (flat)
    -1.4,0.4,-2, 1.4,0.4,-2, 1.4,0.4,2, -1.4,0.4,2,
    // Top face (slopes down at front)
    -1.3,1.0,-1.2, 1.3,1.0,-1.2, 1.3,1.0,1.6, -1.3,1.0,1.6,
    // Front glacis top edge
    -1.2,0.85,-2.1, 1.2,0.85,-2.1,
    // Front lower edge
    -1.3,0.5,-2.3, 1.3,0.5,-2.3,
  ]);
  const hullIdx = new Uint16Array([
    // Bottom
    0,1,2, 0,2,3,
    // Top
    4,6,5, 4,7,6,
    // Left side
    0,4,8, 0,3,7, 3,7,4, 3,4,0, 0,8,10,
    // Right side
    1,9,5, 1,11,9, 2,6,5, 2,5,1, 1,5,9,
    // Front glacis (angled)
    8,9,5, 8,5,4, 10,11,9, 10,9,8,
    // Front lower
    0,10,11, 0,11,1,
    // Rear
    3,2,6, 3,6,7,
  ]);
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.BufferAttribute(hullVerts, 3));
  hullGeo.setIndex(new THREE.BufferAttribute(hullIdx, 1));
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, km);
  g.add(hull);
  // Flat upper deck plate
  const upperHull = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 3.0), km);
  upperHull.position.set(0, 1.02, 0.1); g.add(upperHull);
  // Engine deck (rear, louvered)
  const edeck = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.18, 1.0), kd);
  edeck.position.set(0, 0.95, 1.5); g.add(edeck);
  // Engine grilles
  for (let eg = 0; eg < 3; eg++) {
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.08), mat(0x222222, { m: 0.5, r: 0.5 }));
    grille.position.set(-0.7 + eg * 0.7, 1.05, 1.5); g.add(grille);
  }
  // Exhaust pipes (rear)
  [-0.8, 0.8].forEach(x => {
    const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), mat(0x333333, { m: 0.6, r: 0.5 }));
    exh.rotation.x = Math.PI / 2; exh.position.set(x, 0.75, 2.1); g.add(exh);
  });

  // ── Fenders/side skirts
  [-1.42, 1.42].forEach(x => {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 4.0), km);
    skirt.position.set(x, 0.55, 0); g.add(skirt);
    // Mud flap
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.5), kd);
    flap.position.set(x, 0.35, 2.0); g.add(flap);
  });

  // ── Track assemblies (highly detailed) ──
  const rubberMat = mat(0x1a1a18, { m: 0.05, r: 0.95, e: 0x080808, ei: 0.1 });
  const hubMat = mat(0x555555, { m: 0.9, r: 0.15, e: 0x222222, ei: 0.2 });
  const armMat = mat(0x3a3a3a, { m: 0.5, r: 0.6 });

  [-1.55, 1.55].forEach(x => {
    const sign = x > 0 ? 1 : -1;
    // Track skirt (outer shell)
    const skirtOuter = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 4.5), tm);
    skirtOuter.position.set(x + sign * 0.2, 0.3, 0); g.add(skirtOuter);
    // Track inner wall
    const skirtInner = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 4.5), tm);
    skirtInner.position.set(x - sign * 0.15, 0.3, 0); g.add(skirtInner);
    // Track pad (bottom, ground contact)
    const trackPad = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 4.5), rubberMat);
    trackPad.position.set(x, 0.06, 0); g.add(trackPad);
    // Track top run (upper return)
    const trackTop = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 3.6), rubberMat);
    trackTop.position.set(x, 0.58, -0.1); g.add(trackTop);

    // Drive sprocket (rear, toothed)
    const sprocketHub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.18, 16), hubMat);
    sprocketHub.rotation.z = Math.PI / 2; sprocketHub.position.set(x, 0.35, 2.0); g.add(sprocketHub);
    const sprocketRing = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 8, 16), wm);
    sprocketRing.rotation.y = Math.PI / 2; sprocketRing.position.set(x, 0.35, 2.0); g.add(sprocketRing);
    // Sprocket teeth
    for (let st = 0; st < 12; st++) {
      const a = st * Math.PI * 2 / 12;
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.04), wm);
      tooth.position.set(x, 0.35 + Math.sin(a) * 0.28, 2.0 + Math.cos(a) * 0.28);
      g.add(tooth);
    }

    // Idler wheel (front, with tension adjuster)
    const idlerHub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.18, 14), hubMat);
    idlerHub.rotation.z = Math.PI / 2; idlerHub.position.set(x, 0.3, -2.05); g.add(idlerHub);
    const idlerRim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.04, 8, 16), wm);
    idlerRim.rotation.y = Math.PI / 2; idlerRim.position.set(x, 0.3, -2.05); g.add(idlerRim);
    const idlerRubber = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.06, 8, 20), rubberMat);
    idlerRubber.rotation.y = Math.PI / 2; idlerRubber.position.set(x, 0.3, -2.05); g.add(idlerRubber);

    // Road wheels (6) with rubber tires + suspension arms
    for (let w = 0; w < 6; w++) {
      const wz = -1.5 + w * 0.58;
      // Suspension arm (torsion bar stub)
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.08), armMat);
      arm.position.set(x - sign * 0.1, 0.4, wz); arm.rotation.z = sign * 0.15; g.add(arm);
      // Wheel hub
      const wHub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 12), hubMat);
      wHub.rotation.z = Math.PI / 2; wHub.position.set(x, 0.25, wz); g.add(wHub);
      // Wheel rim (with spokes)
      const wRim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14), wm);
      wRim.rotation.z = Math.PI / 2; wRim.position.set(x, 0.25, wz); g.add(wRim);
      // Rubber tire
      const wTire = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.055, 8, 20), rubberMat);
      wTire.rotation.y = Math.PI / 2; wTire.position.set(x, 0.25, wz); g.add(wTire);
      // Hub cap (center detail)
      const wCap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.22, 6), mat(0x666666, { m: 0.95, r: 0.1 }));
      wCap.rotation.z = Math.PI / 2; wCap.position.set(x, 0.25, wz); g.add(wCap);
    }

    // Return rollers (4 small, on top)
    for (let r = 0; r < 4; r++) {
      const rz = -1.3 + r * 0.9;
      const rWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8), wm);
      rWheel.rotation.z = Math.PI / 2; rWheel.position.set(x, 0.62, rz); g.add(rWheel);
      // Roller bracket
      const rBracket = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.06), armMat);
      rBracket.position.set(x - sign * 0.08, 0.62, rz); g.add(rBracket);
    }

    // Fender / track guard (thin plate over track)
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 4.2), km);
    guard.position.set(x, 0.64, 0); g.add(guard);
    // Guard support brackets
    for (let gb = 0; gb < 6; gb++) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), wm);
      bracket.position.set(x - sign * 0.18, 0.62, -1.8 + gb * 0.72); g.add(bracket);
    }
  });

  // ── ERA blocks (rows on glacis + turret)
  for (let i = 0; i < 6; i++) {
    const era = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.3), eraMat);
    era.position.set(-1.0 + i * 0.4, 0.98, -1.0); g.add(era);
  }
  // ERA on turret front
  for (let i = 0; i < 4; i++) {
    const era = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.14, 0.25), eraMat);
    era.position.set(-0.5 + i * 0.35, 0.15, -1.2);
    // These are children of turretGroup, added below
  }

  // ── Turret assembly
  const turretGroup = new THREE.Group();
  turretGroup.position.set(0, 1.08, 0.1);
  // Turret base ring
  const baseRing = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, 0.1, 24), kd);
  turretGroup.add(baseRing);
  // Turret (LatheGeometry — proper T-72 rounded profile)
  const turretProfile = [
    new THREE.Vector2(0, 0),       // center bottom
    new THREE.Vector2(1.05, 0),    // base edge
    new THREE.Vector2(1.1, 0.08),  // slight lip
    new THREE.Vector2(1.0, 0.18),  // taper in
    new THREE.Vector2(0.92, 0.28), // shoulder
    new THREE.Vector2(0.8, 0.35),  // upper taper
    new THREE.Vector2(0.6, 0.4),   // top curve
    new THREE.Vector2(0.3, 0.42),  // near top
    new THREE.Vector2(0, 0.43),    // apex
  ];
  const turretGeo = new THREE.LatheGeometry(turretProfile, 24);
  const dome = new THREE.Mesh(turretGeo, kd);
  dome.position.y = 0.02;
  turretGroup.add(dome);
  // Turret bustle (rear ammo/storage — slightly angled)
  const bustle = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.32, 0.65), km);
  bustle.position.set(0, 0.14, 0.95); turretGroup.add(bustle);
  // Bustle rack (welded grid on rear)
  const bustleRack = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.35, 0.08), wm);
  bustleRack.position.set(0, 0.14, 1.3); turretGroup.add(bustleRack);
  for (let br = 0; br < 5; br++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.35, 4), wm);
    bar.position.set(-0.5 + br * 0.25, 0.14, 1.3); turretGroup.add(bar);
  }
  // Commander's hatch
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 12), km);
  hatch.position.set(0.4, 0.45, 0.1); turretGroup.add(hatch);
  const hatchHandle = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.04), wm);
  hatchHandle.position.set(0.4, 0.49, 0.1); turretGroup.add(hatchHandle);
  // Gunner's sight
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.12), kd);
  sight.position.set(-0.35, 0.45, -0.3); turretGroup.add(sight);
  const sightGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.1), mat(0x224488, { e: 0x112244, ei: 2, t: true, o: 0.6 }));
  sightGlass.position.set(-0.35, 0.45, -0.37); turretGroup.add(sightGlass);
  // Barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 12), kd);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.25, -2.8);
  turretGroup.add(barrel);
  // Barrel thermal sleeve
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.5, 12), mat(0x4a5a2a, { m: 0.15, r: 0.85, e: 0x1a2510, ei: 0.2 }));
  sleeve.rotation.x = Math.PI / 2; sleeve.position.set(0, 0.25, -2.0);
  turretGroup.add(sleeve);
  // Muzzle brake
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 12), kd);
  muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.25, -4.9);
  turretGroup.add(muzzle);
  // Bore evacuator (bulge on barrel)
  const evacuator = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 12), kd);
  evacuator.rotation.x = Math.PI / 2; evacuator.position.set(0, 0.25, -3.8);
  turretGroup.add(evacuator);
  // Coaxial MG
  const mg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6), mat(0x222222, { m: 0.8, r: 0.3 }));
  mg.rotation.x = Math.PI / 2; mg.position.set(0.15, 0.2, -1.5);
  turretGroup.add(mg);
  // Turret ERA
  for (let i = 0; i < 4; i++) {
    const era = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.22), eraMat);
    era.position.set(-0.5 + i * 0.35, 0.12, -1.15); turretGroup.add(era);
  }
  // Antenna (whip)
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.015, 2.5, 4), mat(0x444444, { m: 0.5, r: 0.5 }));
  antenna.position.set(0.6, 1.3, 0.5); turretGroup.add(antenna);

  // Smoke grenade launchers (4 per side of turret)
  [-1, 1].forEach(side => {
    for (let sl = 0; sl < 4; sl++) {
      const launcher = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 8), kd);
      launcher.rotation.x = -0.3; launcher.position.set(side * 0.85, 0.35, -0.8 + sl * 0.15);
      turretGroup.add(launcher);
    }
  });
  // NSVT machine gun on commander's hatch
  const nsvt = new THREE.Group();
  const mgBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.08, 8), wm);
  nsvt.add(mgBase);
  const mgBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), mat(0x222222, { m: 0.8, r: 0.3 }));
  mgBody.position.set(0, 0.06, -0.2); nsvt.add(mgBody);
  const mgBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6), mat(0x1a1a1a, { m: 0.9, r: 0.2 }));
  mgBarrel.rotation.x = Math.PI / 2; mgBarrel.position.set(0, 0.06, -0.6); nsvt.add(mgBarrel);
  nsvt.position.set(0.4, 0.52, 0.1); turretGroup.add(nsvt);
  // Searchlight
  const searchlight = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10, 0, Math.PI), mat(0x444444, { m: 0.7, r: 0.3 }));
  searchlight.position.set(-0.7, 0.35, -0.9); searchlight.rotation.y = Math.PI;
  turretGroup.add(searchlight);
  const slGlass = new THREE.Mesh(new THREE.CircleGeometry(0.09, 10), mat(0xffffdd, { e: 0xffff88, ei: 1, t: true, o: 0.5 }));
  slGlass.position.set(-0.7, 0.35, -0.91); turretGroup.add(slGlass);
  // Wind sensor on turret roof
  const sensor = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 4), wm);
  sensor.position.set(-0.2, 0.55, -0.1); turretGroup.add(sensor);
  const sensorTop = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), wm);
  sensorTop.position.set(-0.2, 0.68, -0.1); turretGroup.add(sensorTop);

  g.add(turretGroup);
  g.userData.turret = turretGroup;

  // ── Hull details ──
  // Tow hooks (front)
  [-1.0, 1.0].forEach(x => {
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI), wm);
    hook.position.set(x, 0.5, -2.2); hook.rotation.x = Math.PI / 2; g.add(hook);
  });
  // Tow cable (draped on rear)
  const cable = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.02, 6, 20, Math.PI * 0.8), mat(0x333333, { m: 0.4, r: 0.7 }));
  cable.position.set(0, 0.85, 1.8); cable.rotation.x = Math.PI / 2; cable.rotation.z = 0.3; g.add(cable);
  // Tool boxes (side of hull)
  [-1.38, 1.38].forEach(x => {
    const toolbox = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.6), km);
    toolbox.position.set(x, 0.95, -0.5); g.add(toolbox);
    // Latch
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.08), wm);
    latch.position.set(x + (x > 0 ? 0.07 : -0.07), 0.97, -0.5); g.add(latch);
  });
  // External fuel drums (rear, 2 cylinders)
  [-0.5, 0.5].forEach(x => {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.7, 12), mat(0x3a4a2a, { m: 0.2, r: 0.8, e: 0x1a2510, ei: 0.2 }));
    drum.rotation.x = Math.PI / 2; drum.position.set(x, 0.95, 2.0); g.add(drum);
    // Drum straps
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.015, 4, 12), mat(0x444444, { m: 0.5, r: 0.5 }));
    strap.position.set(x, 0.95, 1.85); g.add(strap);
    const strap2 = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.015, 4, 12), mat(0x444444, { m: 0.5, r: 0.5 }));
    strap2.position.set(x, 0.95, 2.15); g.add(strap2);
  });
  // Periscopes (driver)
  const periscope = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), mat(0x224488, { e: 0x112244, ei: 1.5, t: true, o: 0.7 }));
  periscope.position.set(-0.3, 1.1, -1.4); g.add(periscope);
  // Driver's hatch
  const dHatch = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 10), km);
  dHatch.position.set(-0.3, 1.07, -1.2); g.add(dHatch);
  // Log (for self-recovery, classic T-72 feature)
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8), mat(0x4a3520, { m: 0.1, r: 0.95 }));
  log.rotation.z = Math.PI / 2; log.position.set(0, 1.05, 1.9); g.add(log);
  // Shovel (on left fender)
  const shovelHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 4), mat(0x5a4530, { m: 0.1, r: 0.9 }));
  shovelHandle.rotation.z = 0.1; shovelHandle.position.set(-1.35, 1.0, 0.5); g.add(shovelHandle);
  const shovelBlade = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.02), wm);
  shovelBlade.position.set(-1.35, 0.45, 0.5); g.add(shovelBlade);
  // Unditching beam holder brackets
  [-0.6, 0.6].forEach(x => {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.15), wm);
    bracket.position.set(x, 1.08, 1.85); g.add(bracket);
  });
  // Track links (individual link detail on visible sections)
  [-1.5, 1.5].forEach(x => {
    for (let tl = 0; tl < 18; tl++) {
      const link = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.12), tm);
      link.position.set(x, 0.56, -2.0 + tl * 0.24); g.add(link);
    }
  });
  // Weld seams (subtle lines on hull joints)
  const seamMat = mat(0x6a7a4a, { m: 0.2, r: 0.8, e: 0x3a4a2a, ei: 0.2 });
  [[-1.3, 0.72, 0, 0.02, 0.02, 3.8], [1.3, 0.72, 0, 0.02, 0.02, 3.8], // side seams
   [0, 1.0, -0.9, 2.5, 0.02, 0.02], [0, 1.0, 0.9, 2.5, 0.02, 0.02]].forEach(s => { // cross seams
    const seam = new THREE.Mesh(new THREE.BoxGeometry(s[3], s[4], s[5]), seamMat);
    seam.position.set(s[0], s[1], s[2]); g.add(seam);
  });

  // ── Z marking (3D geometry painted on hull — not a floating plane)
  const whitePaint = mat(0xeeeeee, { m: 0.1, r: 0.9, e: 0xcccccc, ei: 0.3 });
  // Z = 3 bars: top horizontal, diagonal, bottom horizontal
  function addZ(parent, cx, cy, cz, size, rotY) {
    const zg = new THREE.Group();
    const t = size * 0.12; // thickness
    const w = size * 0.7;  // width of horizontal bars
    const h = size;        // total height
    // Top bar
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, t, t), whitePaint);
    top.position.set(0, h / 2 - t / 2, 0); zg.add(top);
    // Bottom bar
    const bot = new THREE.Mesh(new THREE.BoxGeometry(w, t, t), whitePaint);
    bot.position.set(0, -h / 2 + t / 2, 0); zg.add(bot);
    // Diagonal
    const diagLen = Math.sqrt(w * w + h * h) * 0.85;
    const diagAngle = Math.atan2(h, -w);
    const diag = new THREE.Mesh(new THREE.BoxGeometry(diagLen, t, t), whitePaint);
    diag.rotation.z = diagAngle; zg.add(diag);
    zg.position.set(cx, cy, cz);
    if (rotY) zg.rotation.y = rotY;
    parent.add(zg);
  }
  // Z on front glacis
  addZ(g, 0, 0.85, -2.22, 0.8, 0);
  // Z on rear
  addZ(g, 0, 0.85, 2.22, 0.8, Math.PI);
  // Z on right side (smaller)
  addZ(g, 1.5, 0.75, 0, 0.5, Math.PI / 2);

  // ── Headlights
  [-0.9, 0.9].forEach(x => {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), mat(0xffff88, { e: 0xffff44, ei: 8 }));
    hl.position.set(x, 0.85, -2.2); g.add(hl);
    const hlL = new THREE.PointLight(0xffffaa, 2, 6);
    hlL.position.set(x, 0.85, -2.4); g.add(hlL);
  });
  // Rear light
  [-0.7, 0.7].forEach(x => {
    const rl = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), mat(0xff2200, { e: 0xff0000, ei: 3 }));
    rl.position.set(x, 0.7, 2.15); g.add(rl);
  });
  // ── Additional hull detail ──
  // Rivets / bolt heads along hull edges
  const rivetMat = mat(0x555544, { m: 0.7, r: 0.4 });
  for (let ri = 0; ri < 16; ri++) {
    [-1.4, 1.4].forEach(x => {
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 4), rivetMat);
      rivet.position.set(x, 0.98, -1.8 + ri * 0.24); g.add(rivet);
    });
  }
  // Hull top rivets
  for (let ri = 0; ri < 10; ri++) {
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 4), rivetMat);
    rivet.position.set(-1.2 + ri * 0.27, 1.07, -0.3); g.add(rivet);
  }
  // Fender support brackets
  [-1.42, 1.42].forEach(x => {
    for (let fb = 0; fb < 5; fb++) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.15, 0.04), wm);
      bracket.position.set(x, 0.7, -1.6 + fb * 0.8); g.add(bracket);
    }
  });
  // Headlight guards (wire mesh frames)
  [-0.9, 0.9].forEach(x => {
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 4, 12), wm);
    guard.position.set(x, 0.85, -2.25); g.add(guard);
  });
  // Pioneer tools: axe on right fender
  const axeHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.8, 4), mat(0x5a4530, { m: 0.1, r: 0.9 }));
  axeHandle.rotation.z = 0.05; axeHandle.position.set(1.35, 1.0, 0.0); g.add(axeHandle);
  const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.025), wm);
  axeHead.position.set(1.35, 0.62, 0.0); g.add(axeHead);
  // Spare track links (on front glacis, 3 links)
  for (let st = 0; st < 3; st++) {
    const spareLink = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.12), tm);
    spareLink.position.set(-0.4 + st * 0.4, 1.05, -1.4); spareLink.rotation.x = -0.3; g.add(spareLink);
  }
  // Antenna base mount (on turret)
  const antennaBase = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.06, 8), wm);
  antennaBase.position.set(0.6, 0.5, 0.5); turretGroup.add(antennaBase);
  // Second antenna (shorter, radio)
  const ant2 = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 1.5, 4), mat(0x444444, { m: 0.5, r: 0.5 }));
  ant2.position.set(-0.6, 1.0, 0.6); turretGroup.add(ant2);
  // Turret roof detail (ventilator)
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 10), kd);
  vent.position.set(0.1, 0.47, 0.3); turretGroup.add(vent);
  const ventGrill = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 10), mat(0x222222, { m: 0.5, r: 0.5 }));
  ventGrill.position.set(0.1, 0.5, 0.3); turretGroup.add(ventGrill);
  // Turret side stowage rack
  const rack = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.8), wm);
  rack.position.set(1.05, 0.15, 0.3); turretGroup.add(rack);
  // Rack bars
  for (let rb = 0; rb < 4; rb++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), wm);
    bar.position.set(1.05, 0.08, 0.0 + rb * 0.22); turretGroup.add(bar);
  }
  // Mantlet (armored gun housing — beveled box)
  const mantletGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.35, 12);
  const mantlet = new THREE.Mesh(mantletGeo, kd);
  mantlet.rotation.x = Math.PI / 2; mantlet.position.set(0, 0.25, -1.15);
  turretGroup.add(mantlet);
  // Mantlet armor plate (flat face)
  const mantletPlate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.06), kd);
  mantletPlate.position.set(0, 0.25, -1.35); turretGroup.add(mantletPlate);
  // Coax MG flash hider
  const mgFlash = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.06, 6), mat(0x1a1a1a, { m: 0.9, r: 0.2 }));
  mgFlash.rotation.x = Math.PI / 2; mgFlash.position.set(0.15, 0.2, -1.85); turretGroup.add(mgFlash);
  // Engine deck exhaust grilles (detailed)
  for (let eg = 0; eg < 8; eg++) {
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.01, 0.03), mat(0x222222, { m: 0.5, r: 0.5 }));
    bar2.position.set(0, 1.05, 1.2 + eg * 0.08); g.add(bar2);
  }
  // Side ERA mounting rails
  [-1.43, 1.43].forEach(x => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 3.0), wm);
    rail.position.set(x, 0.9, 0); g.add(rail);
    const rail2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 3.0), wm);
    rail2.position.set(x, 0.75, 0); g.add(rail2);
  });
  // Dozer blade mounting points (front)
  [-1.0, 1.0].forEach(x => {
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.1), wm);
    mount.position.set(x, 0.48, -2.1); g.add(mount);
  });
  // Track tension adjusters (front idler area)
  [-1.5, 1.5].forEach(x => {
    const adj = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8), wm);
    adj.rotation.z = Math.PI / 2; adj.position.set(x, 0.35, -2.05); g.add(adj);
  });

  // Self-illumination
  const tankLight = new THREE.PointLight(0x88aa66, 1.5, 8);
  tankLight.position.set(0, 2.5, 0); g.add(tankLight);

  g.scale.set(0.6, 0.6, 0.6);
  return g;
}

// ═══════════════════════════════════════════
// FPV DRONE
// ═══════════════════════════════════════════
function buildDrone() {
  const g = new THREE.Group();
  [Math.PI/4,-Math.PI/4].forEach(r=>{const a=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.015,0.7),M.carbon);a.rotation.y=r;g.add(a)});
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.1,0.035,0.1),M.carbon));
  g.add((()=>{const _m=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.025,0.12),M.dark);_m.position.set(0,-0.02,0);return _m})());
  [[0.25,0,0.25],[-0.25,0,0.25],[0.25,0,-0.25],[-0.25,0,-0.25]].forEach(p=>{
    g.add((()=>{const _m=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.035,0.03,8),M.dark);_m.position.set(...p);return _m})());
    const prop=new THREE.Mesh(new THREE.CircleGeometry(0.1,16),new THREE.MeshBasicMaterial({color:0x88aacc,transparent:true,opacity:0.12,side:THREE.DoubleSide}));
    prop.rotation.x=-Math.PI/2;prop.position.set(p[0],0.02,p[2]);g.add(prop)});
  const cam2=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.03,0.03),mat(0x111115,{m:0.8,r:0.2}));cam2.position.set(0,-0.01,-0.07);g.add(cam2);
  const lens2=new THREE.Mesh(new THREE.SphereGeometry(0.012,8,8),mat(0x001122,{m:0.95,r:0.05,e:0x0066aa,ei:2}));lens2.position.set(0,-0.01,-0.09);g.add(lens2);
  const led=new THREE.Mesh(new THREE.SphereGeometry(0.008,4,4),mat(0xff0000,{e:0xff0000,ei:10}));led.position.set(0,0.02,0.04);led.userData.led=true;g.add(led);
  g.scale.set(2.2,2.2,2.2);
  return g;
}

// ═══════════════════════════════════════════
// ROAD OBJECT SPRITES (billboard pool)
// ═══════════════════════════════════════════
const SPRITE_POOL_SIZE = 20;
const spritePool = [];
for (let i = 0; i < SPRITE_POOL_SIZE; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: true }));
  sp.visible = false;
  scene.add(sp);
  spritePool.push(sp);
}

// Pre-render enemy textures to canvas
function makeEnemyTexture(type, text) {
  const S = 256, H = S / 2;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');
  x.clearRect(0, 0, S, S);
  x.textAlign = 'center'; x.textBaseline = 'middle';

  if (type === 'letter') {
    // Glowing gold letter with outer ring
    x.shadowColor = '#ffcc00'; x.shadowBlur = 40;
    x.strokeStyle = '#ffcc00'; x.lineWidth = 3;
    x.beginPath(); x.arc(H, H, 90, 0, Math.PI * 2); x.stroke();
    x.font = 'bold 160px Impact';
    x.fillStyle = '#ffcc00'; x.fillText(text, H, H + 10);
    x.shadowBlur = 0;
    // Inner glow circle
    const g = x.createRadialGradient(H, H, 20, H, H, 100);
    g.addColorStop(0, 'rgba(255,200,0,0.15)'); g.addColorStop(1, 'transparent');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  } else if (type === 'rkn') {
    // Shield with eagle + neon glow
    x.shadowColor = '#0044cc'; x.shadowBlur = 20;
    x.fillStyle = '#0a2266';
    x.beginPath(); x.moveTo(H, 15); x.lineTo(215, 50); x.lineTo(225, 135); x.lineTo(200, 195); x.lineTo(H, 238);
    x.lineTo(56, 195); x.lineTo(31, 135); x.lineTo(41, 50); x.closePath(); x.fill();
    x.shadowBlur = 0;
    // Gold border
    x.strokeStyle = '#c8a832'; x.lineWidth = 4; x.stroke();
    // Inner border
    x.strokeStyle = 'rgba(200,168,50,0.3)'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(H, 30); x.lineTo(200, 60); x.lineTo(208, 130); x.lineTo(190, 185); x.lineTo(H, 222);
    x.lineTo(66, 185); x.lineTo(48, 130); x.lineTo(56, 60); x.closePath(); x.stroke();
    // Eagle silhouette (simplified)
    x.fillStyle = '#c8a832';
    x.font = 'bold 70px serif'; x.fillText('☦', H, 105);
    // Text
    x.font = 'bold 24px sans-serif'; x.fillStyle = '#ddc860'; x.fillText('РКН', H, 155);
    x.font = 'bold 11px sans-serif'; x.fillStyle = 'rgba(200,168,50,0.6)';
    x.fillText('РОСКОМНАДЗОР', H, 180);
    x.fillText('ЗАБЛОКИРОВАНО', H, 198);
  } else if (type === 'tv') {
    // Retro TV with static
    x.fillStyle = '#1a1a1a'; // TV casing
    x.beginPath(); x.moveTo(40, 35); x.lineTo(216, 35); x.quadraticCurveTo(226, 35, 226, 45);
    x.lineTo(226, 175); x.quadraticCurveTo(226, 185, 216, 185);
    x.lineTo(40, 185); x.quadraticCurveTo(30, 185, 30, 175);
    x.lineTo(30, 45); x.quadraticCurveTo(30, 35, 40, 35); x.closePath(); x.fill();
    // Screen
    x.fillStyle = '#0a0a2a'; x.fillRect(42, 45, 172, 128);
    // Static noise on screen
    for (let py = 45; py < 173; py += 2) {
      x.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.08) + ')';
      x.fillRect(42, py, 172, 1);
    }
    // Red channel logo
    x.fillStyle = '#cc0000'; x.font = 'bold 14px sans-serif'; x.fillText('ПЕРВЫЙ КАНАЛ', H, 65);
    // Propaganda text
    x.fillStyle = '#ff4444'; x.font = 'bold 18px sans-serif';
    x.fillText(text || 'ПЕРВЫЙ', H, 110);
    // Antenna
    x.strokeStyle = '#444'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(95, 35); x.lineTo(75, 8); x.stroke();
    x.beginPath(); x.moveTo(161, 35); x.lineTo(181, 8); x.stroke();
    // Antenna tips
    x.fillStyle = '#666'; x.beginPath(); x.arc(75, 8, 3, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(181, 8, 3, 0, Math.PI * 2); x.fill();
    // Stand
    x.fillStyle = '#222'; x.fillRect(110, 185, 36, 12);
    x.fillRect(95, 197, 66, 6);
    // Label
    x.fillStyle = 'rgba(255,100,100,0.5)'; x.font = '12px sans-serif'; x.fillText(text || '', H, 215);
  } else if (type === 'babushka') {
    // Babushka with headscarf + wagging finger
    // Headscarf (triangle)
    x.fillStyle = '#8B4513';
    x.beginPath(); x.moveTo(H - 50, 55); x.lineTo(H + 50, 55); x.lineTo(H + 35, 110); x.lineTo(H, 120); x.lineTo(H - 35, 110); x.closePath(); x.fill();
    // Face
    x.fillStyle = '#D2A679';
    x.beginPath(); x.arc(H, 85, 30, 0, Math.PI * 2); x.fill();
    // Eyes (disapproving)
    x.fillStyle = '#333';
    x.fillRect(H - 14, 78, 8, 4); x.fillRect(H + 6, 78, 8, 4);
    // Frown
    x.strokeStyle = '#333'; x.lineWidth = 2;
    x.beginPath(); x.arc(H, 100, 10, 0.2, Math.PI - 0.2); x.stroke();
    // Body (coat)
    x.fillStyle = '#654321';
    x.beginPath(); x.moveTo(H - 40, 115); x.lineTo(H + 40, 115); x.lineTo(H + 50, 210); x.lineTo(H - 50, 210); x.closePath(); x.fill();
    // Wagging finger (right hand)
    x.strokeStyle = '#D2A679'; x.lineWidth = 4; x.lineCap = 'round';
    x.beginPath(); x.moveTo(H + 40, 140); x.lineTo(H + 70, 110); x.stroke();
    // Finger tip
    x.fillStyle = '#D2A679'; x.beginPath(); x.arc(H + 70, 107, 5, 0, Math.PI * 2); x.fill();
    // Label
    x.fillStyle = '#cc9966'; x.font = 'bold 16px sans-serif'; x.fillText(text || 'БАБУШКА', H, 238);
  } else if (type === 'znakomi') {
    // Speech bubble with advice
    x.fillStyle = 'rgba(60,60,70,0.85)';
    x.beginPath(); x.moveTo(25, 30); x.lineTo(231, 30); x.quadraticCurveTo(245, 30, 245, 48);
    x.lineTo(245, 150); x.quadraticCurveTo(245, 168, 231, 168);
    x.lineTo(155, 168); x.lineTo(H, 205); x.lineTo(101, 168); x.lineTo(25, 168);
    x.quadraticCurveTo(11, 168, 11, 150); x.lineTo(11, 48);
    x.quadraticCurveTo(11, 30, 25, 30); x.closePath(); x.fill();
    // Border glow
    x.strokeStyle = 'rgba(255,255,255,0.15)'; x.lineWidth = 1.5; x.stroke();
    // Person icon (small)
    x.fillStyle = 'rgba(255,255,255,0.25)';
    x.beginPath(); x.arc(50, 70, 12, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.moveTo(38, 85); x.lineTo(62, 85); x.lineTo(65, 110); x.lineTo(35, 110); x.closePath(); x.fill();
    // Text
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = '15px sans-serif';
    const words = (text || 'ЗНАКОМЫЙ').split(' ');
    words.forEach((w, i) => x.fillText(w, H + 20, 65 + i * 22));
    // "..." typing indicator
    x.fillStyle = 'rgba(255,255,255,0.3)'; x.font = '24px sans-serif';
    x.fillText('...', H + 20, 65 + words.length * 22);
  } else if (type === 'chinovnik') {
    // Official document with stamps
    x.fillStyle = '#e8e0d0'; x.fillRect(50, 20, 156, 200);
    // Folded corner
    x.fillStyle = '#d0c8b0';
    x.beginPath(); x.moveTo(170, 20); x.lineTo(206, 20); x.lineTo(206, 56); x.closePath(); x.fill();
    x.fillStyle = '#c0b8a0';
    x.beginPath(); x.moveTo(170, 20); x.lineTo(206, 56); x.lineTo(170, 56); x.closePath(); x.fill();
    // Header
    x.fillStyle = '#334'; x.font = 'bold 11px sans-serif';
    x.fillText('РОССИЙСКАЯ ФЕДЕРАЦИЯ', H, 42);
    // Lines of "text"
    x.fillStyle = '#888';
    for (let l = 0; l < 7; l++) x.fillRect(65, 58 + l * 18, 110 + Math.random() * 20, 2);
    // Red stamp (round)
    x.strokeStyle = '#cc0000'; x.lineWidth = 2;
    x.beginPath(); x.arc(160, 160, 25, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.arc(160, 160, 18, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#cc0000'; x.font = 'bold 9px sans-serif'; x.fillText('ОТКАЗАНО', 160, 158);
    // Blue stamp
    x.strokeStyle = '#0044aa'; x.lineWidth = 2;
    x.beginPath(); x.arc(100, 170, 20, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#0044aa'; x.font = 'bold 7px sans-serif'; x.fillText('МФЦ', 100, 170);
    // Label
    x.fillStyle = '#558855'; x.font = 'bold 14px sans-serif'; x.fillText(text || 'МФЦ', H, 240);
  } else if (type === 'gopnik') {
    // Gopnik — squatting figure in Adidas tracksuit
    x.fillStyle = '#1a1a2a'; x.fillRect(0, 0, S, S);
    // Body (squatting pose)
    x.fillStyle = '#222'; // dark tracksuit
    x.beginPath(); x.moveTo(90, 130); x.lineTo(166, 130); x.lineTo(180, 200); x.lineTo(76, 200); x.closePath(); x.fill();
    // Legs (squatting)
    x.fillStyle = '#222';
    x.beginPath(); x.moveTo(85, 200); x.lineTo(70, 240); x.lineTo(95, 240); x.lineTo(110, 200); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(146, 200); x.lineTo(161, 240); x.lineTo(186, 240); x.lineTo(170, 200); x.closePath(); x.fill();
    // Three stripes (white)
    x.strokeStyle = '#fff'; x.lineWidth = 2;
    for (let st = 0; st < 3; st++) {
      x.beginPath(); x.moveTo(95 + st * 4, 130); x.lineTo(82 + st * 4, 200); x.stroke();
      x.beginPath(); x.moveTo(157 + st * 4, 130); x.lineTo(170 + st * 4, 200); x.stroke();
    }
    // Head
    x.fillStyle = '#D2A679'; x.beginPath(); x.arc(H, 105, 28, 0, Math.PI * 2); x.fill();
    // Cap (кепка)
    x.fillStyle = '#111'; x.beginPath(); x.ellipse(H, 85, 30, 12, 0, 0, Math.PI * 2); x.fill();
    x.fillRect(H - 32, 80, 64, 10);
    // Sunflower seeds (семечки in hand)
    x.fillStyle = '#444'; x.beginPath(); x.ellipse(180, 170, 10, 6, 0.3, 0, Math.PI * 2); x.fill();
    // Shoes (white sneakers)
    x.fillStyle = '#ddd'; x.fillRect(65, 238, 32, 10); x.fillRect(158, 238, 32, 10);
    // Label
    x.fillStyle = '#ff4444'; x.font = 'bold 16px sans-serif'; x.fillText(text || 'ГОПНИК', H, 30);
    x.fillStyle = 'rgba(255,255,255,0.3)'; x.font = '11px sans-serif'; x.fillText('семечки · кепка · три полоски', H, 52);
  } else {
    // Hazard sign with phrase
    // Triangle warning
    x.fillStyle = '#cc0000';
    x.beginPath(); x.moveTo(H, 30); x.lineTo(230, 170); x.lineTo(26, 170); x.closePath(); x.fill();
    x.fillStyle = '#ffcc00';
    x.beginPath(); x.moveTo(H, 50); x.lineTo(215, 163); x.lineTo(41, 163); x.closePath(); x.fill();
    x.fillStyle = '#cc0000'; x.font = 'bold 60px sans-serif'; x.fillText('!', H, 130);
    // Text below
    x.fillStyle = '#ff4444'; x.font = 'bold 16px sans-serif'; x.fillText(text || '???', H, 200);
  }

  return new THREE.CanvasTexture(c);
}

// Texture cache
const texCache = new Map();
function getEnemyTexture(type, text) {
  const key = type + ':' + (text || '');
  if (!texCache.has(key)) texCache.set(key, makeEnemyTexture(type, text));
  return texCache.get(key);
}

// ═══════════════════════════════════════════
// PARTICLE SYSTEM (fire/smoke/sparks)
// ═══════════════════════════════════════════
const PARTICLE_COUNT = 200;
const particleGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PARTICLE_COUNT * 3);
const pSizes = new Float32Array(PARTICLE_COUNT);
const pAlphas = new Float32Array(PARTICLE_COUNT);
particleGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
particleGeo.setAttribute('size', new THREE.BufferAttribute(pSizes, 1));
const particleMat = new THREE.PointsMaterial({
  color: 0xff8800, size: 0.3, transparent: true, opacity: 0.5,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
});
const particles = new THREE.Points(particleGeo, particleMat);
scene.add(particles);
let activeParticles = 0;

function emitParticle(x, y, z, size) {
  const i = activeParticles % PARTICLE_COUNT;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
  pSizes[i] = size;
  activeParticles++;
}

// ═══════════════════════════════════════════
// SCENE INSTANCES
// ═══════════════════════════════════════════
// Car: procedural first, then async-replace with Ferrari GLB
let carModel = buildDeLorean();
scene.add(carModel);

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/js/lib/draco/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.load('/models/ferrari.glb', (gltf) => {
  scene.remove(carModel);
  const loaded = gltf.scene;
  // Auto-scale
  const box = new THREE.Box3().setFromObject(loaded);
  const sz = new THREE.Vector3(); box.getSize(sz);
  const s = 2.5 / Math.max(sz.x, sz.y, sz.z);
  loaded.scale.set(s, s, s);
  // Sit on ground
  const box2 = new THREE.Box3().setFromObject(loaded);
  loaded.position.y = -box2.min.y;
  loaded.position.z = 1.5;
  loaded.rotation.y = 0; // rear faces camera
  // Synthwave neon treatment
  loaded.traverse(c => {
    if (c.isMesh && c.material) {
      if (c.material.metalness !== undefined) c.material.metalness = Math.max(c.material.metalness, 0.6);
      if (c.material.roughness !== undefined) c.material.roughness = Math.min(c.material.roughness, 0.3);
      if (c.material.emissive) { c.material.emissive.setHex(0x111122); c.material.emissiveIntensity = 0.15; }
    }
  });
  // Underglow
  const ug = new THREE.PointLight(0x00c8ff, 3, 5); ug.position.set(0, 0.1, 0); loaded.add(ug);
  loaded.userData.ugLight = ug;
  // Tail lights
  const tl1 = new THREE.PointLight(0xff0030, 1.5, 3); tl1.position.set(-0.4, 0.4, sz.z * s / 2); loaded.add(tl1);
  const tl2 = new THREE.PointLight(0xff0030, 1.5, 3); tl2.position.set(0.4, 0.4, sz.z * s / 2); loaded.add(tl2);
  carModel = loaded;
  scene.add(carModel);
  console.log('[synth3d] Ferrari loaded');
}, undefined, () => console.warn('[synth3d] GLB failed, using procedural'));

console.log('[synth3d] scene ready');

// Tank — procedural fallback, async replace with GLB
let tankModel = buildTank();
tankModel.visible = false;
tankModel.rotation.y = Math.PI;
scene.add(tankModel);

const glbLoader = gltfLoader; // reuse same loader

function autoScaleModel(model, targetSize) {
  const box = new THREE.Box3().setFromObject(model);
  const sz = new THREE.Vector3(); box.getSize(sz);
  const s = targetSize / Math.max(sz.x, sz.y, sz.z);
  model.scale.set(s, s, s);
  const box2 = new THREE.Box3().setFromObject(model);
  model.position.y = -box2.min.y;
  return s;
}

// Load T-72B3 GLB
glbLoader.load('/models/tank.glb', (gltf) => {
  scene.remove(tankModel);
  tankModel = gltf.scene;
  autoScaleModel(tankModel, 2);
  tankModel.visible = false;
  tankModel.rotation.y = 0; // front faces camera (was PI = inverted)
  // Add self-illumination
  const tl = new THREE.PointLight(0x88aa66, 2, 10);
  tl.position.set(0, 2, 0); tankModel.add(tl);
  // Try to find turret for rotation
  tankModel.traverse(c => { if (c.name && c.name.toLowerCase().includes('turret')) tankModel.userData.turret = c; });
  scene.add(tankModel);
  console.log('[synth3d] T-72B3 GLB loaded');
}, undefined, () => console.warn('[synth3d] tank GLB failed'));

// Drones — procedural fallback, async replace with GLB
const droneModels = [];
for (let i = 0; i < 5; i++) { const d = buildDrone(); d.visible = false; scene.add(d); droneModels.push(d); }

let droneTemplate = null;
glbLoader.load('/models/drone.glb', (gltf) => {
  droneTemplate = gltf.scene;
  autoScaleModel(droneTemplate, 0.03);
  // Replace procedural drones with GLB clones
  for (let i = 0; i < 5; i++) {
    scene.remove(droneModels[i]);
    const clone = droneTemplate.clone();
    clone.visible = false;
    scene.add(clone);
    droneModels[i] = clone;
  }
  console.log('[synth3d] FPV drone GLB loaded');
}, undefined, () => console.warn('[synth3d] drone GLB failed'));

// Gopnik enemy model (loaded async, used as road obstacle)
let gopnikTemplate = null;
const GOPNIK_POOL_SIZE = 5;
const gopnikPool = [];
glbLoader.load('/models/gopnik.glb', (gltf) => {
  gopnikTemplate = gltf.scene;
  autoScaleModel(gopnikTemplate, 1.2);
  // Create pool of gopnik clones — original materials untouched, just add lights nearby
  for (let i = 0; i < GOPNIK_POOL_SIZE; i++) {
    const wrapper = new THREE.Group();
    const clone = gopnikTemplate.clone();
    wrapper.add(clone);
    wrapper.visible = false;
    // Bright lights OUTSIDE the model, in the wrapper group
    const topLight = new THREE.PointLight(0xffffff, 10, 8);
    topLight.position.set(0, 4, 0); wrapper.add(topLight);
    const frontLight = new THREE.PointLight(0xffffff, 6, 6);
    frontLight.position.set(0, 1.5, 2); wrapper.add(frontLight);
    const backLight = new THREE.PointLight(0xffaa66, 4, 5);
    backLight.position.set(0, 1, -2); wrapper.add(backLight);
    scene.add(wrapper);
    gopnikPool.push(wrapper);
  }
  console.log('[synth3d] gopnik GLB loaded, pool:', GOPNIK_POOL_SIZE);
}, undefined, () => console.warn('[synth3d] gopnik GLB failed'));

const muzzleLight = new THREE.PointLight(0xffaa00, 0, 20);
scene.add(muzzleLight);

// ═══════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════
function onResize() {
  W = window.innerWidth; H = window.innerHeight;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}
window.addEventListener('resize', onResize);
// Also trigger on orientation change (mobile)
window.addEventListener('orientationchange', () => setTimeout(onResize, 100));

// ═══════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════

/**
 * Update entire scene. Called every frame from game loop.
 */
export function updateScene(state) {
  const { car, objects, t, isDrifting, driftSmoke, dead, deadTime, tankApproach, tankPatrol, tankFiring, droneStates } = state;
  const speed = car.speed;
  const sn = Math.min(1, Math.max(0, (speed - 5) / 75));

  // Uniforms
  // Scroll grid texture (accumulate, don't reset)
  gridTex.offset.y -= speed * 0.0003;
  gridTex.needsUpdate = false; // offset change doesn't need re-upload

  // Road edge pulse brightness
  const pulse = 0.5 + Math.sin(t * 3.5) * 0.15;
  edgeMat.color.setHex(pulse > 0.55 ? 0xff40cc : 0xff00b4);

  sunMat.uniforms.pulse.value = Math.sin(t * 3) * 0.15;

  // Star parallax
  const sp2 = stars.geometry.attributes.position;
  for (let i = 0; i < starCount; i++) {
    sp2.array[i * 3] -= speed * 0.002;
    if (sp2.array[i * 3] < -100) sp2.array[i * 3] += 200;
  }
  sp2.needsUpdate = true;

  // ── Car ──
  carModel.position.x = car.screenX * 4.5;
  // Y set by auto-positioning on load, don't override
  carModel.position.z = 1.5;
  carModel.rotation.y = car.viewAngle * 0.7;
  carModel.rotation.z = -car.bodyTilt * 0.6;
  if (carModel.userData.wheels) carModel.userData.wheels.forEach(w => { w.children[0].rotation.y += speed * 0.015; });
  if (carModel.userData.ugLight) carModel.userData.ugLight.intensity = 2 + speed * 0.06;

  // Damage color
  const dmg = 1 - car.health / 100;
  M.steel.color.setHex(dmg > 0.5 ? 0x664433 : dmg > 0.15 ? 0x998877 : 0xbbbbdd);
  M.steel.emissive.setHex(dmg > 0.5 ? 0x331100 : 0x000000);
  M.steel.emissiveIntensity = dmg > 0.5 ? dmg : 0;

  // ── Zone system: decorations change along the route ──
  // Zone 0 (0-20%): Russia — Soviet blocks, dark
  // Zone 1 (20-40%): Eastern Europe — forests, sparse
  // Zone 2 (40-60%): Central Europe — Gothic, rain begins
  // Zone 3 (60-80%): Western Europe — modern, heavy rain
  // Zone 4 (80-100%): London approach — urban, dawn
  const tp = state.tripProgress || 0;
  const zone = Math.floor(tp * 5);

  // Zone-based building colors
  const zoneColors = [0x0a0018, 0x0a1008, 0x101018, 0x0c0c18, 0x121215];
  const zoneBldColor = zoneColors[Math.min(zone, 4)];

  // ── Track-driven road (segment-based) ──
  const roadPos = state.roadPosition || 0;
  const seg = getSegment(roadPos);

  // Accumulated curve: sum curve values for next 30 segments ahead
  // This creates the visual sweep (road appears to bend ahead)
  const accCurve = getAccumulatedCurve(roadPos, 30) * 0.15;

  // Current segment elevation
  const segY = seg.y;
  const roadNarrow = seg.width || 1.0;

  // Smooth the curve and elevation (no jitter)
  scene.userData._smoothCurve = (scene.userData._smoothCurve || 0) * 0.93 + accCurve * 0.07;
  scene.userData._smoothY = (scene.userData._smoothY || 0) * 0.95 + segY * 0.05;
  const roadCurve = scene.userData._smoothCurve;
  const hillY = scene.userData._smoothY;
  const camTargetY = 9 + hillY;

  // Apply curve — world shifts, car stays
  ground.position.x = roadCurve;
  road.position.x = roadCurve;
  edgeL.position.x = -6 * roadNarrow + roadCurve;
  edgeR.position.x = 6 * roadNarrow + roadCurve;
  innerL.position.x = -4 * roadNarrow + roadCurve;
  innerR.position.x = 4 * roadNarrow + roadCurve;
  centerLine.position.x = roadCurve;

  // Apply elevation
  ground.position.y = -0.02 + hillY;
  road.position.y = -0.01 + hillY;
  carModel.position.y = 0.15 + hillY;

  // ── Scroll buildings ──
  const scrollSpeed = speed * 0.05;
  buildings.forEach((b, i) => {
    b.position.z += scrollSpeed;
    if (b.position.z > 15) {
      b.position.z -= 280;
      // Change building appearance based on zone
      if (b.material) b.material.color.setHex(zoneBldColor);
      // Zone 1: lower buildings (forest area)
      if (zone === 1) { b.scale.y = 0.3 + Math.random() * 0.5; b.material && b.material.color.setHex(0x001a08); }
      // Zone 2-3: taller, narrower (European)
      else if (zone >= 2 && zone <= 3) { b.scale.y = 1 + Math.random() * 0.8; }
      // Zone 4: tallest (London)
      else if (zone >= 4) { b.scale.y = 1.2 + Math.random(); }
      else { b.scale.y = 0.6 + Math.random() * 0.8; }
    }
    // Buildings follow road curve
    const side = i < 20 ? -1 : 1;
    const baseX = side * (9 + (i % 5) * 1.5);
    b.position.x = baseX + roadCurve;
  });

  // ── Scroll barrier posts ──
  barrierPosts.forEach((p, i) => {
    p.position.z += scrollSpeed;
    if (p.position.z > 15) p.position.z -= 240;
    const side = i < 20 ? -1 : 1;
    p.position.x = side * 7 + roadCurve;
    p.position.y = 0.6 + hillY;
  });

  // ── Scroll palms ──
  palms.forEach((p, i) => {
    p.position.z += scrollSpeed;
    if (p.position.z > 15) p.position.z -= 240;
    p.children.forEach((c, ci) => {
      if (ci > 0) c.rotation.x = 0.5 + Math.sin(t * 1.5 + ci) * 0.1;
    });
    // Palms fade out after zone 1 (not in Europe)
    p.visible = zone < 2;
    const side = i < 8 ? -1 : 1;
    p.position.x = side * (11 + (i % 3) * 2) + roadCurve;
  });

  // ── Scroll lamps ──
  lamps.forEach((l, i) => {
    l.position.z += scrollSpeed;
    if (l.position.z > 15) l.position.z -= 240;
    const side = i < 10 ? -1 : 1;
    l.position.x = side * 7.5 + roadCurve;
    l.position.y = hillY;
  });

  // ── Tire marks during drift ──
  if (isDrifting && speed > 8) {
    const tm = tireMarks[tireMarkIdx % TIRE_MARK_MAX];
    tm.visible = true;
    tm.position.set(carModel.position.x + (Math.random() - 0.5) * 0.8, 0.005, carModel.position.z + 1);
    tm.material.opacity = 0.35;
    tireMarkIdx++;
    const tm2 = tireMarks[tireMarkIdx % TIRE_MARK_MAX];
    tm2.visible = true;
    tm2.position.set(carModel.position.x + (Math.random() - 0.5) * 0.8 + 1, 0.005, carModel.position.z + 1);
    tm2.material.opacity = 0.35;
    tireMarkIdx++;
  }
  // Fade old marks
  tireMarks.forEach(tm => { if (tm.visible && tm.material.opacity > 0.01) tm.material.opacity -= 0.003; else if (tm.material.opacity <= 0.01) tm.visible = false; });

  // ── Exhaust flames at high speed ──
  const exhaustActive = speed > 30;
  exhaustMat.opacity = exhaustActive ? Math.min(0.5, (speed - 30) / 50) : 0;
  if (exhaustActive) {
    const ep = exhaustPts.geometry.attributes.position;
    for (let i = 0; i < EXHAUST_COUNT; i++) {
      ep.array[i * 3] = carModel.position.x + (Math.random() - 0.5) * 0.3;
      ep.array[i * 3 + 1] = 0.25 + Math.random() * 0.15;
      ep.array[i * 3 + 2] = carModel.position.z + 1.5 + Math.random() * (speed * 0.02);
    }
    ep.needsUpdate = true;
    exhaustMat.color.setHex(speed > 60 ? 0x6644ff : 0x4488ff);
  }

  // ── Barrier collision (push car back if outside road) ──
  if (car.posX > 10 || car.posX < -10) {
    // will be handled in index.html as damage
  }

  // ── Rain (intensity ramps up at 60% of trip) ──
  const tripProgress = state.tripProgress || 0;
  rainIntensity = tripProgress > 0.5 ? Math.min(1, (tripProgress - 0.5) * 3) : 0;
  rainMat.opacity = rainIntensity * 0.4;
  if (rainIntensity > 0) {
    const rp = rain.geometry.attributes.position;
    for (let i = 0; i < RAIN_COUNT; i++) {
      rp.array[i * 3 + 1] -= rainVel[i] * (1 + speed * 0.02);
      rp.array[i * 3 + 2] += speed * 0.02;
      if (rp.array[i * 3 + 1] < 0) {
        rp.array[i * 3 + 1] = 15 + Math.random() * 5;
        rp.array[i * 3] = (Math.random() - 0.5) * 40;
        rp.array[i * 3 + 2] = Math.random() * 40 - 30;
      }
    }
    rp.needsUpdate = true;
  }

  // ── Sky color transition (purple night → orange dawn as trip progresses) ──
  if (tripProgress > 0.7) {
    const dawnFrac = (tripProgress - 0.7) / 0.3;
    // Tint the sun glow warmer
    sunGlow.material.color.setHex(dawnFrac > 0.5 ? 0xff6600 : 0xff0066);
    sunGlow.material.opacity = 0.12 + dawnFrac * 0.1;
  }

  // ── Debug overlay ──
  if (debugMode) {
    const box = new THREE.Box3().setFromObject(carModel);
    debugBox.position.set(
      (box.min.x + box.max.x) / 2,
      (box.min.y + box.max.y) / 2,
      (box.min.z + box.max.z) / 2
    );
    debugBox.scale.set(
      box.max.x - box.min.x,
      box.max.y - box.min.y,
      box.max.z - box.min.z
    );
    const fps = 1 / Math.max(0.001, performance.now() / 1000 - (state._lastT || 0));
    state._lastT = performance.now() / 1000;
    debugDiv.textContent =
      'FPS: ' + Math.round(fps) +
      '\nCar pos: ' + carModel.position.x.toFixed(1) + ', ' + carModel.position.z.toFixed(1) +
      '\nCar game: posX=' + car.posX.toFixed(1) + ' speed=' + speed.toFixed(0) +
      '\nBBox: ' + (box.max.x - box.min.x).toFixed(1) + 'x' + (box.max.z - box.min.z).toFixed(1) +
      '\nObjects: ' + (objects ? objects.filter(o => !o.hit).length : 0) +
      '\nHP: ' + car.health + ' Dead: ' + !!dead +
      '\nTrip: ' + Math.round(tripProgress * 100) + '%' +
      '\nRain: ' + rainIntensity.toFixed(2);
  }

  // Camera — follows road curve + elevation
  camera.position.x += ((carModel.position.x + roadCurve) * 0.4 - camera.position.x) * 0.04;
  camera.position.y += (camTargetY - camera.position.y) * 0.03;
  camera.position.z = 14;
  camera.lookAt(carModel.position.x * 0.3, hillY, -5);

  // ── Road objects (sprites + 3D gopnik meshes) ──
  let si = 0;
  let gi = 0; // gopnik 3D mesh index
  if (objects) {
    for (let oi = 0; oi < objects.length && si < SPRITE_POOL_SIZE; oi++) {
      const o = objects[oi];
      if (o.hit || o.z < 1 || o.z > 200) continue;
      const frac = 1 - o.z / 200;
      const worldZ = -120 + frac * 125;
      const worldX = (o.wx - car.posX) * 0.4;
      const isLandmark = o.type === 'bigben' || o.type === 'londoneye';

      // Gopnik: use 3D model if loaded
      if (o.type === 'gopnik' && gopnikTemplate && gi < gopnikPool.length) {
        const gm = gopnikPool[gi++];
        gm.visible = true;
        gm.position.set(worldX, 0, worldZ);
        const sc = 0.3 + frac * 1.5;
        gm.scale.set(sc, sc, sc);
        gm.rotation.y = Math.PI; // face the car (static)
        continue; // skip sprite for this one
      }

      const sp = spritePool[si++];
      sp.visible = true;
      const worldY = isLandmark ? 4 : 1.5;
      sp.position.set(worldX, worldY, worldZ);
      const sc = isLandmark ? 2 + frac * 6 : 0.5 + frac * 4;
      sp.scale.set(sc, sc, 1);
      sp.material.map = getEnemyTexture(o.type, o.text);
      sp.material.needsUpdate = true;
    }
  }
  // Hide unused
  for (let j = si; j < SPRITE_POOL_SIZE; j++) spritePool[j].visible = false;
  for (let j = gi; j < gopnikPool.length; j++) gopnikPool[j].visible = false;

  // ── Drift smoke particles ──
  if (isDrifting && speed > 8) {
    for (let p = 0; p < 3; p++) {
      emitParticle(
        carModel.position.x + (Math.random() - 0.5) * 1.5,
        0.3 + Math.random() * 0.5,
        carModel.position.z + 1.5 + Math.random() * 0.5,
        0.2 + Math.random() * 0.3
      );
    }
  }

  // ── Fire when dead ──
  if (dead) {
    for (let f = 0; f < 5; f++) {
      emitParticle(
        carModel.position.x + (Math.random() - 0.5) * 2,
        0.5 + Math.random() * 2,
        carModel.position.z + (Math.random() - 0.5),
        0.3 + Math.random() * 0.5
      );
    }
    particleMat.color.setHex(0xff4400);
  } else {
    particleMat.color.setHex(0xff8800);
  }

  // Fade particles
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    pPos[i * 3 + 1] += 0.02; // rise
    pSizes[i] *= 0.96; // shrink
    if (pSizes[i] < 0.01) pSizes[i] = 0;
  }
  particleGeo.attributes.position.needsUpdate = true;
  particleGeo.attributes.size.needsUpdate = true;

  // ── Tank ──
  tankModel.visible = !!dead;
  if (dead && tankApproach !== undefined) {
    const arriveZ = -5; // stops near the car
    const startZ = -50; // starts far away
    const pz = Math.min(tankApproach, 1);
    const tz = startZ + pz * (arriveZ - startZ); // -25 → -3
    // Patrol: move left-right AFTER arrival
    // Patrol: erratic movement — slow drift + sudden jerks (like a real tank hunting)
    const tp = tankPatrol || 0;
    const patrolX = pz >= 1 ?
      Math.sin(tp * 0.008) * 3 + Math.sin(tp * 0.023) * 1.5 + Math.sin(tp * 0.067) * 0.8 : 0;
    tankModel.position.x = patrolX;
    tankModel.position.y = 0;
    tankModel.position.z = tz;
    tankModel.rotation.y = 0; // front faces camera
    // Turret independently tracks the car
    if (tankModel.userData.turret) {
      const dx = carModel.position.x - tankModel.position.x;
      const dz = carModel.position.z - tankModel.position.z;
      const targetAngle = Math.atan2(dx, dz);
      const turret = tankModel.userData.turret;
      // Smooth rotation toward target
      let diff = targetAngle - turret.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      turret.rotation.y += diff * 0.05; // slow tracking
    }
    // Constant big size
    tankModel.scale.set(0.6, 0.6, 0.6);
    muzzleLight.intensity = tankFiring ? 20 : 0;
    muzzleLight.position.set(tankModel.position.x, 1.5, tankModel.position.z - 2);
  }

  // ── Drones ──
  if (droneStates) {
    droneModels.forEach((d, i) => {
      const st = droneStates[i];
      if (!st || !st.visible) { d.visible = false; return; }
      d.visible = true;
      d.position.x = (st.x / W - 0.5) * 8;
      d.position.y = 2 + (1 - st.approach) * 3; // start high (5), descend to 2
      d.position.z = -8 + st.approach * 10; // approach from far
      d.lookAt(carModel.position);
      const sc = 0.05 + st.approach * 0.15; // tiny: 0.05 → 0.2
      d.scale.set(sc, sc, sc);
    });
  } else {
    droneModels.forEach(d => { d.visible = false; });
  }

  // Screen shake via camera offset
  if (state.shakeX) {
    camera.position.x += state.shakeX * 0.05;
    camera.position.y += (state.shakeY || 0) * 0.03;
  }
}

export function render3d() {
  renderer.render(scene, camera);
}

/**
 * Get car's world-space bounding box for collision.
 * Returns {x, z, halfW, halfD} — center + half-extents.
 */
export function getCarBounds() {
  const box = new THREE.Box3().setFromObject(carModel);
  return {
    x: (box.min.x + box.max.x) / 2,
    z: (box.min.z + box.max.z) / 2,
    halfW: (box.max.x - box.min.x) / 2,
    halfD: (box.max.z - box.min.z) / 2
  };
}

/**
 * Get an object sprite's world position for collision check.
 */
export function getObjectWorldPos(gameZ, gameWx, carPosX) {
  const frac = 1 - gameZ / 200;
  return {
    x: (gameWx - carPosX) * 0.4,
    z: -120 + frac * 125
  };
}

/**
 * Check if a road object collides with the car.
 * Uses the same coordinate mapping as sprite rendering +
 * actual bounding box of the car model.
 * @returns {boolean}
 */
export function checkCollision(gameZ, gameWx, carPosX) {
  // Map object to 3D world (same formula as sprite positioning)
  const frac = 1 - gameZ / 200;
  const objX = (gameWx - carPosX) * 0.4;
  const objZ = -120 + frac * 125;

  // Car bounding box in world space
  const box = new THREE.Box3().setFromObject(carModel);

  // Expand box slightly for object radius
  box.min.x -= 0.3;
  box.max.x += 0.3;
  box.min.z -= 0.3;
  box.max.z += 0.3;

  // Check if object center is inside expanded car box (ignore Y)
  return objX >= box.min.x && objX <= box.max.x &&
         objZ >= box.min.z && objZ <= box.max.z;
}

export function reset3d() {
  tankModel.visible = false;
  droneModels.forEach(d => { d.visible = false; });
  M.steel.color.setHex(0xbbbbdd);
  M.steel.emissive.setHex(0x000000);
  M.steel.emissiveIntensity = 0;
  muzzleLight.intensity = 0;
  // Clear particles
  for (let i = 0; i < PARTICLE_COUNT; i++) pSizes[i] = 0;
}
