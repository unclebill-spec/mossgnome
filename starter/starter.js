// N64 starter: the smallest complete n64-suite game. One clearing, a gnome you can steer, a friend to talk to, a glowing
// spring to find and a swirling portal pair, in a day/night cycle with "gloom and glow" neon lights.
// Everything visible is built here from plain three.js primitives (no model files), so it is easy to copy and extend.
// The shared runtime comes from the "kit/" import-map prefix (the public mossgnome repo root):
//   common.js (renderer, 30 fps loop, keys) | input.js (keyboard/mouse/touch/gamepad) | camrig.js (follow / lock-on camera)
//   display.js (resolution presets, fullscreen, install, rotate overlay) | minimap.js | lights/{glowkit,daynight,wisps}.js
// URL flags: ?hour=22 (start time) &cycle=0 (freeze time) &lightq=low|medium|high &crisp=1 (nearest filtering) &seed=N
import * as THREE from 'three';
import { makeRenderer, loop, keys, takePressed, pressKey, loaded, rng, clamp, $ } from 'kit/common.js';
import { createInput } from 'kit/input.js';
import { createDisplay } from 'kit/display.js';
import { followYaw, lockFrame, pickTarget, wrapA, PITCH, clampPitch, upAmount, lookUp } from 'kit/camrig.js';
import { createMinimap, bakeMap } from 'kit/minimap.js';
import { LightPool, QUALITY, resolveQuality, haloSprite, groundGlow, glowTexture, NEON } from 'kit/lights/glowkit.js';
import { DayNight } from 'kit/lights/daynight.js';
import { WispSwarm } from 'kit/lights/wisps.js';

const QS = new URLSearchParams(location.search);
const SEED = +(QS.get('seed') || 7);
const R = rng(SEED);
const KEY = 'n64starter';
// ---- the N64 look in numbers (see docs/N64_GRAPHICS_GUIDE.md)
const LOOK = { size: 96, grid: 33, fogNear: 18, fogFar: 70, nightNear: 9, nightFar: 46, fov: 55, texPx: 32, animFps: 15 };
// Bill's signature glow colours: neon blue cold fire (favourite), violet neon, red neon. Cyan rides along with cold fire.
const GLOOM = { coldfire: '#3d9bff', violet: '#a24dff', red: '#ff2a48', cyan: NEON.cyan };
const CRISP = QS.get('crisp') === '1';

// ---------------------------------------------------------------- renderer + scene
const renderer = makeRenderer();  // antialias off, pixel ratio 1, 320x240 until display.js sizes it
const quality = resolveQuality(QS.get('lightq') || localStorage.getItem(`${KEY}.lightq`) || 'auto');
renderer.shadowMap.enabled = QUALITY[quality].shadows > 0;
renderer.shadowMap.type = THREE.BasicShadowMap;  // hard, pixelly shadow edges suit the look
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(LOOK.fov, 4 / 3, 0.1, 220);
scene.fog = new THREE.Fog(0x9fc4b0, LOOK.fogNear, LOOK.fogFar);

// ---------------------------------------------------------------- tiny canvas textures (32 px, few colours, bilinear)
function canvasTex(draw, px = LOOK.texPx) {
  const c = document.createElement('canvas'); c.width = c.height = px; const g = c.getContext('2d'); draw(g, px);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = CRISP ? THREE.NearestFilter : THREE.LinearFilter; t.minFilter = CRISP ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
  return t;
}
function speckle(base, dots, n) { return (g, px) => { g.fillStyle = base; g.fillRect(0, 0, px, px); for (let i = 0; i < n; i++) { g.fillStyle = dots[i % dots.length]; g.fillRect(Math.floor(R() * px), Math.floor(R() * px), 1 + Math.floor(R() * 2), 1 + Math.floor(R() * 2)); } }; }
const TEX = {
  grass: canvasTex(speckle('#c8d8a8', ['#e8f0c8', '#a8c088', '#b8d098'], 90)),  // light: vertex colours carry the hue
  bark: canvasTex((g, px) => { g.fillStyle = '#c8a888'; g.fillRect(0, 0, px, px); g.fillStyle = '#987858'; for (let x = 0; x < px; x += 4) g.fillRect(x + Math.floor(R() * 2), 0, 1, px); }),
  stone: canvasTex(speckle('#c0c0c8', ['#a0a0a8', '#d8d8e0', '#b0b0b8'], 120)),
};

// ---------------------------------------------------------------- materials: flat-shaded Lambert + vertex colours
const mats = new Map();
function mat(color, opts = {}) {  // one shared material per colour (cheap, and lets the day/night lights reach every mesh)
  const key = color + (opts.map ? opts.map.uuid : '') + (opts.transparent ? 't' : '');
  if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts }));
  return mats.get(key);
}
function mesh(geo, color, opts) { geo.computeVertexNormals(); const m = new THREE.Mesh(geo, mat(color, opts)); m.castShadow = false; m.receiveShadow = true; return m; }
function jitter(geo, amt) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + (R() - 0.5) * amt, p.getY(i) + (R() - 0.5) * amt, p.getZ(i) + (R() - 0.5) * amt); return geo; }
const tris = (o) => { let n = 0; o.traverse((m) => { if (m.isMesh) { const g = m.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return Math.round(n); };

// ---------------------------------------------------------------- terrain: low-res heightfield, baked vertex colours
const PATH = [[-30, 26], [-14, 14], [0, 4], [10, -6], [22, -14], [34, -30]];
function distToPath(x, z) {
  let best = 1e9;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
function rawH(x, z) {
  const r = Math.hypot(x, z), rim = Math.min(10, Math.max(0, r - 34));  // bowl: a low ring of hills fences the clearing (capped so the sky shows)
  return Math.sin(x * 0.11) * 0.9 + Math.cos(z * 0.13) * 0.8 + Math.sin((x + z) * 0.05) * 1.4 + rim * rim * 0.06;
}
const heightAt = (x, z) => rawH(x, z) * (distToPath(x, z) < 3 ? 0.85 : 1);
function buildTerrain() {
  const N = LOOK.grid, S = LOOK.size, geo = new THREE.PlaneGeometry(S, S, N - 1, N - 1); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv, col = new Float32Array(pos.count * 3);
  const grass = new THREE.Color('#5a9a3a'), grass2 = new THREE.Color('#78ac44'), dirt = new THREE.Color('#9a7448'), hill = new THREE.Color('#4a7a3a'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = heightAt(x, z); pos.setY(i, y); uv.setXY(i, x / 4, z / 4);
    c.copy(grass).lerp(grass2, R() * 0.6); if (y > 3) c.lerp(hill, Math.min(1, (y - 3) / 6));
    if (distToPath(x, z) < 2.6) c.lerp(dirt, 0.85);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: TEX.grass, vertexColors: true, flatShading: true }));
  m.receiveShadow = true; m.name = 'terrain'; return m;
}

// ---------------------------------------------------------------- props (each one well under 100 triangles)
const colliders = [];
const props = [];  // for the minimap bake
function tree(x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, heightAt(x, z), z); g.scale.setScalar(s);
  const trunk = mesh(new THREE.CylinderGeometry(0.28, 0.4, 2.2, 6), '#8a5a32', { map: TEX.bark }); trunk.position.y = 1.1; g.add(trunk);
  const greens = ['#2f7a2a', '#3a8a32', '#2a6a28'];
  for (let k = 0; k < 3; k++) { const cn = mesh(jitter(new THREE.ConeGeometry(1.7 - k * 0.4, 1.8, 7), 0.15), greens[k]); cn.position.y = 2.3 + k * 0.95; g.add(cn); }
  colliders.push({ x, z, r: 0.7 * s }); props.push({ model: 'tree', pos: [x, 0, z], scale: s }); return g;
}
function rock(x, z, s = 1) {
  const m = mesh(jitter(new THREE.IcosahedronGeometry(0.8, 0), 0.25), '#8a8a92', { map: TEX.stone }); m.position.set(x, heightAt(x, z) + 0.3 * s, z); m.scale.set(s, s * 0.7, s);
  colliders.push({ x, z, r: 0.75 * s }); return m;
}
function mushroom(x, z, cap = '#d63a2a') {
  const g = new THREE.Group(); g.position.set(x, heightAt(x, z), z);
  const st = mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.45, 5), '#f0e2c0'); st.position.y = 0.22; g.add(st);
  const cp = mesh(new THREE.ConeGeometry(0.38, 0.3, 7), cap); cp.position.y = 0.55; g.add(cp); return g;
}
function hut(x, z, ry = 0) {
  const g = new THREE.Group(); g.position.set(x, heightAt(x, z), z); g.rotation.y = ry;
  const wall = mesh(new THREE.CylinderGeometry(2, 2.2, 2.4, 8), '#e8d0a0'); wall.position.y = 1.2; g.add(wall);
  const roof = mesh(new THREE.ConeGeometry(2.8, 2.2, 8), '#c84a2a'); roof.position.y = 3.4; g.add(roof);
  const door = mesh(new THREE.BoxGeometry(0.9, 1.5, 0.2), '#6a3a1a'); door.position.set(0, 0.75, 2.12); g.add(door);
  colliders.push({ x, z, r: 2.4 }); props.push({ model: 'house', pos: [x, 0, z], scale: 1.6 }); return g;
}

// ---------------------------------------------------------------- characters: rigid parts on pivots (no skinning)
// N64-style "rigid skinning": every limb is its own mesh hung on a pivot group, posed by rotating pivots.
function gnome({ coat = '#3a6ad0', hat = '#d63a2a', beard = '#f4f0e8', skin = '#f0b088' } = {}) {
  const g = new THREE.Group(), P = {};
  const body = mesh(new THREE.CylinderGeometry(0.34, 0.5, 0.8, 8), coat); body.position.y = 0.75; g.add(body);
  const belt = mesh(new THREE.CylinderGeometry(0.45, 0.47, 0.1, 8), '#4a2a14'); belt.position.y = 0.55; g.add(belt);
  const head = new THREE.Group(); head.position.y = 1.3; g.add(head); P.head = head;
  head.add(mesh(new THREE.SphereGeometry(0.32, 8, 6), skin));
  const nose = mesh(new THREE.IcosahedronGeometry(0.1, 0), '#e88a6a'); nose.position.set(0, -0.02, 0.32); head.add(nose);
  for (const s of [-1, 1]) { const e = mesh(new THREE.BoxGeometry(0.07, 0.09, 0.04), '#1a1010'); e.position.set(0.12 * s, 0.08, 0.28); head.add(e); }
  const bd = mesh(new THREE.ConeGeometry(0.3, 0.55, 6), beard); bd.position.set(0, -0.3, 0.12); bd.rotation.x = Math.PI; head.add(bd);
  const ht = mesh(new THREE.ConeGeometry(0.36, 0.9, 8), hat); ht.position.y = 0.55; ht.rotation.z = 0.12; head.add(ht);
  for (const [n, s] of [['armL', -1], ['armR', 1]]) {
    const piv = new THREE.Group(); piv.position.set(0.42 * s, 1.05, 0); g.add(piv); P[n] = piv;
    const a = mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), coat); a.position.y = -0.22; piv.add(a);
    const hnd = mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), skin); hnd.position.y = -0.5; piv.add(hnd);
  }
  for (const [n, s] of [['legL', -1], ['legR', 1]]) {
    const piv = new THREE.Group(); piv.position.set(0.18 * s, 0.38, 0); g.add(piv); P[n] = piv;
    const l = mesh(new THREE.BoxGeometry(0.18, 0.32, 0.18), '#5a3a20'); l.position.y = -0.16; piv.add(l);
    const f = mesh(new THREE.BoxGeometry(0.2, 0.1, 0.3), '#3a2414'); f.position.set(0, -0.33, 0.05); piv.add(f);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.parts = P; return g;
}
function pose(g, t, speed, air) {  // stepped to LOOK.animFps, like a low-frame-rate N64 clip
  const P = g.userData.parts, ts = Math.floor(t * LOOK.animFps) / LOOK.animFps, w = Math.min(1, speed / 4);
  const s = Math.sin(ts * 11) * 0.7 * w;
  P.legL.rotation.x = air ? -0.5 : s; P.legR.rotation.x = air ? 0.3 : -s;
  P.armL.rotation.x = air ? -2.4 : -s * 0.8; P.armR.rotation.x = air ? -2.4 : s * 0.8;
  P.head.position.y = 1.3 + (w > 0.05 ? Math.abs(Math.sin(ts * 11)) * 0.05 : Math.sin(ts * 2) * 0.015);
}

// ---------------------------------------------------------------- glow objects (gloom and glow)
let pool = null;  // LightPool: a fixed number of real point lights handed to the nearest / most important emitters
const glows = [];  // { obj, halos:[sprite], grounds:[mesh], emitter, base, day }
const flameTex = { cold: null };
function coldFlameTex() {  // blue cold-fire flame (procedural)
  if (flameTex.cold) return flameTex.cold;
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 24, 0, 16, 19, 15); gr.addColorStop(0, 'rgba(235,250,255,1)'); gr.addColorStop(0.35, 'rgba(110,190,255,.95)'); gr.addColorStop(1, 'rgba(40,90,255,0)');
  g.fillStyle = gr; g.beginPath(); g.ellipse(16, 19, 9, 13, 0, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; flameTex.cold = t; return t;
}
function addGlow(obj, at, col, { intensity = 1.6, distance = 8, priority = 1, halo = 1.6, ground = 2.2, shadow = false, day = 0.15 } = {}) {
  const h = haloSprite(col, halo, glowTexture('halo'), 0.6); h.position.copy(at); obj.add(h);
  const gg = groundGlow(col, ground, glowTexture('halo'), 0.4); gg.position.set(at.x, 0.05, at.z); obj.add(gg);
  const wp = new THREE.Vector3(); obj.updateMatrixWorld(true); h.getWorldPosition(wp);
  const emitter = pool.add({ position: wp, color: col, intensity, distance, priority, castShadow: shadow, flicker: (t) => 0.9 + 0.1 * Math.sin(t * 9 + wp.x) });
  glows.push({ obj, halos: [h], grounds: [gg], emitter, day }); return emitter;
}
function torch(x, z, cold = true) {  // cold fire: blue flame (Bill's favourite); a few warm ones stay for contrast
  const g = new THREE.Group(); g.position.set(x, heightAt(x, z), z);
  const post = mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.6, 5), '#5a3a20'); post.position.y = 0.8; g.add(post);
  const bowl = mesh(new THREE.CylinderGeometry(0.26, 0.12, 0.22, 6), '#3a3a44'); bowl.position.y = 1.65; g.add(bowl);
  const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: cold ? coldFlameTex() : glowTexture('flame'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  fl.scale.set(0.55, 0.8, 1); fl.position.y = 2.0; fl.userData.flame = true; g.add(fl);
  colliders.push({ x, z, r: 0.3 });
  addGlow(g, new THREE.Vector3(0, 2.0, 0), cold ? GLOOM.coldfire : '#ff9a3a', { intensity: 1.8, distance: 9, priority: 1.4, shadow: true, halo: 1.4 });
  glows[glows.length - 1].flame = fl; return g;
}
function lantern(x, z, col) {  // a hanging glass lantern on a hooked pole
  const g = new THREE.Group(); g.position.set(x, heightAt(x, z), z);
  const pole = mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 5), '#3a2a1a'); pole.position.y = 1.2; g.add(pole);
  const arm = mesh(new THREE.BoxGeometry(0.6, 0.06, 0.06), '#3a2a1a'); arm.position.set(0.28, 2.35, 0); g.add(arm);
  const glass = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, fog: false }));
  glass.position.set(0.55, 2.05, 0); g.add(glass);
  colliders.push({ x, z, r: 0.25 });
  addGlow(g, glass.position.clone(), col, { intensity: 1.5, distance: 8, priority: 1.1, halo: 1.8 }); return g;
}

// ---------------------------------------------------------------- the glowing spring (quest goal)
function spring(x, z) {
  const g = new THREE.Group(); g.position.set(x, heightAt(x, z) + 0.05, z);
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, s = mesh(jitter(new THREE.IcosahedronGeometry(0.45, 0), 0.15), '#7a7a88'); s.position.set(Math.cos(a) * 1.9, 0.15, Math.sin(a) * 1.9); g.add(s); }
  const ct = glowTexture('caustics');
  const water = new THREE.Mesh(new THREE.CircleGeometry(1.7, 12), new THREE.MeshBasicMaterial({ color: '#2ad8ff', map: ct, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  water.rotation.x = -Math.PI / 2; water.position.y = 0.1; g.add(water); g.userData.water = water;
  addGlow(g, new THREE.Vector3(0, 1.0, 0), GLOOM.cyan, { intensity: 2.2, distance: 10, priority: 2, halo: 2.6, ground: 3.4, day: 0.45 });
  return g;
}

// ---------------------------------------------------------------- Gravewake-style portal: stepped-ring spiral vortex
function vortexTex(cols) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), im = g.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const dx = (x - 31.5) / 32, dy = (y - 31.5) / 32, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx), i = (y * 64 + x) * 4;
    if (r > 1) { im.data[i + 3] = 0; continue; }
    const band = Math.floor(((r * 4.2 + a / (Math.PI * 2) * 2) % 1 + 1) % 1 * 2) + Math.floor(r * (cols.length - 1));  // spiral, stepped colour rings
    const k = new THREE.Color(cols[Math.min(cols.length - 1, Math.max(0, cols.length - 1 - Math.min(band, cols.length - 1)))]);
    const rim = r > 0.9 ? 1.3 : 1; im.data[i] = Math.min(255, k.r * 255 * rim); im.data[i + 1] = Math.min(255, k.g * 255 * rim); im.data[i + 2] = Math.min(255, k.b * 255 * rim);
    im.data[i + 3] = r > 0.96 ? 140 : 255;
  }
  g.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.magFilter = THREE.NearestFilter; return t;
}
const portals = [];
function portal(x, z, ry, col) {
  const g = new THREE.Group(); g.position.set(x, heightAt(x, z), z); g.rotation.y = ry;
  for (const s of [-1, 1]) { const p = mesh(new THREE.BoxGeometry(0.5, 3.2, 0.5), '#6a6a78', { map: TEX.stone }); p.position.set(1.5 * s, 1.6, 0); g.add(p); }
  const top = mesh(new THREE.BoxGeometry(3.6, 0.5, 0.6), '#6a6a78', { map: TEX.stone }); top.position.y = 3.3; g.add(top);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1.25, 16), new THREE.MeshBasicMaterial({ map: vortexTex(['#fff6ff', '#d8a8ff', '#a24dff', '#5a2aa0', '#1a0a30']), transparent: true, side: THREE.DoubleSide, fog: false }));
  fill.position.y = 1.55; g.add(fill);
  colliders.push({ x: x + Math.cos(ry) * 1.5, z: z - Math.sin(ry) * 1.5, r: 0.4 }, { x: x - Math.cos(ry) * 1.5, z: z + Math.sin(ry) * 1.5, r: 0.4 });
  addGlow(g, new THREE.Vector3(0, 1.6, 0.3), col, { intensity: 1.8, distance: 8, priority: 1.6, halo: 2.4, day: 0.3 });
  const P = { g, fill, x, z, ry, link: null }; portals.push(P); return P;
}

// ---------------------------------------------------------------- build the level
const level = new THREE.Group(); scene.add(level);
const ground = buildTerrain(); level.add(ground);
pool = new LightPool(scene, { quality });
level.add(hut(-8, -6, 0.6), hut(6, -12, -0.4));
for (let i = 0; i < 26; i++) {  // trees in a loose ring, kept off the path and the middle
  const a = R() * Math.PI * 2, r = 16 + R() * 20, x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (distToPath(x, z) > 4) level.add(tree(x, z, 0.9 + R() * 0.6));
}
for (let i = 0; i < 10; i++) { const x = (R() - 0.5) * 50, z = (R() - 0.5) * 50; if (distToPath(x, z) > 3 && Math.hypot(x, z) > 5) level.add(rock(x, z, 0.6 + R())); }
for (let i = 0; i < 14; i++) { const x = (R() - 0.5) * 40, z = (R() - 0.5) * 40; if (distToPath(x, z) > 2.5) level.add(mushroom(x, z, R() < 0.5 ? '#d63a2a' : '#a24dff')); }
level.add(torch(-3, 3), torch(3, 6), torch(12, -8, false), torch(-12, 15), torch(20, -16));
level.add(lantern(-6, 9, GLOOM.violet), lantern(9, -1, GLOOM.red), lantern(-1, -10, GLOOM.coldfire), lantern(16, -20, GLOOM.violet));
const SPRING = { x: 26, z: -24, found: false }; const springObj = spring(SPRING.x, SPRING.z); level.add(springObj);
const pA = portal(-22, 20, 0.8, GLOOM.violet), pB = portal(30, 18, -0.7, GLOOM.violet); pA.link = pB; pB.link = pA; level.add(pA.g, pB.g);
const wisps = new WispSwarm({ preset: 'spirit', seed: SEED, pool, palette: GLOOM, colors: ['coldfire', 'violet', 'red', 'cyan'], count: 10, center: [SPRING.x, 2, SPRING.z], bounds: [10, 2, 10], lights: 0 });
scene.add(wisps.object);
const motes = new WispSwarm({ preset: 'fireflies', seed: SEED + 1, palette: GLOOM, colors: ['coldfire', 'violet', 'cyan', 'red'], count: 50, center: [0, 1, 0], bounds: [44, 1.6, 44], lights: 0 });
scene.add(motes.object);

const player = gnome(); player.position.set(0, heightAt(0, 0), 2); scene.add(player);
const friend = gnome({ coat: '#8a3ac0', hat: '#3d9bff', beard: '#d8d8e0' }); friend.position.set(-4, heightAt(-4, 0), -1); friend.rotation.y = 0.8;
scene.add(friend);  // ADD IT TO THE SCENE: building an NPC without scene.add() is the classic "invisible villager" bug
colliders.push({ x: -4, z: -1, r: 0.6 });
const NPCS = [{ obj: friend, name: 'Fennel', lines: ['Evening, little gnome!', 'The spring past the cold-fire torches has gone quiet.', 'Follow the red chevron on your map and find it for me?'] }];

// ---------------------------------------------------------------- day / night
const startHour = QS.has('hour') ? +QS.get('hour') : 19.6;
const dn = new DayNight({ scene, camera, cycleSeconds: 240, nightShare: 0.6, startHour, radius: 110, paused: QS.get('cycle') === '0',
  fog: { near: LOOK.fogNear, far: LOOK.fogFar, nightNear: LOOK.nightNear, nightFar: LOOK.nightFar } });
const PHONE = matchMedia('(pointer: coarse)').matches;
dn.ambientGain = PHONE ? 1.9 : 1.55;  // gloom and glow, but never pitch black (phones get a higher floor)
dn.light.castShadow = false;
const TIME_MODES = ['cycle', 'day', 'night'];
let timeMode = QS.has('hour') ? (QS.get('cycle') === '1' ? 'cycle' : 'fixed') : (localStorage.getItem(`${KEY}.time`) || 'cycle');
function applyTimeMode() { if (timeMode === 'day') { dn.hour = 12; dn.paused = true; } else if (timeMode === 'night') { dn.hour = 22.5; dn.paused = true; } else if (timeMode === 'cycle') dn.paused = false; }
applyTimeMode();

// ---------------------------------------------------------------- display + input
const display = createDisplay({ renderer, cameras: () => [camera], storageKey: `${KEY}.display`, title: 'N64 Starter', onToast: (m) => toast(m) });
const input = createInput({ storageKey: `${KEY}.input`, stickKeys: false, canvas: $('view'), onToast: (m) => toast(m),
  binds: { A: 'Space', B: 'Escape', X: 'KeyE', Y: 'KeyH', LT: 'KeyQ', START: 'KeyP', SELECT: 'KeyM', R3: 'KeyC', UP: 'ArrowUp', DOWN: 'ArrowDown' } });
if (input.settings.camMode !== 'free') input.settings.camMode = 'follow';

// ---- touch joystick: floats to wherever the left thumb lands (left third of the screen), smooth analog output
const joy = $('joy'), knob = joy.querySelector('.knob');
let joyId = null, joyC = null, joyT = null, joyV = null;
function joyStart(e) {
  joyId = e.pointerId; const st = $('stage').getBoundingClientRect();
  joy.style.left = `${(e.clientX - st.left) / st.width * 100}%`; joy.style.top = `${(e.clientY - st.top) / st.height * 100}%`;
  joyC = { x: e.clientX, y: e.clientY }; joy.classList.add('on'); joyMove(e);
}
function joyMove(e) {
  const Rr = joy.getBoundingClientRect().width * 0.6; let x = (e.clientX - joyC.x) / Rr, y = (e.clientY - joyC.y) / Rr; const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; } const k = l < 0.08 ? 0 : 1; joyT = { x: x * k, y: y * k }; knob.style.transform = `translate(${x * 80}%, ${y * 80}%)`;
}
function joyEnd() { joyId = null; joyT = null; knob.style.transform = ''; joy.classList.remove('on'); joy.style.left = ''; joy.style.top = ''; }
// ---- camera drag (mouse anywhere / touch on the right two thirds)
let drag = null; const look = { dx: 0, dy: 0 };
$('stage').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, .menu, #talk')) return;
  if (e.pointerType !== 'mouse' && joyId === null && e.clientX < innerWidth / 3 && !G.menu) { e.preventDefault(); joyStart(e); return; }
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
addEventListener('pointermove', (e) => {
  if (e.pointerId === joyId) { joyMove(e); return; }
  if (drag && e.pointerId === drag.id) { look.dx += e.clientX - drag.x; look.dy += e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; }
});
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, (e) => { if (e.pointerId === joyId) joyEnd(); if (drag && e.pointerId === drag.id) drag = null; });
// ---- HUD buttons: one press each (pointerdown, not click, so it feels instant on phones)
for (const b of document.querySelectorAll('[data-k]')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pressKey(b.dataset.k); });
// fullscreen must run inside the user's gesture, so it is handled here and not in the frame loop
$('fs').addEventListener('click', () => display.toggleFS());
addEventListener('keydown', (e) => { if (e.code === 'Backquote') display.toggleFS(); });

// ---------------------------------------------------------------- HUD helpers
let toastT = 0; function toast(html, ms = 2600) { const t = $('toast'); t.innerHTML = html; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
const mapCanvas = bakeMap({ size: LOOK.size, h: heightAt, paths: [PATH], props, big: ['tree', 'house'], px: 160 });
const mini = createMinimap({ parent: $('hud'), view: () => (G.menu || !input.settings.minimap ? null : {
  img: mapCanvas, size: LOOK.size, x: player.position.x, z: player.position.z, facing: player.rotation.y,
  marks: [{ x: friend.position.x, z: friend.position.z, c: '#a24dff', r: 3.2, ring: true }],
  heading: G.quest === 0 ? { x: friend.position.x, z: friend.position.z } : G.quest === 1 ? { x: SPRING.x, z: SPRING.z } : null,
}) });

// ---------------------------------------------------------------- game state + settings menu
const G = { menu: false, talk: null, quest: 0, vy: 0, air: false, moveT: 0, speed: 0, lock: null, fade: 0, portalCd: 0,
  cam: { yaw: Math.PI, pitch: PITCH.rest, dist: 7, idle: 9 } };
const MENU = [
  ['Resume', () => openMenu(false), () => ''],
  ['Camera', () => { input.settings.camMode = input.settings.camMode === 'free' ? 'follow' : 'free'; input.save(); }, () => (input.settings.camMode === 'free' ? 'Free' : 'Follow')],
  ['Resolution', () => display.cycle('res'), () => display.label('res')],
  ['Aspect', () => display.cycle('aspect'), () => display.label('aspect')],
  ['Render scale', () => display.cycle('scale'), () => display.label('scale')],
  ['Time of day', () => { timeMode = TIME_MODES[(TIME_MODES.indexOf(timeMode) + 1) % 3]; localStorage.setItem(`${KEY}.time`, timeMode); applyTimeMode(); }, () => ({ cycle: 'Cycle', day: 'Day', night: 'Night', fixed: `${dn.hour.toFixed(1)}h` }[timeMode])],
  ['Lights', () => { const L = ['auto', 'low', 'medium', 'high'], cur = localStorage.getItem(`${KEY}.lightq`) || 'auto'; localStorage.setItem(`${KEY}.lightq`, L[(L.indexOf(cur) + 1) % 4]); toast('Lights change after reload'); }, () => `${localStorage.getItem(`${KEY}.lightq`) || 'auto'} (${quality})`],
  ['Minimap', () => { input.settings.minimap = !input.settings.minimap; input.save(); }, () => (input.settings.minimap ? 'On' : 'Off')],
  ['Fullscreen', () => display.toggleFS(), () => (display.isFS() ? 'On' : 'Off')],
  ['Install app', () => display.install(), () => display.installLabel()],
];
let sel = 0;
function drawMenu() {
  $('menu').innerHTML = '<b>Settings</b>' + MENU.map(([n, , v], i) => `<button class="${i === sel ? 'sel' : ''}" data-i="${i}">${n}<span>${v()}</span></button>`).join('');
  for (const b of $('menu').querySelectorAll('button')) b.addEventListener('click', (e) => { e.stopPropagation(); sel = +b.dataset.i; MENU[sel][1](); if (G.menu) drawMenu(); });
}
function openMenu(on) { G.menu = on; input.menu = on; $('menu').classList.toggle('hide', !on); if (on) { sel = 0; drawMenu(); } }

function talkTo(n) { G.talk = { n, i: 0 }; $('talk').classList.remove('hide'); $('talk').innerHTML = `<b>${n.name}</b>${n.lines[0]}<small>${input.scheme === 'pad' ? input.glyph('A') : input.scheme === 'touch' ? 'Tap' : 'Space'} to continue</small>`; }
function talkNext() {
  const T = G.talk; T.i++;
  if (T.i >= T.n.lines.length) { G.talk = null; $('talk').classList.add('hide'); if (G.quest === 0) { G.quest = 1; toast('Quest: find the glowing spring'); } return; }
  $('talk').querySelector('b').nextSibling.textContent = T.n.lines[T.i];
}

// ---------------------------------------------------------------- per-frame update
const fwd = new THREE.Vector3();
function step(dt, t) {
  for (const code of takePressed()) {
    if (G.menu) {
      if (code === 'ArrowUp') sel = (sel + MENU.length - 1) % MENU.length; else if (code === 'ArrowDown') sel = (sel + 1) % MENU.length;
      else if (code === 'Space' || code === 'Enter' || code === 'KeyE') MENU[sel][1](); else if (code === 'Escape' || code === 'KeyP') { openMenu(false); continue; }
      if (G.menu) drawMenu(); continue;
    }
    if (G.talk) { if (code === 'Space' || code === 'KeyE' || code === 'Enter') talkNext(); continue; }
    if (code === 'KeyP') openMenu(true);
    else if (code === 'Space' && !G.air) { G.vy = 8.5; G.air = true; }
    else if (code === 'KeyE') { const n = NPCS.find((q) => q.obj.position.distanceTo(player.position) < 2.8); if (n) talkTo(n); }
    else if (code === 'KeyQ') { G.lock = G.lock ? null : pickTarget(player.position, NPCS.map((q) => ({ pos: q.obj.position, obj: q.obj })), 14); if (!G.lock) toast('Nothing to lock on to'); }
    else if (code === 'KeyC') { input.settings.camMode = input.settings.camMode === 'free' ? 'follow' : 'free'; input.save(); toast(`Camera: ${input.settings.camMode}`); }
    else if (code === 'KeyM') { input.settings.minimap = !input.settings.minimap; input.save(); }
    else if (code === 'KeyH') toast(G.quest === 0 ? 'Talk to Fennel (purple dot on the map)' : G.quest === 1 ? 'Follow the red chevron to the spring' : 'Try the violet portals!');
  }
  // ---- move (camera-relative), keyboard + joystick + gamepad summed and clamped
  if (joyV || joyT) { joyV = joyV || { x: 0, y: 0 }; const f = 1 - Math.exp(-dt * 20), tx = joyT ? joyT.x : 0, ty = joyT ? joyT.y : 0; joyV.x += (tx - joyV.x) * f; joyV.y += (ty - joyV.y) * f; if (!joyT && Math.hypot(joyV.x, joyV.y) < 0.03) joyV = null; }
  let ix = 0, iz = 0;
  if (!G.menu && !G.talk) {
    ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + (joyV ? joyV.x : 0) + input.move.x;
    iz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0) + (joyV ? joyV.y : 0) + input.move.y;
  }
  const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
  // camera sits at player + (sin yaw, cos yaw) * dist, so forward (stick up, iz < 0) is -(sin yaw, cos yaw) and right is (cos yaw, -sin yaw)
  const cy = G.cam.yaw, mx = Math.cos(cy) * ix + Math.sin(cy) * iz, mz = -Math.sin(cy) * ix + Math.cos(cy) * iz;
  const sp = 5.2 * Math.min(1, il); G.speed = sp;
  if (sp > 0.05) { G.moveT += dt; const want = Math.atan2(mx, mz); player.rotation.y += wrapA(want - player.rotation.y) * (1 - Math.exp(-dt * 12)); } else G.moveT = 0;
  if (G.lock && sp < 0.05) { const d = G.lock.pos; player.rotation.y += wrapA(Math.atan2(d.x - player.position.x, d.z - player.position.z) - player.rotation.y) * (1 - Math.exp(-dt * 8)); }
  const p = player.position; p.x += mx * 5.2 * dt; p.z += mz * 5.2 * dt;
  for (const c of colliders) { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), r = c.r + 0.35; if (d < r && d > 1e-4) { p.x = c.x + dx / d * r; p.z = c.z + dz / d * r; } }
  const lim = LOOK.size / 2 - 6; p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim);
  const gy = heightAt(p.x, p.z); G.vy -= 22 * dt; p.y += G.vy * dt; if (p.y <= gy) { p.y = gy; G.vy = 0; G.air = false; }
  pose(player, t, sp, G.air);
  // ---- friend: idle, turns to face you when you come close
  const near = friend.position.distanceTo(p) < 5; if (near) friend.rotation.y += wrapA(Math.atan2(p.x - friend.position.x, p.z - friend.position.z) - friend.rotation.y) * (1 - Math.exp(-dt * 4));
  pose(friend, t, 0, false);
  $('prompt').classList.toggle('hide', !(friend.position.distanceTo(p) < 2.8) || !!G.talk || G.menu);
  // ---- quest: reach the spring
  if (G.quest === 1 && Math.hypot(p.x - SPRING.x, p.z - SPRING.z) < 2.6) { G.quest = 2; SPRING.found = true; toast('<b>Spring found!</b><br><small>It fizzes back to life. Now try the violet portals.</small>', 4000); }
  // ---- portals: step in, fade, come out of the other one
  G.portalCd = Math.max(0, G.portalCd - dt);
  for (const P of portals) {
    P.fill.rotation.z -= dt * 1.6;
    if (!G.portalCd && Math.hypot(p.x - P.x, p.z - P.z) < 1.0) {
      const o = P.link, ox = o.x + Math.sin(o.ry) * 2.4, oz = o.z + Math.cos(o.ry) * 2.4;
      p.set(ox, heightAt(ox, oz), oz); player.rotation.y = o.ry; G.cam.yaw = o.ry + Math.PI; G.portalCd = 1.2; G.fade = 1; toast('Whoosh!', 1200);
    }
  }
  G.fade = Math.max(0, G.fade - dt * 1.8); $('fade').style.opacity = G.fade.toFixed(2);
  updateCamera(dt);
  // ---- day / night + glow levels
  if (!G.menu) dn.update(dt);
  const lv = dn.lightsOn;
  for (const gl of glows) {
    const l = Math.max(gl.day, lv); gl.emitter.level = l;
    for (const h of gl.halos) h.material.opacity = h.userData.baseOpacity * (0.35 + 0.65 * l);
    for (const g2 of gl.grounds) g2.material.opacity = g2.userData.baseOpacity * l;
    if (gl.flame) { gl.flame.scale.y = 0.8 + Math.sin(t * 13 + gl.obj.position.x) * 0.08; }
  }
  springObj.userData.water.material.map.offset.x = t * 0.05;
  wisps.level = Math.max(0.25, dn.night); motes.level = dn.night; wisps.update(t); motes.update(t);
  pool.update(camera, dt, t);
  mini.update(dt, t);
  const h = dn.hour; $('clock').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
}
function updateCamera(dt) {
  const C = G.cam, sens = input.settings.sens || 1, inv = input.settings.invertY ? -1 : 1;
  let yawIn = (keys.KeyX ? 1 : 0) - (keys.KeyZ ? 1 : 0) + input.look.x, pitchIn = input.look.y * inv;
  const mdx = look.dx + input.mouse.dx, mdy = look.dy + input.mouse.dy; look.dx = look.dy = 0; input.mouse.dx = input.mouse.dy = 0;
  if (G.menu) yawIn = pitchIn = 0;
  if (yawIn || pitchIn || mdx || mdy) C.idle = 0; else C.idle += dt;
  C.yaw -= (yawIn * 2.4 * dt + mdx * 0.006) * sens; C.pitch = clampPitch(C.pitch + (pitchIn * 1.6 * dt + mdy * 0.005 * inv) * sens);
  const pl = player.position;
  let pos, lk;
  if (G.lock) {
    const f = lockFrame(pl, G.lock.pos, { dist: 6.4, height: 2.5 }); C.yaw += wrapA(f.yaw - C.yaw) * (1 - Math.exp(-dt * 6));
    pos = f.pos; lk = f.look; if (G.lock.pos.distanceTo(pl) > 18) G.lock = null;
  } else {
    if (input.settings.camMode !== 'free') C.yaw = followYaw(C.yaw, { facing: player.rotation.y, moving: G.speed > 0.05, moveT: G.moveT, idle: C.idle, dt });
    const cp = Math.max(PITCH.low, C.pitch), d = C.dist;
    pos = { x: pl.x + Math.sin(C.yaw) * Math.cos(cp) * d, y: pl.y + 1.2 + Math.sin(cp) * d, z: pl.z + Math.cos(C.yaw) * Math.cos(cp) * d };
    lk = { x: pl.x, y: pl.y + 1.1, z: pl.z };
    ({ pos, look: lk } = lookUp(pos, lk, pl, upAmount(C.pitch), { h: heightAt }));
  }
  pos.y = Math.max(pos.y, heightAt(pos.x, pos.z) + 0.5);
  const k = G.lock ? 1 - Math.exp(-dt * 8) : 1; camera.position.lerp(new THREE.Vector3(pos.x, pos.y, pos.z), k); camera.lookAt(lk.x, lk.y, lk.z);
}

// ---------------------------------------------------------------- go
const st = loop(renderer, scene, () => camera, step);
display.apply();
loaded();  // drops the loading overlay and lets keys / gamepad buttons through
toast(PHONE ? 'Drag the left side to walk · right side to look' : 'WASD walk · Space jump · E talk · drag to look · P settings', 3600);
window.__starter = {  // test hooks
  state: () => ({ fps: +st.fps.toFixed(1), pos: player.position.toArray().map((v) => +v.toFixed(2)), quest: G.quest, menu: G.menu, lock: !!G.lock,
    cam: input.settings.camMode, yaw: +G.cam.yaw.toFixed(3), hour: +dn.hour.toFixed(2), night: +dn.night.toFixed(2), lightsOn: +dn.lightsOn.toFixed(2),
    friendInScene: friend.parent === scene, tris: { player: tris(player), friend: tris(friend), frame: renderer.info.render.triangles },
    pool: pool.stats(), quality, res: display.res, rw: display.rw, rh: display.rh, mini: mini.visible, miniArrow: mini.arrow, miniGoal: mini.goal, scheme: input.scheme }),
  teleport: (x, z, face = 0) => { player.position.set(x, heightAt(x, z), z); player.rotation.y = face; G.cam.yaw = face + Math.PI; G.cam.idle = 0; },
  setHour: (h) => { dn.hour = h; dn.paused = true; dn.update(0); }, G, dn, scene, camera, renderer, display, input,
};
