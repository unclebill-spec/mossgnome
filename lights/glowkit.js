// n64-suite glow kit: shared helpers for wisps, torches and glow lanterns.
//  - NEON: the six neon glow colours (same ids as n64/glowlights.py)
//  - LightPool: a FIXED pool of real point lights handed to the nearest/most important glow emitters every frame.
//    Pool size and shadow casters come from the quality preset, so phones never compile shaders for dozens of lights
//    and only `shadows` lights (0-2) ever render shadow maps. Emitters without a real light still glow via halo sprites.
//  - textures (generated PNGs from the suite, or procedural canvas fallbacks), halo / ground-glow sprites, litify().
import * as THREE from 'three';

export const NEON = { cyan: '#19f6ff', magenta: '#ff2ee6', lime: '#a6ff1f', amber: '#ffaa12', violet: '#9d4dff', blue: '#2a6bff' };
export const NEON_IDS = Object.keys(NEON);
// lights = real PointLights in the pool, shadows = how many of them cast (cube) shadows, shadowEvery = shadow refresh interval in frames
export const QUALITY = {
  low: { lights: 3, shadows: 0, shadowMap: 256, shadowEvery: 1, pixelRatio: 1, embers: 0.5 },
  medium: { lights: 4, shadows: 1, shadowMap: 256, shadowEvery: 2, pixelRatio: 1, embers: 0.75 },
  high: { lights: 8, shadows: 2, shadowMap: 512, shadowEvery: 1, pixelRatio: 1.5, embers: 1 },
};

export function detectQuality() {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width || 1e4, screen.height || 1e4) < 600;
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
  if (weak) return 'low';
  return coarse || small ? 'medium' : 'high';
}
export const resolveQuality = (q) => (QUALITY[q] ? q : detectQuality());

export function mulberry32(a) {  // same PRNG as n64/glowlights.py::_mulberry
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const color = (c) => (c instanceof THREE.Color ? c.clone() : Array.isArray(c) ? new THREE.Color(c[0], c[1], c[2]) : new THREE.Color(NEON[c] || c));

// ---------------------------------------------------------------- textures
const texCache = new Map();
function canvasTex(kind, size) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const r = size / 2; const grad = g.createRadialGradient(r, r, 0, r, r, r);
  if (kind === 'ember') { grad.addColorStop(0, 'rgba(255,255,220,1)'); grad.addColorStop(0.5, 'rgba(255,190,90,.8)'); grad.addColorStop(1, 'rgba(255,90,20,0)'); }
  else if (kind === 'halo') { grad.addColorStop(0, 'rgba(255,255,255,.75)'); grad.addColorStop(0.35, 'rgba(255,255,255,.3)'); grad.addColorStop(1, 'rgba(255,255,255,0)'); }
  else if (kind === 'flame') {  // 1-frame fallback flame
    const f = g.createRadialGradient(r, size * 0.75, 0, r, size * 0.6, r); f.addColorStop(0, 'rgba(255,250,200,1)'); f.addColorStop(0.4, 'rgba(255,160,40,.9)'); f.addColorStop(1, 'rgba(255,60,10,0)');
    g.fillStyle = f; g.beginPath(); g.ellipse(r, size * 0.62, r * 0.55, size * 0.4, 0, 0, Math.PI * 2); g.fill();
  } else if (kind === 'caustics') {
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size * 6.2832, v = y / size * 6.2832;
      const s = Math.sin(2 * u + v + 1.3 * Math.sin(u - 2 * v)) + Math.sin(-u + 2 * v + 1.3 * Math.sin(2 * u + v + 2));
      const w = Math.pow(Math.max(0, 1 - Math.abs(s) / 2.2), 5); const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.min(255, w * 330);
    }
    g.putImageData(img, 0, 0);
  } else { grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)'); }
  if (kind !== 'flame' && kind !== 'caustics') { g.fillStyle = grad; g.fillRect(0, 0, size, size); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}
/** kind: mote | halo | ember | flame | caustics. url: optional generated PNG (n64 wisps/torches/lanterns output).
 *  Await `whenTextures([...])` before building many instances to skip the loading frames. */
export function glowTexture(kind, url) {  // eslint-disable-line
  const key = kind + '|' + (url || '');
  if (texCache.has(key)) return texCache.get(key);
  let t;
  if (url) {  // generated PNG; falls back to the procedural canvas if it fails to load. t.userData.ready resolves either way.
    let done; const ready = new Promise((r) => { done = r; });
    t = new THREE.TextureLoader().load(url, () => { for (const c of t.userData.clones) c.needsUpdate = true; done(t); },
      undefined, () => { t.image = canvasTex(kind, 64).image; t.needsUpdate = true; for (const c of t.userData.clones) c.needsUpdate = true; done(t); });
    t.colorSpace = THREE.NoColorSpace; t.userData.clones = []; t.userData.ready = ready;
  } else { t = canvasTex(kind, 64); t.userData.clones = []; t.userData.ready = Promise.resolve(t); }
  if (kind === 'caustics') { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  texCache.set(key, t);
  return t;
}

export const whenTextures = (list) => Promise.all(list.map((t) => (t && t.userData && t.userData.ready) || t));
/** Clone a glow texture for independent offset/repeat (sprite-strip frames); safe before the PNG has loaded. */
export function cloneTex(t) {
  const c = t.clone();
  if (t.image && (t.image.width || t.image.data)) c.needsUpdate = true;
  else { c.version = 0; (t.userData.clones || (t.userData.clones = [])).push(c); }  // uploaded when the PNG arrives
  return c;
}

// ---------------------------------------------------------------- sprites
export function haloSprite(col, size = 1.2, tex = glowTexture('halo'), opacity = 0.5) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: color(col), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.setScalar(size); s.renderOrder = 5; s.userData.baseOpacity = opacity; s.raycast = () => {};
  return s;
}
/** Flat additive disc on the ground: fakes a pool of light where no real light is assigned (very cheap). */
export function groundGlow(col, radius = 1.5, tex = glowTexture('halo'), opacity = 0.35) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 12), new THREE.MeshBasicMaterial({ map: tex, color: color(col), transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02; m.renderOrder = 1; m.userData.baseOpacity = opacity; m.raycast = () => {};
  return m;
}

/** Suite GLBs are unlit with baked vertex light (MeshBasicMaterial). For night scenes swap to flat-shaded Lambert so
 *  torches and lanterns light them; glow parts (role flame/fish/water/glass/coal in material extras) stay unlit. */
export function litify(root, { shadows = true, tint = null } = {}) {
  const done = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const role = o.material.userData && o.material.userData.n64 && o.material.userData.n64.role;
    if (role) return;
    if (shadows) { o.castShadow = true; o.receiveShadow = true; }
    if (!o.material.isMeshBasicMaterial) return;
    let m = done.get(o.material);
    if (!m) {
      const b = o.material;
      m = new THREE.MeshLambertMaterial({ map: b.map, color: tint ? b.color.clone().multiply(tint) : b.color.clone(), vertexColors: b.vertexColors,
        transparent: b.transparent, opacity: b.opacity, side: b.side, alphaTest: b.alphaTest, flatShading: true });
      m.name = b.name; m.userData = b.userData; done.set(b, m);
    }
    o.material = m;
  });
  return root;
}

/** Replace KHR_lights_punctual lights in a loaded glTF scene with empty anchors (same name, transform and extras), so the
 *  shared LightPool provides the real lights. GLTFLoader turns a light-only node into the PointLight itself. */
export function stripLights(root) {
  const found = [];
  root.traverse((o) => { if (o.isLight) found.push(o); });
  for (const l of found) {
    const p = l.parent; if (!p) continue;
    if (l.target && l.target.parent) l.target.parent.remove(l.target);
    const a = new THREE.Object3D(); a.name = l.name; a.userData = l.userData; a.position.copy(l.position); a.quaternion.copy(l.quaternion); a.scale.copy(l.scale);
    for (const c of [...l.children]) a.add(c);
    p.add(a); p.remove(l);
  }
  return found;
}
export function findRole(root, role) {
  const out = []; root.traverse((o) => { if (o.userData && o.userData.n64 && o.userData.n64.role === role) out.push(o); }); return out;
}

// ---------------------------------------------------------------- light pool
const _v = new THREE.Vector3(), _s = new THREE.Sphere(), _fr = new THREE.Frustum(), _m = new THREE.Matrix4();
export class LightPool {
  /** scene: where the pool lights live. quality: auto|low|medium|high. gain: emitter intensity -> PointLight intensity. */
  constructor(scene, { quality = 'auto', lights, shadows, shadowMap, decay = 1.25, gain = 2.0, fadeSpeed = 5 } = {}) {
    this.quality = resolveQuality(quality);
    const q = QUALITY[this.quality];
    this.size = lights ?? q.lights; this.shadowCount = Math.min(this.size, shadows ?? q.shadows); this.shadowEvery = q.shadowEvery;
    this.gain = gain; this.fadeSpeed = fadeSpeed; this.master = 1; this.emitters = []; this.slots = []; this.frame = 0;
    for (let i = 0; i < this.size; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 6, decay);
      L.castShadow = i < this.shadowCount;
      if (L.castShadow) { const sm = shadowMap ?? q.shadowMap; L.shadow.mapSize.set(sm, sm); L.shadow.bias = -0.006; L.shadow.camera.near = 0.08; L.shadow.autoUpdate = false; }
      L.name = `glow_pool_${i}${L.castShadow ? '_shadow' : ''}`;
      scene.add(L); this.slots.push({ light: L, e: null, fade: 0, shadow: L.castShadow });
    }
  }
  /** emitter: {position: Vector3 (live), color, intensity, distance, priority, castShadow, level, flicker(t)} */
  add(e) {
    const em = Object.assign({ position: new THREE.Vector3(), color: new THREE.Color(1, 1, 1), intensity: 1, distance: 6, priority: 1, castShadow: false,
      level: 1, flicker: null, enabled: true, score: 0 }, e);
    em.color = color(em.color); this.emitters.push(em); return em;
  }
  remove(e) { const i = this.emitters.indexOf(e); if (i >= 0) this.emitters.splice(i, 1); for (const s of this.slots) if (s.e === e) { s.e = null; s.fade = 0; } }
  stats() {
    const lit = this.slots.filter((s) => s.e && s.light.intensity > 0.001);
    return { quality: this.quality, pool: this.size, shadowSlots: this.shadowCount, emitters: this.emitters.length, lit: lit.length,
      shadowsLit: lit.filter((s) => s.shadow).length };
  }
  update(camera, dt, t) {
    this.frame++;
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_m);
    const cam = camera.getWorldPosition(_v);
    for (const e of this.emitters) {
      const lvl = e.enabled ? e.level * e.intensity : 0;
      if (lvl < 0.01) { e.score = -1; continue; }
      _s.set(e.position, e.distance);
      const vis = _fr.intersectsSphere(_s) ? 1 : 0.12;
      const d = cam.distanceTo(e.position) / (e.distance * 1.5);
      e.score = e.priority * Math.min(1.5, lvl) * vis / (1 + d * d);
    }
    const ranked = this.emitters.filter((e) => e.score > 0).sort((a, b) => b.score - a.score);
    // shadow slots go to the best shadow-wanting emitters, plain slots to the best of the rest; spare shadow slots take leftovers
    const wantS = new Set(), wantP = new Set(), nP = this.size - this.shadowCount;
    for (const e of ranked) if (e.castShadow && wantS.size < this.shadowCount) wantS.add(e);
    for (const e of ranked) if (!wantS.has(e) && wantP.size < nP) wantP.add(e);
    for (const e of ranked) if (!wantS.has(e) && !wantP.has(e) && wantS.size < this.shadowCount) wantS.add(e);
    const step = Math.min(1, dt * this.fadeSpeed);
    for (const [want, sh] of [[wantS, true], [wantP, false]]) {
      const group = this.slots.filter((s) => s.shadow === sh);
      for (const s of group) if (s.e && !want.has(s.e)) { s.fade -= step; if (s.fade <= 0) { s.e = null; s.fade = 0; } }
      for (const e of want) if (!group.some((s) => s.e === e)) { const f = group.find((s) => !s.e); if (f) { f.e = e; f.fade = 0; } }
      for (const s of group) if (s.e && want.has(s.e)) s.fade = Math.min(1, s.fade + step);
    }
    for (const s of this.slots) {
      const L = s.light, e = s.e;
      if (!e) { L.intensity = 0; continue; }
      L.position.copy(e.position); L.color.copy(e.color); L.distance = e.distance;
      L.intensity = e.intensity * e.level * this.master * this.gain * s.fade * (e.flicker ? e.flicker(t) : 1);
      if (s.shadow) L.shadow.needsUpdate = this.frame % this.shadowEvery === 0;  // PointLightShadow takes camera.far from light.distance
    }
  }
  dispose() { for (const s of this.slots) { s.light.dispose && s.light.dispose(); s.light.parent && s.light.parent.remove(s.light); } this.slots = []; }
}
