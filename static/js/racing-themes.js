// Racing themes — data-driven scene configs.
// Each theme defines sky, lights, ground/road materials, track layout, and decorations.
// Consumed by synth3d-racing.js applyTheme().
import * as THREE from 'https://esm.sh/three@0.170.0?bundle';

// ═══════════════════════════════════════════
// TEXTURE BUILDERS (canvas-based)
// ═══════════════════════════════════════════

export function buildSkyTexture(stops) {
  const c = document.createElement('canvas'); c.width = 2; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  for (const [pos, col] of stops) g.addColorStop(pos, col);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

const groundBuilders = {
  'neonwave-grid'() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#0c0016'; x.fillRect(0, 0, 512, 512);
    x.strokeStyle = '#ff00cc'; x.lineWidth = 2; x.globalAlpha = 0.4;
    for (let i = 0; i <= 20; i++) {
      const p = i * 512 / 20;
      x.beginPath(); x.moveTo(p, 0); x.lineTo(p, 512); x.stroke();
      x.beginPath(); x.moveTo(0, p); x.lineTo(512, p); x.stroke();
    }
    return c;
  },
  grass() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#2d4a1a'; x.fillRect(0, 0, 512, 512);
    // Noise patches
    for (let i = 0; i < 3000; i++) {
      const px = Math.random() * 512, py = Math.random() * 512;
      const shade = 0x40 + Math.floor(Math.random() * 0x50);
      x.fillStyle = `rgb(${shade - 20},${shade + 30},${shade - 20})`;
      x.fillRect(px, py, 2, 2);
    }
    return c;
  },
  cobble() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#3a3a3a'; x.fillRect(0, 0, 512, 512);
    x.strokeStyle = '#1a1a1a'; x.lineWidth = 1;
    for (let r = 0; r < 16; r++) {
      const off = (r % 2) * 16;
      for (let col = 0; col < 16; col++) {
        x.fillStyle = '#4a4a4a';
        x.fillRect(col * 32 + off, r * 32, 30, 30);
        x.strokeRect(col * 32 + off, r * 32, 30, 30);
      }
    }
    return c;
  },
  snow() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#e8f0f8'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2000; i++) {
      const px = Math.random() * 512, py = Math.random() * 512;
      const shade = 220 + Math.floor(Math.random() * 30);
      x.fillStyle = `rgb(${shade},${shade},${shade + 5})`;
      x.fillRect(px, py, 2, 2);
    }
    return c;
  },
  'tokyo-tile'() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#15151f'; x.fillRect(0, 0, 512, 512);
    x.strokeStyle = '#2a2a3a'; x.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const p = i * 64;
      x.beginPath(); x.moveTo(p, 0); x.lineTo(p, 512); x.stroke();
      x.beginPath(); x.moveTo(0, p); x.lineTo(512, p); x.stroke();
    }
    return c;
  },
  sand() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#d4a85a'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4000; i++) {
      const px = Math.random() * 512, py = Math.random() * 512;
      const shade = 0xa0 + Math.floor(Math.random() * 0x40);
      x.fillStyle = `rgb(${shade + 30},${shade},${shade - 30})`;
      x.fillRect(px, py, 2, 2);
    }
    return c;
  },
};

export function buildGroundTexture(key) {
  const fn = groundBuilders[key] || groundBuilders['neonwave-grid'];
  const canvas = fn();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(100, 100);
  return tex;
}

const roadBuilders = {
  neon() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#0e0020'; x.fillRect(0, 0, 128, 512);
    x.fillStyle = 'rgba(255,255,255,0.08)';
    for (let d = 0; d < 512; d += 32) x.fillRect(62, d, 4, 16);
    x.fillStyle = '#ff00b4'; x.fillRect(0, 0, 3, 512); x.fillRect(125, 0, 3, 512);
    x.fillStyle = 'rgba(0,200,255,0.2)'; x.fillRect(32, 0, 1, 512); x.fillRect(95, 0, 1, 512);
    return c;
  },
  'asphalt-light'() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#3a3a3a'; x.fillRect(0, 0, 128, 512);
    x.fillStyle = 'rgba(255,255,255,0.35)';
    for (let d = 0; d < 512; d += 40) x.fillRect(62, d, 4, 22);
    x.fillStyle = 'rgba(255,255,255,0.5)';
    x.fillRect(2, 0, 3, 512); x.fillRect(123, 0, 3, 512);
    return c;
  },
  'cobble-road'() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#5a5050'; x.fillRect(0, 0, 128, 512);
    x.strokeStyle = '#2a2020'; x.lineWidth = 1;
    for (let r = 0; r < 32; r++) {
      for (let col = 0; col < 8; col++) {
        const off = (r % 2) * 8;
        x.fillStyle = `rgb(${70 + Math.random() * 30},${60 + Math.random() * 25},${60 + Math.random() * 25})`;
        x.fillRect(col * 16 + off, r * 16, 14, 14);
        x.strokeRect(col * 16 + off, r * 16, 14, 14);
      }
    }
    return c;
  },
  ice() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#b8d0e0'; x.fillRect(0, 0, 128, 512);
    x.fillStyle = 'rgba(255,255,255,0.3)';
    for (let d = 0; d < 512; d += 50) x.fillRect(60, d, 8, 4);
    x.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < 200; i++) {
      x.fillRect(Math.random() * 128, Math.random() * 512, 2, 1);
    }
    return c;
  },
  'tokyo-asphalt'() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#1a1a22'; x.fillRect(0, 0, 128, 512);
    x.fillStyle = 'rgba(255,255,100,0.4)';
    for (let d = 0; d < 512; d += 30) x.fillRect(62, d, 4, 18);
    x.fillStyle = '#ff0088'; x.fillRect(0, 0, 2, 512); x.fillRect(126, 0, 2, 512);
    return c;
  },
  'sand-path'() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#b08850'; x.fillRect(0, 0, 128, 512);
    for (let i = 0; i < 300; i++) {
      const shade = 0x88 + Math.floor(Math.random() * 0x30);
      x.fillStyle = `rgb(${shade + 30},${shade + 10},${shade - 20})`;
      x.fillRect(Math.random() * 128, Math.random() * 512, 3, 2);
    }
    return c;
  },
};

export function buildRoadTexture(key) {
  const fn = roadBuilders[key] || roadBuilders.neon;
  const canvas = fn();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ═══════════════════════════════════════════
// DECORATION BUILDERS (return Object3D)
// ═══════════════════════════════════════════

function buildTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.4, 2.5, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.9 })
  );
  trunk.position.y = 1.25;
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 5, 8),
    new THREE.MeshStandardMaterial({ color: 0x2d5c1e, roughness: 0.8 })
  );
  crown.position.y = 4;
  g.add(trunk); g.add(crown);
  return g;
}

function buildPine() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.3, 1.5, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a2518, roughness: 0.9 })
  );
  trunk.position.y = 0.75;
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0x1a4a28, roughness: 0.85 })
  );
  crown.position.y = 4;
  g.add(trunk); g.add(crown);
  return g;
}

function buildBuilding(height, windowColor = 0xffcc44) {
  const g = new THREE.Group();
  const w = 6 + Math.random() * 6;
  const d = 6 + Math.random() * 6;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, height, d),
    new THREE.MeshStandardMaterial({ color: 0x2a2a35, roughness: 0.85, metalness: 0.2 })
  );
  body.position.y = height / 2;
  g.add(body);
  // Window grid via emissive plane on each side
  const winMat = new THREE.MeshStandardMaterial({
    color: windowColor, emissive: windowColor, emissiveIntensity: 1.5,
    transparent: true, opacity: 0.85
  });
  const rows = Math.floor(height / 2);
  const cols = Math.floor(w / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() > 0.4) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2), winMat);
        win.position.set(-w/2 + 1 + c * 2, 1.5 + r * 2, d/2 + 0.02);
        g.add(win);
        const winB = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2), winMat);
        winB.position.set(-w/2 + 1 + c * 2, 1.5 + r * 2, -d/2 - 0.02);
        winB.rotation.y = Math.PI;
        g.add(winB);
      }
    }
  }
  return g;
}

function buildStar(scale = 2, emissiveColor = 0xff0030) {
  // 5-pointed star via cone stars from ExtrudeGeometry
  const shape = new THREE.Shape();
  const spikes = 5, outer = 1, inner = 0.4;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false });
  const mat = new THREE.MeshStandardMaterial({
    color: emissiveColor, emissive: emissiveColor, emissiveIntensity: 3, metalness: 0.6
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(scale);
  return mesh;
}

function buildPalm() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.3, 4, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 })
  );
  trunk.position.y = 2;
  g.add(trunk);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x7aa63a, side: THREE.DoubleSide, roughness: 0.8 })
    );
    leaf.position.y = 4;
    leaf.rotation.y = (i / 6) * Math.PI * 2;
    leaf.rotation.z = -0.4;
    leaf.position.x = Math.cos(leaf.rotation.y) * 0.8;
    leaf.position.z = Math.sin(leaf.rotation.y) * 0.8;
    g.add(leaf);
  }
  return g;
}

function buildCactus() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.85 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 2.5, 8), mat);
  trunk.position.y = 1.25;
  g.add(trunk);
  if (Math.random() > 0.5) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1, 6), mat);
    arm.position.set(0.5, 1.5, 0); arm.rotation.z = -1;
    g.add(arm);
  }
  return g;
}

function buildDune(w = 12, h = 4) {
  const geo = new THREE.SphereGeometry(w, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.scale(1, h / w, 1.4);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc08050, roughness: 0.95 }));
  return mesh;
}

// Road-distance culling helper: samples curves, returns min-distance function in XZ
function roadDistanceFn(curves, samples = 120) {
  const pts = [];
  for (const c of curves) {
    if (!c) continue;
    const sp = c.getSpacedPoints(samples);
    for (const p of sp) pts.push(p);
  }
  return (x, z) => {
    let min = Infinity;
    for (const p of pts) {
      const dx = x - p.x, dz = z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < min) min = d2;
    }
    return Math.sqrt(min);
  };
}

const decoFactories = {
  tree: buildTree,
  pine: buildPine,
  building: (spec) => buildBuilding(spec.height || (15 + Math.random() * 25), spec.windowColor || 0xffcc44),
  star: (spec) => buildStar(spec.scale || 2, spec.color || 0xff0030),
  palm: buildPalm,
  cactus: buildCactus,
  dune: (spec) => buildDune(spec.width || 12, spec.height || 4),
};

export function scatterDecorations(group, specs, trackCurve, branchCurve) {
  if (!specs || !specs.length) return;
  const distFn = roadDistanceFn([trackCurve, branchCurve]);
  for (const spec of specs) {
    const [xMin, xMax, zMin, zMax] = spec.spread;
    const minRoadDist = spec.minRoadDist || 20;
    let placed = 0, attempts = 0;
    while (placed < spec.count && attempts < spec.count * 5) {
      attempts++;
      const x = xMin + Math.random() * (xMax - xMin);
      const z = zMin + Math.random() * (zMax - zMin);
      if (distFn(x, z) < minRoadDist) continue;
      const factory = decoFactories[spec.type];
      if (!factory) break;
      const obj = factory(spec);
      obj.position.set(x, spec.y || 0, z);
      obj.rotation.y = Math.random() * Math.PI * 2;
      const s = (spec.scaleMin || 0.8) + Math.random() * ((spec.scaleMax || 1.2) - (spec.scaleMin || 0.8));
      obj.scale.setScalar(s);
      group.add(obj);
      placed++;
    }
  }
}

// ═══════════════════════════════════════════
// TRACK LAYOUTS — one per theme
// ═══════════════════════════════════════════

const neonwaveTrack = [
  [0, 0, 0], [0, 0, -60], [5, 0, -140], [0, 0, -220],
  [-8, 6, -310], [0, 12, -400], [10, 8, -480],
  [20, 2, -560], [35, 4, -640], [30, 10, -720],
  [15, 18, -810], [-5, 22, -900], [-25, 18, -990],
  [-45, 10, -1070], [-35, 20, -1150], [-10, 25, -1230],
  [20, 22, -1300], [30, 14, -1380], [10, 8, -1460],
  [-20, 4, -1540], [-30, 2, -1620], [-15, 1, -1720],
  [10, 3, -1800], [20, 0, -1880],
  [8, 0, -1960], [-8, 0, -2020], [0, 0, -2100],
];
const neonwaveBranch = [
  [35, 4, -640], [60, 6, -700], [80, 10, -790],
  [85, 14, -880], [70, 16, -970], [50, 12, -1060],
  [30, 18, -1140], [20, 22, -1220],
];

const forestTrack = [
  [0, 0, 0], [3, 0, -50], [8, 2, -110], [15, 4, -180],
  [25, 8, -260], [20, 12, -350], [5, 15, -430],
  [-15, 10, -500], [-25, 6, -580], [-20, 8, -660],
  [-5, 12, -740], [15, 16, -820], [30, 20, -900],
  [40, 15, -990], [35, 10, -1080], [15, 8, -1160],
  [-10, 6, -1240], [-25, 4, -1320], [-15, 2, -1400],
  [5, 1, -1480], [20, 0, -1560], [10, 0, -1640],
  [0, 0, -1720], [0, 0, -1800],
];

// Moscow: short urban loop with tighter corners
const moscowTrack = [
  [0, 0, 0], [0, 0, -60], [-5, 0, -120],
  [-20, 0, -180], [-40, 0, -220], [-50, 0, -280],
  [-45, 0, -360], [-30, 0, -420], [-10, 0, -460],
  [15, 0, -480], [40, 0, -470], [60, 0, -440],
  [70, 0, -380], [70, 0, -300], [60, 0, -240],
  [45, 0, -180], [25, 0, -120], [10, 0, -60],
  [0, 0, -30], [0, 0, 0],
];

const arcticTrack = [
  [0, 0, 0], [0, 0, -80], [3, 0, -180],
  [8, 0, -280], [5, 0, -400], [-3, 0, -520],
  [0, 0, -650], [10, 0, -780], [15, 0, -900],
  [10, 0, -1020], [0, 0, -1140], [-8, 0, -1260],
  [-5, 0, -1380], [3, 0, -1500], [8, 0, -1620],
  [5, 0, -1740], [0, 0, -1860], [0, 0, -2000],
];

// Tokyo: tight hairpins
const tokyoTrack = [
  [0, 0, 0], [0, 0, -60], [15, 0, -100],
  [40, 0, -120], [55, 0, -160], [55, 0, -220],
  [40, 0, -280], [15, 0, -310], [-10, 0, -320],
  [-35, 0, -340], [-45, 0, -390], [-40, 0, -460],
  [-20, 0, -510], [5, 0, -530], [30, 0, -560],
  [40, 0, -620], [30, 0, -690], [10, 0, -740],
  [-10, 0, -780], [-5, 0, -860], [5, 0, -940],
  [0, 0, -1040], [0, 0, -1150], [0, 0, -1300],
  [0, 0, -1500],
];

// Desert: long straights with dune humps
const desertTrack = [
  [0, 0, 0], [0, 2, -120], [5, 5, -260],
  [2, 3, -400], [-5, 1, -540], [0, 4, -680],
  [10, 6, -820], [15, 3, -960], [8, 1, -1100],
  [-5, 2, -1240], [-12, 5, -1380], [-8, 3, -1520],
  [0, 1, -1660], [8, 0, -1800], [12, 0, -1940],
  [5, 0, -2080], [0, 0, -2200],
];

function toVec3(arr) { return arr.map(p => new THREE.Vector3(p[0], p[1], p[2])); }

// ═══════════════════════════════════════════
// THEME CONFIGS
// ═══════════════════════════════════════════

export const themes = {
  neonwave: {
    key: 'neonwave', label: 'Neonwave',
    toneExposure: 1.6,
    sky: { stops: [[0,'#020008'],[0.3,'#08001a'],[0.55,'#1a0038'],[0.8,'#3d0058'],[1,'#0a0015']] },
    fog: null,
    lights: {
      ambient: { color: 0x6644ff, intensity: 2.0 },
      hemi:    { sky: 0x4400cc, ground: 0x220044, intensity: 1.5 },
      sun:     { color: 0xff6688, intensity: 3, position: [0, 50, -100], shadow: true },
      extras: [
        { type: 'directional', color: 0x8888ff, intensity: 1.5, position: [-5, 5, 8] },
        { type: 'directional', color: 0xff00b4, intensity: 2,   position: [3, 2, -5] },
        { type: 'directional', color: 0x00ccff, intensity: 0.8, position: [0, -3, 0] },
      ],
    },
    ground: { color: 0x0c0016, textureBuilder: 'neonwave-grid' },
    road: { textureBuilder: 'neon', edgeColor: 0xff00b4, edgeOpacity: 1 },
    ramps: { color: 0xff00b4, emissive: 0xff0066, intensity: 0.6 },
    car: { underglow: 0x00ffff, tail: 0xff0020 },
    track: {
      main: toVec3(neonwaveTrack),
      branch: toVec3(neonwaveBranch),
      rampSpecs: [
        { x: 2, z: -300, w: 10, l: 8, h: 2.5 },
        { x: -3, z: -1620, w: 10, l: 8, h: 3, yawDeg: 180 },
        { x: 70, z: -830, w: 10, l: 8, h: 2.5 },
      ],
      spawn: { pos: [0, 1, -5] },
    },
    decorations: [],
    sprites: [{ type: 'sun', color: 0xff0066, position: [0, 40, -200], scale: 120, opacity: 0.12 }],
    stars: 400,
    hud: { accent1: '#ff00b4', accent2: '#00c8ff', bg: '#050010', glow: '#ff00b4' },
  },

  forest: {
    key: 'forest', label: 'Forest',
    toneExposure: 1.0,
    sky: { stops: [[0,'#6eaed6'],[0.6,'#a8d0ea'],[1,'#d6e8f2']] },
    fog: { color: 0xa8d0ea, near: 120, far: 700 },
    lights: {
      ambient: { color: 0xffffff, intensity: 0.7 },
      hemi:    { sky: 0x87ceeb, ground: 0x4e6b2f, intensity: 1.0 },
      sun:     { color: 0xfff2c8, intensity: 2.5, position: [60, 120, -80], shadow: true },
      extras: [],
    },
    ground: { color: 0x3a5226, textureBuilder: 'grass' },
    road: { textureBuilder: 'asphalt-light', edgeColor: 0xffffff, edgeOpacity: 0.4 },
    ramps: { color: 0x8a6a4a, emissive: 0x000000, intensity: 0 },
    car: { underglow: 0x88ff88, tail: 0xff0030 },
    track: {
      main: toVec3(forestTrack), branch: null,
      rampSpecs: [
        { x: 0, z: -500, w: 10, l: 8, h: 2 },
        { x: 20, z: -1150, w: 10, l: 8, h: 2.5 },
      ],
      spawn: { pos: [0, 1, -5] },
    },
    decorations: [
      { type: 'tree', count: 200, spread: [-80, 80, -1800, 60], minRoadDist: 18, scaleMin: 0.7, scaleMax: 1.4 },
      { type: 'tree', count: 100, spread: [-150, 150, -1800, 60], minRoadDist: 80, scaleMin: 0.9, scaleMax: 1.6 },
    ],
    sprites: [],
    stars: 0,
    hud: { accent1: '#8fe39c', accent2: '#fff2a0', bg: '#1a2e14', glow: '#8fe39c' },
  },

  moscow: {
    key: 'moscow', label: 'Red Square',
    toneExposure: 1.2,
    sky: { stops: [[0,'#0a0818'],[0.5,'#1a0a1a'],[0.85,'#3a0a0a'],[1,'#1a0505']] },
    fog: { color: 0x2a0a10, near: 100, far: 500 },
    lights: {
      ambient: { color: 0x553322, intensity: 1.2 },
      hemi:    { sky: 0x442211, ground: 0x221111, intensity: 0.8 },
      sun:     { color: 0xff6633, intensity: 1.8, position: [-50, 80, -100], shadow: true },
      extras: [
        { type: 'directional', color: 0xffaa33, intensity: 1.5, position: [20, 15, -50] },
        { type: 'directional', color: 0xff2200, intensity: 0.8, position: [0, -2, 0] },
      ],
    },
    ground: { color: 0x3a3030, textureBuilder: 'cobble' },
    road: { textureBuilder: 'cobble-road', edgeColor: 0xaa8844, edgeOpacity: 0.6 },
    ramps: { color: 0x882211, emissive: 0xff2200, intensity: 0.3 },
    car: { underglow: 0xff2200, tail: 0xff0010 },
    track: {
      main: toVec3(moscowTrack), branch: null,
      rampSpecs: [],
      spawn: { pos: [0, 1, -5] },
    },
    decorations: [
      { type: 'building', count: 40, spread: [-100, 100, -500, 100], minRoadDist: 25, height: undefined, windowColor: 0xffcc44 },
      { type: 'star', count: 15, spread: [-100, 100, -500, 100], minRoadDist: 30, y: 35, scale: 2.5, color: 0xff0022 },
    ],
    sprites: [],
    stars: 0,
    hud: { accent1: '#ff3322', accent2: '#ffcc44', bg: '#1a0505', glow: '#ff2200' },
  },

  arctic: {
    key: 'arctic', label: 'Arctic',
    toneExposure: 1.1,
    sky: { stops: [[0,'#8ec0e8'],[0.5,'#b8d4e8'],[1,'#e8f0f8']] },
    fog: { color: 0xd8e4f0, near: 60, far: 500 },
    lights: {
      ambient: { color: 0xffffff, intensity: 1.0 },
      hemi:    { sky: 0xb8d4e8, ground: 0xe0e8f0, intensity: 1.2 },
      sun:     { color: 0xe8f0ff, intensity: 2.2, position: [80, 100, -100], shadow: true },
      extras: [],
    },
    ground: { color: 0xe8f0f8, textureBuilder: 'snow' },
    road: { textureBuilder: 'ice', edgeColor: 0x88aabb, edgeOpacity: 0.5 },
    ramps: { color: 0xaaccdd, emissive: 0x4488aa, intensity: 0.2 },
    car: { underglow: 0x88ccff, tail: 0xff4455 },
    track: {
      main: toVec3(arcticTrack), branch: null,
      rampSpecs: [
        { x: 0, z: -800, w: 10, l: 8, h: 2 },
      ],
      spawn: { pos: [0, 1, -5] },
    },
    decorations: [
      { type: 'pine', count: 150, spread: [-100, 100, -2000, 60], minRoadDist: 18, scaleMin: 0.8, scaleMax: 1.3 },
    ],
    sprites: [],
    stars: 0,
    hud: { accent1: '#88ccff', accent2: '#ffffff', bg: '#1a2a3a', glow: '#88ccff' },
  },

  tokyo: {
    key: 'tokyo', label: 'Tokyo Neon',
    toneExposure: 1.5,
    sky: { stops: [[0,'#050510'],[0.5,'#1a0830'],[1,'#2a0a40']] },
    fog: { color: 0x1a0830, near: 80, far: 400 },
    lights: {
      ambient: { color: 0x332244, intensity: 1.2 },
      hemi:    { sky: 0x442266, ground: 0x110022, intensity: 0.6 },
      sun:     { color: 0xff66cc, intensity: 1.0, position: [0, 60, -100], shadow: false },
      extras: [
        { type: 'directional', color: 0xff00aa, intensity: 2.0, position: [10, 5, -20] },
        { type: 'directional', color: 0x00ffaa, intensity: 1.5, position: [-10, 5, -30] },
        { type: 'directional', color: 0xffff00, intensity: 1.2, position: [0, -2, 0] },
      ],
    },
    ground: { color: 0x15151f, textureBuilder: 'tokyo-tile' },
    road: { textureBuilder: 'tokyo-asphalt', edgeColor: 0xff0088, edgeOpacity: 1.0 },
    ramps: { color: 0xff0088, emissive: 0xff00aa, intensity: 1 },
    car: { underglow: 0xff00ff, tail: 0x00ffaa },
    track: {
      main: toVec3(tokyoTrack), branch: null,
      rampSpecs: [],
      spawn: { pos: [0, 1, -5] },
    },
    decorations: [
      { type: 'building', count: 60, spread: [-80, 80, -1500, 60], minRoadDist: 22, height: undefined, windowColor: 0xff00aa },
      { type: 'building', count: 30, spread: [-80, 80, -1500, 60], minRoadDist: 22, height: undefined, windowColor: 0x00ffaa },
    ],
    sprites: [],
    stars: 0,
    hud: { accent1: '#ff00aa', accent2: '#00ffaa', bg: '#05000f', glow: '#ff00aa' },
  },

  desert: {
    key: 'desert', label: 'Desert',
    toneExposure: 1.4,
    sky: { stops: [[0,'#ffcc88'],[0.4,'#ffaa66'],[0.8,'#d88844'],[1,'#aa5522']] },
    fog: { color: 0xe8a266, near: 150, far: 800 },
    lights: {
      ambient: { color: 0xffeecc, intensity: 1.2 },
      hemi:    { sky: 0xffcc88, ground: 0xc08850, intensity: 1.4 },
      sun:     { color: 0xffdd99, intensity: 3.0, position: [60, 120, -60], shadow: true },
      extras: [],
    },
    ground: { color: 0xd4a85a, textureBuilder: 'sand' },
    road: { textureBuilder: 'sand-path', edgeColor: 0x886644, edgeOpacity: 0.3 },
    ramps: { color: 0xaa7744, emissive: 0x000000, intensity: 0 },
    car: { underglow: 0xffcc44, tail: 0xff4422 },
    track: {
      main: toVec3(desertTrack), branch: null,
      rampSpecs: [
        { x: 0, z: -800, w: 10, l: 8, h: 2.5 },
        { x: 0, z: -1600, w: 10, l: 8, h: 2 },
      ],
      spawn: { pos: [0, 1, -5] },
    },
    decorations: [
      { type: 'dune', count: 30, spread: [-150, 150, -2200, 80], minRoadDist: 30, width: 15, height: 5 },
      { type: 'palm', count: 25, spread: [-80, 80, -2200, 60], minRoadDist: 22 },
      { type: 'cactus', count: 40, spread: [-100, 100, -2200, 60], minRoadDist: 20 },
    ],
    sprites: [],
    stars: 0,
    hud: { accent1: '#ff8844', accent2: '#ffd088', bg: '#2a1405', glow: '#ff8844' },
  },
};

export const themeKeys = Object.keys(themes);
