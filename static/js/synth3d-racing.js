/**
 * Synthwave Racing — Full 3D with cannon-es physics.
 * Real car movement, curved track, RaycastVehicle, chase cam.
 */
import * as THREE from 'https://esm.sh/three@0.170.0?bundle';
import * as CANNON from 'https://esm.sh/cannon-es@0.20.0?bundle';
import { GLTFLoader } from 'https://esm.sh/three@0.170.0/addons/loaders/GLTFLoader.js?bundle';
import { themes, buildSkyTexture, buildGroundTexture, buildRoadTexture, scatterDecorations } from '/js/racing-themes.js';

let W = window.innerWidth, H = window.innerHeight;

// ═══════════════════════════════════════════
// SCENE + RENDERER
// ═══════════════════════════════════════════
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:1';
document.body.appendChild(renderer.domElement);

// ═══════════════════════════════════════════
// PHYSICS WORLD (theme-agnostic)
// ═══════════════════════════════════════════
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.friction = 0.3;

// Ground (infinite plane) — always present as safety fallback below road
const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

// ═══════════════════════════════════════════
// THEME STATE — everything rebuilt on applyTheme()
// ═══════════════════════════════════════════
const ROAD_WIDTH = 14;
const ROAD_SEGMENTS = 2000;
const BRANCH_SEGMENTS = 600;

const themeGroup = new THREE.Group();
scene.add(themeGroup);
let themeLights = [];
let themeTextures = [];
let themeBodies = [];
let trackCurve = null;
let branchCurve = null;
let sunLight = null;
let currentThemeKey = null;
// Car material refs — mutated per theme (colors only, geometry unchanged)
let underglowMat = null;
let tailMat = null;
// Respawn / checkpoint state
let checkpoints = [];           // [{x, y, z, yaw}, ...] along current track
let respawnTimer = 0;           // seconds remaining of blink effect

// ═══════════════════════════════════════════
// ROAD / EDGE / RAMP BUILDERS (take material params)
// ═══════════════════════════════════════════
function buildRoad(curve, segments, width, material) {
  const pts = curve.getSpacedPoints(segments);
  const frames = curve.computeFrenetFrames(segments, false);
  const verts = [], uvs = [], indices = [];
  for (let i = 0; i <= segments; i++) {
    const p = pts[i];
    const b = frames.binormals[i];
    const right = new THREE.Vector3(b.x, 0, b.z).normalize().multiplyScalar(width / 2);
    verts.push(p.x - right.x, p.y, p.z - right.z);
    verts.push(p.x + right.x, p.y, p.z + right.z);
    uvs.push(0, i / segments * 100);
    uvs.push(1, i / segments * 100);
    if (i < segments) {
      const a = i * 2, b2 = i * 2 + 1, c = (i+1) * 2, d = (i+1) * 2 + 1;
      indices.push(a, c, b2, b2, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return { mesh, pts };
}

function addRoadPhysics(curve, segments, width, step = 6) {
  const bodies = [];
  const halfW = width / 2;
  const boxThickness = 0.4;
  for (let i = 0; i < segments; i += step) {
    const i2 = Math.min(i + step, segments);
    const a = curve.getPointAt(i / segments);
    const b = curve.getPointAt(i2 / segments);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const segLen = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (segLen < 0.01) continue;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const cz = (a.z + b.z) / 2;
    const horizontalLen = Math.sqrt(dx*dx + dz*dz);
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(dy, horizontalLen);
    const shape = new CANNON.Box(new CANNON.Vec3(halfW, boxThickness/2, segLen/2 + 0.1));
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
    body.addShape(shape);
    body.position.set(cx, cy - boxThickness/2, cz);
    const qy = new CANNON.Quaternion(); qy.setFromAxisAngle(new CANNON.Vec3(0,1,0), yaw);
    const qx = new CANNON.Quaternion(); qx.setFromAxisAngle(new CANNON.Vec3(1,0,0), -pitch);
    body.quaternion.copy(qy.mult(qx));
    world.addBody(body);
    bodies.push(body);
  }
  return bodies;
}

function buildEdgeStrip(curve, segments, width, side, color) {
  const pts = curve.getSpacedPoints(segments);
  const frames = curve.computeFrenetFrames(segments, false);
  const verts = [];
  for (let i = 0; i <= segments; i++) {
    const p = pts[i];
    const b = frames.binormals[i];
    const right = new THREE.Vector3(b.x, 0, b.z).normalize().multiplyScalar((width / 2 + 0.2) * side);
    verts.push(p.x + right.x, p.y + 0.3, p.z + right.z);
    verts.push(p.x + right.x, p.y + 0.05, p.z + right.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const idx = [];
  for (let i = 0; i < segments; i++) {
    const a = i*2, b2 = i*2+1, c = (i+1)*2, d = (i+1)*2+1;
    idx.push(a, c, b2, b2, c, d);
  }
  geo.setIndex(idx); geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
}

function addRamp(x, z, width, length, height, yawDeg, matSpec) {
  const shape = new CANNON.Box(new CANNON.Vec3(width/2, height/2, length/2));
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
  body.addShape(shape);
  body.position.set(x, height/2 - 0.05, z);
  body.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), (yawDeg || 0) * Math.PI/180);
  const tilt = new CANNON.Quaternion(); tilt.setFromAxisAngle(new CANNON.Vec3(1,0,0), -0.35);
  body.quaternion = body.quaternion.mult(tilt);
  world.addBody(body);
  const geo = new THREE.BoxGeometry(width, height, length);
  const mat = new THREE.MeshStandardMaterial({
    color: matSpec.color, emissive: matSpec.emissive, emissiveIntensity: matSpec.intensity,
    metalness: 0.3, roughness: 0.6,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(body.position);
  mesh.quaternion.copy(body.quaternion);
  return { body, mesh };
}

// Ground mesh reference (rebuilt per theme)
let groundMesh = null;

// ═══════════════════════════════════════════
// CAR (cannon-es RaycastVehicle)
// ═══════════════════════════════════════════
const chassisShape = new CANNON.Box(new CANNON.Vec3(1, 0.4, 2.2));
const chassisBody = new CANNON.Body({ mass: 1200 });
chassisBody.addShape(chassisShape);
chassisBody.position.set(0, 1, -5);
chassisBody.linearDamping = 0.1;
chassisBody.angularDamping = 0.6;

const vehicle = new CANNON.RaycastVehicle({
  chassisBody,
  indexRightAxis: 0,
  indexUpAxis: 1,
  indexForwardAxis: 2,
});

// Each wheel gets its OWN options object to avoid shared Vec3 reference bugs
function makeWheel(x, y, z) {
  return {
    radius: 0.35,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 30,
    suspensionRestLength: 0.35,
    frictionSlip: 1.5,  // low static value — enables drift (pmndrs/racing-game proven)
    dampingRelaxation: 2.3,
    dampingCompression: 4.4,
    maxSuspensionForce: 100000,
    rollInfluence: 0,
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(x, y, z),
    maxSuspensionTravel: 0.3,
    customSlidingRotationalSpeed: -0.01,
    useCustomSlidingRotationalSpeed: true,
  };
}

// Visual front of car = -Z (headlights). Visual rear = +Z (tail lights).
// cannon-es: indexForwardAxis=2 → +Z is "physics forward"
// We steer front visual wheels (at -Z) and drive rear visual wheels (at +Z)
vehicle.addWheel(makeWheel(-0.9, -0.3, -1.5)); // 0: front-left
vehicle.addWheel(makeWheel( 0.9, -0.3, -1.5)); // 1: front-right
vehicle.addWheel(makeWheel(-0.9, -0.3,  1.3)); // 2: rear-left
vehicle.addWheel(makeWheel( 0.9, -0.3,  1.3)); // 3: rear-right

vehicle.addToWorld(world);

// Baseline wheel friction — set once. Drift disables (sets to 0), exit restores.
vehicle.wheelInfos[0].frictionSlip = 6.0;   // front-left
vehicle.wheelInfos[1].frictionSlip = 6.0;   // front-right
vehicle.wheelInfos[2].frictionSlip = 5.5;   // rear-left
vehicle.wheelInfos[3].frictionSlip = 5.5;   // rear-right

// Car visual — DeLorean body (headlights face -Z, tail faces +Z)
const carGroup = new THREE.Group();
const steelMat = new THREE.MeshStandardMaterial({ color: 0xbbbbdd, metalness: 0.95, roughness: 0.2 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x181820, metalness: 0.4, roughness: 0.7 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x2244aa, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.4 });
// Theme-tinted materials — applyTheme() overwrites .color / .emissive
const neonCyan = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ddff, emissiveIntensity: 6, transparent: true, opacity: 0.7 });
const _tailMat = new THREE.MeshStandardMaterial({ color: 0xff0030, emissive: 0xff0020, emissiveIntensity: 5 });
underglowMat = neonCyan;
tailMat = _tailMat;
// Body
const pts = [[-1.05,0.3],[-1.1,0.5],[-1.1,0.85],[-0.95,1.15],[-0.7,1.38],[-0.5,1.42],[0.5,1.42],[0.7,1.38],[0.95,1.15],[1.1,0.85],[1.1,0.5],[1.05,0.3]].map(p=>new THREE.Vector2(p[0],p[1]));
const bodyMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(pts),{depth:2.2,bevelEnabled:true,bevelSize:0.02,bevelThickness:0.02}), steelMat);
bodyMesh.position.set(0, 0, -1.1); bodyMesh.castShadow = true; carGroup.add(bodyMesh);
// Bumpers
const fb = new THREE.Mesh(new THREE.BoxGeometry(2.2,0.2,0.12), darkMat); fb.position.set(0,0.35,-1.15); carGroup.add(fb);
const rb = new THREE.Mesh(new THREE.BoxGeometry(2.2,0.2,0.12), darkMat); rb.position.set(0,0.35,1.15); carGroup.add(rb);
// Windshield + rear window
const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.6,0.65), glassMat); ws.position.set(0,1.35,-0.4); ws.rotation.x=0.55; carGroup.add(ws);
const rw = new THREE.Mesh(new THREE.PlaneGeometry(1.4,0.5), glassMat); rw.position.set(0,1.28,0.65); rw.rotation.x=-0.35; carGroup.add(rw);
// Louvers
for(let i=0;i<7;i++){const s=new THREE.Mesh(new THREE.BoxGeometry(1.4,0.015,0.04),darkMat);s.position.set(0,1+i*0.04,0.85+i*0.02);s.rotation.x=-0.2;carGroup.add(s)}
// Tail lights
[-0.75,0.75].forEach(x=>{
  const tlM=new THREE.Mesh(new THREE.BoxGeometry(0.35,0.08,0.03),_tailMat);tlM.position.set(x,0.65,1.12);carGroup.add(tlM);
  const tl=new THREE.PointLight(0xff0030,1.5,3);tl.position.set(x,0.65,1.2);carGroup.add(tl);
});
// Headlights
[-0.7,0.7].forEach(x=>{
  const hl=new THREE.Mesh(new THREE.SphereGeometry(0.09,8,8),new THREE.MeshStandardMaterial({color:0xffffcc,emissive:0xffffaa,emissiveIntensity:8}));
  hl.position.set(x,0.7,-1.12);carGroup.add(hl);
  const sl=new THREE.SpotLight(0xffffaa,5,20,0.3,0.5);sl.position.set(x,0.7,-1.2);sl.target.position.set(x,0,-10);carGroup.add(sl);carGroup.add(sl.target);
});
// Underglow
carGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1.8,0.015,2), neonCyan));
const ugLight = new THREE.PointLight(0x00c8ff, 3, 5); ugLight.position.set(0,0.05,0); carGroup.add(ugLight);
[-1.12,1.12].forEach(x=>{const n=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.02,1.8),neonCyan);n.position.set(x,0.08,0);carGroup.add(n)});
// Exhaust
[-0.35,0.35].forEach(x=>{const e=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.05,0.12,8),new THREE.MeshStandardMaterial({color:0x888899,metalness:0.98,roughness:0.1}));e.rotation.x=Math.PI/2;e.position.set(x,0.22,1.16);carGroup.add(e)});
scene.add(carGroup);

// Wheel visuals
const wheelMeshes = [];
for (let i = 0; i < 4; i++) {
  const wm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 0.2, 12),
    new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5, roughness: 0.8 })
  );
  wm.rotation.z = Math.PI / 2;
  scene.add(wm);
  wheelMeshes.push(wm);
}

// Load DeLorean GLB (async replace)
const gltfLoader = new GLTFLoader();
gltfLoader.load('/models/ferrari.glb', () => {}, undefined, () => {}); // preload attempt, ignore if fails

// ═══════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════
window.addEventListener('resize', () => {
  W = innerWidth; H = innerHeight;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H);
});

// ═══════════════════════════════════════════
// THEME APPLY / TEARDOWN
// ═══════════════════════════════════════════
function teardownTheme() {
  // Remove theme-owned physics bodies
  for (const b of themeBodies) world.removeBody(b);
  themeBodies = [];
  // Remove theme-owned lights from scene
  for (const l of themeLights) {
    scene.remove(l);
    l.dispose && l.dispose();
  }
  themeLights = [];
  // Dispose theme-owned textures
  for (const t of themeTextures) t.dispose && t.dispose();
  themeTextures = [];
  // Clear theme group (all meshes inside)
  while (themeGroup.children.length) {
    const child = themeGroup.children[0];
    themeGroup.remove(child);
    child.traverse?.(n => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
        else n.material.dispose();
      }
    });
  }
  if (groundMesh) { scene.remove(groundMesh); groundMesh.geometry.dispose(); groundMesh.material.dispose(); groundMesh = null; }
  scene.background = null;
  scene.fog = null;
  trackCurve = null;
  branchCurve = null;
  sunLight = null;
}

export function applyTheme(key) {
  const cfg = themes[key];
  if (!cfg) { console.warn('[THEME] unknown key:', key); return; }
  teardownTheme();
  currentThemeKey = key;

  // --- SKY ---
  const skyTex = buildSkyTexture(cfg.sky.stops);
  themeTextures.push(skyTex);
  scene.background = skyTex;

  // --- FOG ---
  if (cfg.fog) scene.fog = new THREE.Fog(cfg.fog.color, cfg.fog.near, cfg.fog.far);

  // --- TONE MAPPING ---
  renderer.toneMappingExposure = cfg.toneExposure ?? 1.6;

  // --- LIGHTS ---
  const L = cfg.lights || {};
  if (L.ambient) {
    const a = new THREE.AmbientLight(L.ambient.color, L.ambient.intensity);
    scene.add(a); themeLights.push(a);
  }
  if (L.hemi) {
    const h = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
    scene.add(h); themeLights.push(h);
  }
  if (L.sun) {
    sunLight = new THREE.DirectionalLight(L.sun.color, L.sun.intensity);
    sunLight.position.set(L.sun.position[0], L.sun.position[1], L.sun.position[2]);
    if (L.sun.shadow) {
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(2048, 2048);
      sunLight.shadow.camera.near = 1; sunLight.shadow.camera.far = 300;
      sunLight.shadow.camera.left = -50; sunLight.shadow.camera.right = 50;
      sunLight.shadow.camera.top = 50; sunLight.shadow.camera.bottom = -50;
    }
    scene.add(sunLight); themeLights.push(sunLight);
  }
  for (const ex of (L.extras || [])) {
    if (ex.type === 'directional') {
      const d = new THREE.DirectionalLight(ex.color, ex.intensity);
      d.position.set(ex.position[0], ex.position[1], ex.position[2]);
      scene.add(d); themeLights.push(d);
    }
  }

  // --- SUN SPRITE ---
  for (const s of (cfg.sprites || [])) {
    if (s.type === 'sun') {
      const mat = new THREE.SpriteMaterial({ color: s.color, transparent: true, opacity: s.opacity ?? 0.12, blending: THREE.AdditiveBlending });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(s.position[0], s.position[1], s.position[2]);
      sprite.scale.set(s.scale, s.scale, 1);
      themeGroup.add(sprite);
    }
  }

  // --- STARS ---
  if (cfg.stars && cfg.stars > 0) {
    const geo = new THREE.BufferGeometry();
    const count = cfg.stars;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i*3] = (Math.random()-0.5)*400;
      pos[i*3+1] = Math.random()*80 + 20;
      pos[i*3+2] = -Math.random()*300 - 50;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.2, transparent: true, opacity: 0.5 }));
    themeGroup.add(stars);
  }

  // --- GROUND ---
  const groundTex = buildGroundTexture(cfg.ground.textureBuilder);
  themeTextures.push(groundTex);
  groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ map: groundTex, color: cfg.ground.color }));
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.05;
  scene.add(groundMesh);

  // --- ROAD ---
  const roadTex = buildRoadTexture(cfg.road.textureBuilder);
  themeTextures.push(roadTex);
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex, metalness: 0.1, roughness: 0.8,
    emissive: 0x050010, emissiveIntensity: 0.3,
  });

  trackCurve = new THREE.CatmullRomCurve3(cfg.track.main, false, 'catmullrom', 0.5);
  const mainRoad = buildRoad(trackCurve, ROAD_SEGMENTS, ROAD_WIDTH, roadMat);
  themeGroup.add(mainRoad.mesh);
  themeBodies.push(...addRoadPhysics(trackCurve, ROAD_SEGMENTS, ROAD_WIDTH, 6));

  // Edge strips for main
  themeGroup.add(buildEdgeStrip(trackCurve, ROAD_SEGMENTS, ROAD_WIDTH, 1, cfg.road.edgeColor));
  themeGroup.add(buildEdgeStrip(trackCurve, ROAD_SEGMENTS, ROAD_WIDTH, -1, cfg.road.edgeColor));

  // Branch (optional)
  if (cfg.track.branch && cfg.track.branch.length) {
    branchCurve = new THREE.CatmullRomCurve3(cfg.track.branch, false, 'catmullrom', 0.5);
    const branchRoad = buildRoad(branchCurve, BRANCH_SEGMENTS, ROAD_WIDTH, roadMat);
    themeGroup.add(branchRoad.mesh);
    themeBodies.push(...addRoadPhysics(branchCurve, BRANCH_SEGMENTS, ROAD_WIDTH, 6));
    themeGroup.add(buildEdgeStrip(branchCurve, BRANCH_SEGMENTS, ROAD_WIDTH, 1, cfg.road.edgeColor));
    themeGroup.add(buildEdgeStrip(branchCurve, BRANCH_SEGMENTS, ROAD_WIDTH, -1, cfg.road.edgeColor));
  }

  // --- RAMPS ---
  for (const r of (cfg.track.rampSpecs || [])) {
    const { body, mesh } = addRamp(r.x, r.z, r.w, r.l, r.h, r.yawDeg, cfg.ramps);
    themeBodies.push(body);
    themeGroup.add(mesh);
  }

  // --- DECORATIONS ---
  scatterDecorations(themeGroup, cfg.decorations || [], trackCurve, branchCurve);

  // --- CHECKPOINTS — sample along main track every ~400m ---
  {
    const totalLen = trackCurve.getLength();
    const spacing = 400;
    const count = Math.max(3, Math.ceil(totalLen / spacing));
    checkpoints = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const p = trackCurve.getPointAt(t);
      const pNext = trackCurve.getPointAt(Math.min(1, t + 0.002));
      const dx = pNext.x - p.x, dz = pNext.z - p.z;
      const yaw = Math.atan2(dx, -dz);
      checkpoints.push({ x: p.x, y: p.y + 1.5, z: p.z, yaw });
    }
    // Visual markers (small floating neon rings)
    for (const cp of checkpoints) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.5, 0.18, 8, 24),
        new THREE.MeshStandardMaterial({
          color: cfg.hud?.accent2 || 0xffff00,
          emissive: cfg.hud?.accent2 || 0xffff00,
          emissiveIntensity: 2,
          transparent: true, opacity: 0.65,
        })
      );
      ring.position.set(cp.x, cp.y + 1.2, cp.z);
      ring.rotation.x = Math.PI / 2;
      themeGroup.add(ring);
    }
  }

  // --- CAR MATERIALS ---
  if (underglowMat && cfg.car) {
    underglowMat.color.setHex(cfg.car.underglow);
    underglowMat.emissive.setHex(cfg.car.underglow);
  }
  if (tailMat && cfg.car) {
    tailMat.color.setHex(cfg.car.tail);
    tailMat.emissive.setHex(cfg.car.tail);
  }

  // --- HUD CSS VARS ---
  const root = document.documentElement;
  const h = cfg.hud || {};
  if (h.accent1) root.style.setProperty('--accent-1', h.accent1);
  if (h.accent2) root.style.setProperty('--accent-2', h.accent2);
  if (h.bg)      root.style.setProperty('--bg',       h.bg);
  if (h.glow)    root.style.setProperty('--glow',     h.glow);
  document.body.className = 'theme-' + key;

  // --- TITLE + SPAWN ---
  const titleEl = document.getElementById('title');
  if (titleEl) titleEl.textContent = cfg.label.toUpperCase() + ' RACING';
  resetCar();
  console.log('[THEME] applied:', key, '| road bodies:', themeBodies.length, '| lights:', themeLights.length);
}

export function setTheme(key) { applyTheme(key); }
export function getCurrentTheme() { return currentThemeKey; }
export function getThemeKeys() { return Object.keys(themes); }
export function getThemes() { return themes; }

// ═══════════════════════════════════════════
// RESPAWN / CHECKPOINTS
// ═══════════════════════════════════════════
function setCarAlpha(alpha) {
  carGroup.traverse(obj => {
    if (!obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (m._origOpacity === undefined) m._origOpacity = m.opacity;
      if (m._origTransparent === undefined) m._origTransparent = m.transparent;
      if (alpha >= 1) {
        m.transparent = m._origTransparent;
        m.opacity = m._origOpacity;
      } else {
        m.transparent = true;
        m.opacity = alpha * m._origOpacity;
      }
    }
  });
}

export function respawnToNearestCheckpoint() {
  if (!checkpoints.length) return;
  const pos = chassisBody.position;
  let best = checkpoints[0], bestD = Infinity;
  for (const cp of checkpoints) {
    const dx = cp.x - pos.x, dz = cp.z - pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = cp; }
  }
  chassisBody.position.set(best.x, best.y, best.z);
  chassisBody.velocity.set(0, 0, 0);
  chassisBody.angularVelocity.set(0, 0, 0);
  chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -best.yaw);
  chassisBody.wakeUp();
  // Also clear drift state
  driftActive = false;
  driftArmed = false;
  driftSpeed = 0;
  driftChassisAngle = 0;
  smoothSteer = 0;
  driftCooldown = 0.2;
  vehicle.wheelInfos[0].frictionSlip = BASE_FRONT_GRIP;
  vehicle.wheelInfos[1].frictionSlip = BASE_FRONT_GRIP;
  vehicle.wheelInfos[2].frictionSlip = BASE_REAR_GRIP;
  vehicle.wheelInfos[3].frictionSlip = BASE_REAR_GRIP;
  respawnTimer = 2.0;
  console.log('[RESPAWN] checkpoint:', best.x.toFixed(0), best.z.toFixed(0));
}

// ═══════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════

const MAX_STEER = 0.45;
const MAX_FORCE = 4200;
const BRAKE_FORCE = 60;
const REVERSE_FORCE = 1200;
const MAX_SPEED_KMH = 250;
const MAX_SPEED_MS = MAX_SPEED_KMH / 3.6;  // ≈ 69.44 m/s
const BOOST_SPEED_CAP = MAX_SPEED_KMH;     // thrust drops above this
// Quadratic air drag — F_drag = C·v² (Marco Monster, x-engineer). C tuned so drag
// balances engine thrust at ~MAX_SPEED_KMH → natural terminal velocity
const AIR_DRAG_C = 0.0014;

// ═══════════════════════════════════════════
// SIGN CONVENTIONS (don't flip without reading this)
// ─ Visual forward = local −Z in chassis frame
// ─ World yaw θ: 0 faces −Z; POSITIVE = right (CW viewed from above)
// ─ steerInput = input.left - input.right (positive on LEFT key)
// ─ driftChassisAngle > 0 = right drift (chassis rotated CW from trajectory)
// ─ cannon-es setFromAxisAngle(+Y, α) is CCW — so quaternion uses α = -θ
// ═══════════════════════════════════════════

let smoothSteer = 0;
let drifting = false;
let driftActive = false;
let driftArmed = false;        // latched once |driftChassisAngle| > ENGAGE_SLIP
let driftCooldown = 0;         // seconds — blocks re-entry right after exit

// Drift state — three scalar values that fully describe the slide
let driftDirAngle = 0;         // world yaw of trajectory direction (rad, CW-positive)
let driftChassisAngle = 0;     // chassis yaw offset from trajectory (rad, clamped ±MAX_SLIP)
let driftSpeed = 0;            // m/s along driftDirAngle
let driftCounter = 0;          // Mario Kart-style spark counter, accumulates while drifting
let lastMiniTurbo = 0;         // m/s boost applied on last exit (HUD feedback)

let driftAngle = 0;            // cosmetic visual tilt (independent of physics)
let slipAngle = 0;             // HUD mirror — equals driftChassisAngle in drift, computed otherwise

const MAX_SLIP = 30 * Math.PI / 180;      // ~0.52 rad hard cap
const ENGAGE_SLIP = 5 * Math.PI / 180;    // slip must exceed this to arm the drift
const EXIT_SLIP = 3 * Math.PI / 180;      // once armed, drift ends when slip drops below
const BASE_FRONT_GRIP = 6.0;
const BASE_REAR_GRIP = 5.5;
const Y_AXIS_CANNON = new CANNON.Vec3(0, 1, 0);

function getCarForward() {
  return chassisBody.quaternion.vmult(new CANNON.Vec3(0, 0, -1));
}

function getForwardSpeed() {
  return chassisBody.velocity.dot(getCarForward());
}

export function step(dt, input) {
  const vel = chassisBody.velocity;
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z) * 3.6;
  const forwardSpeed = getForwardSpeed();
  const steerInput = input.left - input.right;

  // ── MODE & COOLDOWN ──
  const wasDrifting = driftActive;
  if (driftCooldown > 0) driftCooldown = Math.max(0, driftCooldown - dt);

  // ── FRESH ENTRY ──
  // Physics-based: reduce grip, keep engine/steer/brake active. No kinematic override.
  // Ref: Need for Speed / Forza Horizon — low rear grip + yaw assist torque.
  if (!driftActive && input.ebrake && driftCooldown <= 0 && speed > 12) {
    driftActive = true;
    driftArmed = false;
    driftCounter = 0;
    lastMiniTurbo = 0;
    // Reduce rear grip drastically — rear wheels slip → natural drift
    // Front grip reduced slightly so chassis rotates freer
    vehicle.wheelInfos[0].frictionSlip = 3.0;
    vehicle.wheelInfos[1].frictionSlip = 3.0;
    vehicle.wheelInfos[2].frictionSlip = 0.6;
    vehicle.wheelInfos[3].frictionSlip = 0.6;
    console.log('[DRIFT ENTER]', { speed: +speed.toFixed(1) });
  }

  // ── SLIP ANGLE (always computed from real physics; sign: >0 = right drift) ──
  const vMagFlat = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (vMagFlat > 2) {
    const fwd = getCarForward();
    const dot = fwd.x * vel.x + fwd.z * vel.z;
    const cross = fwd.x * vel.z - fwd.z * vel.x;
    slipAngle = -Math.atan2(cross, dot);
  } else {
    slipAngle = 0;
  }

  // ── DRIFT UPDATE: yaw-assist torque + mini-turbo counter ──
  if (driftActive) {
    // Yaw assist — apply torque around Y so arcade players can rotate chassis easily.
    // Scales with speed (more at high), dampens at very high speeds to prevent spins.
    // steer=-1 (right) → want negative world yaw → cannon Y-axis torque positive (CCW in cannon → CW in world).
    const assistMag = 11000;
    const speedScale = Math.min(1, speed / 45);       // ramp up to full by 45 km/h
    const highSpeedDamp = Math.max(0.55, 1 - speed / 400); // reduce assist at very high speeds
    const yawTorque = -steerInput * assistMag * speedScale * highSpeedDamp;
    chassisBody.torque.y += yawTorque;

    // Engine thrust continues normally — no override. Throttle in drift still accelerates.
    // Counter-steer damping: if player inputs opposite of current slip, kill angular velocity faster.
    const slipSign = Math.sign(slipAngle);
    const steerSign = Math.sign(steerInput);
    if (slipSign !== 0 && steerSign !== 0 && slipSign !== steerSign) {
      // Counter-steering — help car straighten by reducing yaw velocity
      chassisBody.angularVelocity.y *= Math.max(0, 1 - dt * 3);
    }

    // Mini-turbo counter based on actual slip magnitude
    const slipDeg = Math.abs(slipAngle) * 180 / Math.PI;
    if (slipDeg > 5) {
      driftArmed = true;
      const rate = slipDeg > 20 ? 5 : 2;
      driftCounter += rate * dt;
    }

    // Cosmetic body tilt — tiny accent since physics already rotates chassis
    driftAngle += (slipAngle * 0.12 - driftAngle) * Math.min(1, dt * 6);
  } else {
    driftAngle *= Math.max(0, 1 - dt * 10);
  }

  // ── EXIT ──
  if (driftActive) {
    if (!input.ebrake) driftActive = false;
    if (speed < 5) driftActive = false;
  }

  if (wasDrifting && !driftActive) {
    // Mini-turbo boost: impulse along current velocity direction
    let boostAmount = 0;
    if (driftArmed && driftCounter >= 3.5) boostAmount = 14;
    else if (driftArmed && driftCounter >= 2.5) boostAmount = 9;
    else if (driftArmed && driftCounter >= 1.5) boostAmount = 5;
    if (boostAmount > 0) {
      const vL = Math.sqrt(chassisBody.velocity.x * chassisBody.velocity.x + chassisBody.velocity.z * chassisBody.velocity.z);
      if (vL > 0.1) {
        chassisBody.velocity.x += (chassisBody.velocity.x / vL) * boostAmount;
        chassisBody.velocity.z += (chassisBody.velocity.z / vL) * boostAmount;
      }
      lastMiniTurbo = boostAmount;
    }
    // Restore wheel grip — physics resumes natural stability
    vehicle.wheelInfos[0].frictionSlip = BASE_FRONT_GRIP;
    vehicle.wheelInfos[1].frictionSlip = BASE_FRONT_GRIP;
    vehicle.wheelInfos[2].frictionSlip = BASE_REAR_GRIP;
    vehicle.wheelInfos[3].frictionSlip = BASE_REAR_GRIP;
    driftCooldown = 0.3;
    chassisBody.wakeUp();
    console.log('[DRIFT EXIT]', {
      reason: speed < 5 ? 'speed<5' : !driftArmed ? 'released-unarmed' : 'released',
      slipDeg: +(slipAngle * 180 / Math.PI).toFixed(1),
      speed: +speed.toFixed(1),
      counter: +driftCounter.toFixed(2),
      boost: boostAmount,
    });
  }

  drifting = driftActive;

  // ── CONTROLS (always active — drift just changes grip + adds yaw assist) ──
  // Steering: speed-sensitive, more smoothing at high speed.
  const speedFactor = Math.max(0.2, 1 - (speed / MAX_SPEED_KMH) * 0.8);
  const steerTarget = steerInput * MAX_STEER * speedFactor;
  const smoothRate = Math.max(2.5, 8 - speed / 40);
  smoothSteer += (steerTarget - smoothSteer) * Math.min(1, dt * smoothRate);
  vehicle.setSteeringValue(smoothSteer, 0);
  vehicle.setSteeringValue(smoothSteer, 1);

  // Engine / brake / reverse
  const boostMul = speed < BOOST_SPEED_CAP ? 1 + (1 - speed / BOOST_SPEED_CAP) * 0.6 : 1;
  if (input.throttle) {
    const f = MAX_FORCE * boostMul;
    vehicle.applyEngineForce(f, 2);
    vehicle.applyEngineForce(f, 3);
    for (let i = 0; i < 4; i++) vehicle.setBrake(0, i);
  } else if (input.brake) {
    if (forwardSpeed > 1) {
      for (let i = 0; i < 4; i++) vehicle.setBrake(BRAKE_FORCE, i);
      vehicle.applyEngineForce(0, 2);
      vehicle.applyEngineForce(0, 3);
    } else {
      for (let i = 0; i < 4; i++) vehicle.setBrake(0, i);
      vehicle.applyEngineForce(-REVERSE_FORCE, 2);
      vehicle.applyEngineForce(-REVERSE_FORCE, 3);
    }
  } else {
    vehicle.applyEngineForce(0, 2);
    vehicle.applyEngineForce(0, 3);
    for (let i = 0; i < 4; i++) vehicle.setBrake(drifting ? 0 : 6, i);
  }

  // Quadratic air drag
  {
    const vx = chassisBody.velocity.x, vz = chassisBody.velocity.z;
    const vMag2 = vx * vx + vz * vz;
    const vMag = Math.sqrt(vMag2);
    if (vMag > 1) {
      const dragAccel = AIR_DRAG_C * vMag2;
      const factor = Math.max(0, 1 - (dragAccel / vMag) * dt);
      chassisBody.velocity.x *= factor;
      chassisBody.velocity.z *= factor;
    }
    const vMag2b = chassisBody.velocity.x * chassisBody.velocity.x + chassisBody.velocity.z * chassisBody.velocity.z;
    if (vMag2b > MAX_SPEED_MS * MAX_SPEED_MS) {
      const scale = MAX_SPEED_MS / Math.sqrt(vMag2b);
      chassisBody.velocity.x *= scale;
      chassisBody.velocity.z *= scale;
    }
  }

  // Anti-rollover
  chassisBody.angularVelocity.x *= 0.92;
  chassisBody.angularVelocity.z *= 0.92;

  // ── PHYSICS STEP ──
  world.step(1 / 60, dt, 3);

  // ── SYNC VISUALS ──
  // Position: always from physics
  carGroup.position.copy(chassisBody.position);
  // Rotation: physics + visual drift offset
  carGroup.quaternion.copy(chassisBody.quaternion);
  if (Math.abs(driftAngle) > 0.01) {
    carGroup.rotateY(driftAngle);
  }

  for (let i = 0; i < 4; i++) {
    vehicle.updateWheelTransform(i);
    const t = vehicle.wheelInfos[i].worldTransform;
    wheelMeshes[i].position.copy(t.position);
    wheelMeshes[i].quaternion.copy(t.quaternion);
  }

  // ── CHASE CAMERA ──
  const carPos = chassisBody.position;
  const carQuat = chassisBody.quaternion;
  const camLocalOffset = new CANNON.Vec3(0, 3.5, 8);
  const camWorldOffset = carQuat.vmult(camLocalOffset);
  const camTarget = new THREE.Vector3(
    carPos.x + camWorldOffset.x,
    Math.max(carPos.y + camWorldOffset.y, 2),
    carPos.z + camWorldOffset.z
  );
  const camLag = drifting ? 3 : 5;
  camera.position.lerp(camTarget, Math.min(1, dt * camLag));
  camera.lookAt(carPos.x, carPos.y + 1, carPos.z);

  sunLight.position.set(carPos.x, carPos.y + 50, carPos.z - 50);
  sunLight.target.position.set(carPos.x, carPos.y, carPos.z);

  const progress = Math.max(0, Math.min(1, -carPos.z / 2100));

  // ── RESPAWN BLINK EFFECT ──
  if (respawnTimer > 0) {
    respawnTimer -= dt;
    // 8Hz flicker between low and mid opacity
    const phase = Math.floor(respawnTimer * 16) % 2;
    const alpha = phase === 0 ? 0.55 : 0.15;
    setCarAlpha(alpha);
    if (respawnTimer <= 0) setCarAlpha(1);
  }

  const slipDeg = slipAngle * 180 / Math.PI;
  return {
    speed: Math.round(speed),
    position: { x: carPos.x, y: carPos.y, z: carPos.z },
    progress,
    isDrifting: drifting,
    driftAngle,
    driftAngleDeg: Math.round(Math.abs(slipDeg)),
    // slipDir > 0 = right drift (chassis rotated CW from trajectory)
    slipDir: slipAngle > 0.02 ? 1 : slipAngle < -0.02 ? -1 : 0,
    debug: {
      cooldown: +driftCooldown.toFixed(2),
      armed: driftArmed,
      driftSpd: Math.round(Math.sqrt(chassisBody.velocity.x * chassisBody.velocity.x + chassisBody.velocity.z * chassisBody.velocity.z) * 3.6),
      counter: +driftCounter.toFixed(2),
      lastBoost: lastMiniTurbo,
    },
  };
}

export function render() {
  renderer.render(scene, camera);
}

export function getTrackPoints2D() {
  if (!trackCurve) return [];
  return trackCurve.getSpacedPoints(200).map(p => ({ x: p.x, z: p.z }));
}

export function resetCar() {
  const cfg = themes[currentThemeKey];
  const sp = cfg?.track?.spawn?.pos || [0, 1, -5];
  chassisBody.position.set(sp[0], sp[1], sp[2]);
  chassisBody.velocity.set(0, 0, 0);
  chassisBody.angularVelocity.set(0, 0, 0);
  chassisBody.quaternion.set(0, 0, 0, 1);
  driftActive = false;
  driftArmed = false;
  driftCooldown = 0;
  driftSpeed = 0;
  driftDirAngle = 0;
  driftChassisAngle = 0;
  driftCounter = 0;
  lastMiniTurbo = 0;
  driftAngle = 0;
  slipAngle = 0;
  smoothSteer = 0;
  // Restore wheel grip in case reset fires mid-drift
  vehicle.wheelInfos[0].frictionSlip = BASE_FRONT_GRIP;
  vehicle.wheelInfos[1].frictionSlip = BASE_FRONT_GRIP;
  vehicle.wheelInfos[2].frictionSlip = BASE_REAR_GRIP;
  vehicle.wheelInfos[3].frictionSlip = BASE_REAR_GRIP;
}

// Apply default theme on module load (after all classes + functions + API are defined)
applyTheme('neonwave');
