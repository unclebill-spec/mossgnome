// n64-suite RPG preset demos: shared runtime (renderer sized by display.js presets, 320x240 retro @30 fps, loaders, skeletal clips, audio, HUD helpers).
import * as THREE from 'three';
import { GLTFLoader } from './vendor/addons/GLTFLoader.js';
import { clone as skClone } from './vendor/addons/SkeletonUtils.js';

THREE.ColorManagement.enabled = false;
export { THREE };
export const Q = new URLSearchParams(location.search);
export const $ = (id) => document.getElementById(id);
export async function J(url) { const r = await fetch(url); if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`); return r.json(); }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// deterministic PRNG (mulberry32)
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function makeRenderer() {
  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(320, 240, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  window.__renderer = renderer;  // the shared display layer resizes it (resolution presets)
  return renderer;
}

const texL = new THREE.TextureLoader();
const texCache = {};
export function tex(url, repeat = true, nearest = false) {
  const key = url + repeat + nearest;
  if (texCache[key]) return texCache[key];
  const t = texL.load(url);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache[key] = t;
  return t;
}
export function texRep(url, rx, ry) { const t = tex(url).clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return t; }

// ---------- glTF models + skeletal clips
const loader = new GLTFLoader();
const cache = {};
export const allMaterials = new Set();
export function load(url) {
  if (!cache[url]) cache[url] = new Promise((res) => loader.load(url, (g) => {
    g.scene.traverse((o) => { if (o.isMesh) { o.material.side = THREE.DoubleSide; o.material.fog = true; if (o.material.map) { o.material.map.colorSpace = THREE.NoColorSpace; o.material.map.needsUpdate = true; } } });
    g.scene.userData.clips = g.animations;
    res(g.scene);
  }, undefined, () => { const e = new THREE.Group(); e.userData.clips = []; res(e); }));
  return cache[url].then((s) => {
    const c = skClone(s);
    c.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; if (o.isMesh) { o.material = LIGHT.lit ? litMaterial(o.material) : o.material.clone(); o.material.userData.base = o.material.color.clone(); allMaterials.add(o.material); if (LIGHT.lit) { ensureNormals(o); o.castShadow = !o.isSkinnedMesh; o.receiveShadow = true; } } });  // skinned: see castsShadow()
    c.userData.clips = s.userData.clips;
    return c;
  });
}
export const mixers = [];
const ONCE = new Set(['jump', 'attack', 'cast', 'hit', 'death', 'wave']);
export function animate(obj) {
  const clips = obj.userData.clips || [];
  if (!clips.length) return null;
  const mixer = new THREE.AnimationMixer(obj); mixers.push(mixer);
  const acts = {};
  for (const c of clips) { const a = mixer.clipAction(c); acts[c.name] = a; if (ONCE.has(c.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } }
  const A = { mixer, acts, cur: null, name: null, has: (n) => !!acts[n],
    dur: (n) => (acts[n] ? acts[n].getClip().duration : 0),
    play(n, fade = 0.2, restart = false) {
      if (!acts[n]) return;
      if (A.name === n && !restart) return;
      const a = acts[n]; a.enabled = true; a.reset(); a.setEffectiveWeight(1); a.play();
      if (A.cur && A.cur !== a) A.cur.crossFadeTo(a, fade, false);
      A.cur = a; A.name = n;
    } };
  return A;
}
// global light level (N64 vertex-light look): multiply every model + registered material colour.
// Lit mode (Mossgnome day/night): models, terrain and paths become flat MeshLambert lit by an AmbientLight of PI (identical
// to the unlit look by day) plus the glow-kit point lights; LIGHT.k / LIGHT.tint then dim + tint the materials that stay
// unlit (water, waterfalls...) the same way the ambient light dims the lit ones.
export const LIGHT = { lit: false, k: 1, tint: new THREE.Color(1, 1, 1), v: 1, vt: null };
// The GLBs ship without vertex normals (the unlit look never needed them). Lit (Lambert + shadow) shaders still read the
// 'normal' attribute, and a missing one is undefined on the GPU: in testing the friends' bodies sometimes did not draw at all.
// Skinned characters do not cast the torch (point-light) shadows: in testing, a friend's body that went through the cube shadow
// pass sometimes stopped drawing at all afterwards (about half of the page loads, Medium / High only). The gnome keeps his.
export function castsShadow(obj, on = true) { obj.traverse((o) => { if (o.isMesh && !o.isSprite) o.castShadow = on && LIGHT.lit; }); }
export function ensureNormals(o) { const g = o.geometry; if (g && g.attributes.position && !g.attributes.normal) g.computeVertexNormals(); }
export function litMaterial(b) {
  if (!b || !b.isMeshBasicMaterial || (b.userData && b.userData.unlit)) return b.clone();
  const m = new THREE.MeshLambertMaterial({ map: b.map, color: b.color.clone(), vertexColors: b.vertexColors, transparent: b.transparent, opacity: b.opacity, side: b.side,
    alphaTest: b.alphaTest, depthWrite: b.depthWrite, fog: b.fog, flatShading: true, polygonOffset: b.polygonOffset, polygonOffsetFactor: b.polygonOffsetFactor, polygonOffsetUnits: b.polygonOffsetUnits });
  m.name = b.name; m.userData = { ...b.userData }; return m;
}
export function setAmbient(v, tint) {
  LIGHT.v = v; LIGHT.vt = tint || null;
  for (const m of allMaterials) {
    if (!m.userData.base) continue; m.color.copy(m.userData.base).multiplyScalar(v); if (tint) m.color.multiply(tint);
    if (LIGHT.lit && !m.isMeshLambertMaterial) m.color.multiply(LIGHT.tint).multiplyScalar(LIGHT.k);
  }
}
export const applyEnv = () => setAmbient(LIGHT.v, LIGHT.vt);
export function reg(mat) { if (LIGHT.lit && mat.isMeshBasicMaterial && !mat.transparent && !mat.userData.unlit) { const o = mat; mat = litMaterial(o); o.dispose(); } mat.userData.base = mat.color.clone(); allMaterials.add(mat); return mat; }

// ---------- heightmap terrain (baked vertex colours + directional shade)
export function terrain(L, groundUrl) {
  const N = L.grid, S = L.size, H = L.heights;
  const geo = new THREE.PlaneGeometry(S, S, N - 1, N - 1); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), uvs = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const gx = i % N, gz = Math.floor(i / N);
    pos.setY(i, H[gz][gx]);
    const vc = L.vertex_colors[gz * N + gx];
    cols.set([vc[0] / 255, vc[1] / 255, vc[2] / 255], i * 3);
    uvs.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, Ld = new THREE.Vector3(0.4, 0.8, 0.45).normalize();
  for (let i = 0; i < pos.count; i++) {
    const d = Math.max(0, nrm.getX(i) * Ld.x + nrm.getY(i) * Ld.y + nrm.getZ(i) * Ld.z);
    const f = 0.55 + 0.6 * d; for (let k = 0; k < 3; k++) cols[i * 3 + k] = Math.min(1, cols[i * 3 + k] * f);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mesh = new THREE.Mesh(geo, reg(new THREE.MeshBasicMaterial({ map: tex(groundUrl), vertexColors: true })));
  function heightAt(x, z) {
    const gx = clamp((x / S + 0.5) * (N - 1), 0, N - 1.001), gz = clamp((z / S + 0.5) * (N - 1), 0, N - 1.001);
    const x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0;
    const a = H[z0][x0] * (1 - fx) + H[z0][x0 + 1] * fx, b = H[z0 + 1][x0] * (1 - fx) + H[z0 + 1][x0 + 1] * fx;
    return a * (1 - fz) + b * fz;
  }
  return { mesh, heightAt, size: S };
}
// flat strip following the ground (path decal)
export function pathStrip(points, width, heightAt, url) {
  const pos = [], uv = [], idx = [];
  let v = 0;
  const pts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
    for (let k = 0; k < n; k++) pts.push([lerp(ax, bx, k / n), lerp(az, bz, k / n)]);
  }
  pts.push(points[points.length - 1]);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    let dx = q[0] - o[0], dz = q[1] - o[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const wob = width * (0.85 + 0.15 * Math.sin(i * 1.7));
    for (const s of [-1, 1]) { const x = p[0] - dz * wob * s, z = p[1] + dx * wob * s; pos.push(x, heightAt(x, z) + 0.06, z); uv.push(s * 0.5 + 0.5, v); }
    v += 0.5;
    if (i < pts.length - 1) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return new THREE.Mesh(g, reg(new THREE.MeshBasicMaterial({ map: tex(url), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })));
}

// ---------- audio (HTMLAudio; muted until the first user gesture unless autoplay is allowed)
// Nothing makes a sound until loading has finished AND the player has made a deliberate tap / key press after that
// (mobile: touches during load used to fire title-menu sounds before anything was ready).
export const audio = { ready: false, unlocked: false, music: null };
const SILENT = { pause() {}, play() { return Promise.resolve(); }, volume: 0 };
export function sfx(name, vol = 0.6) { if (!audio.unlocked) return SILENT; const a = new Audio(`sfx/${name}.wav`); a.volume = vol; a.play().catch(() => {}); return a; }
let armed = false;  // a touch that began during loading and lifts afterwards is not a deliberate tap
for (const ev of ['pointerdown', 'touchstart']) addEventListener(ev, () => { if (audio.ready) armed = true; }, { capture: true, passive: true });
function unlockAudio(e) {
  if (!audio.ready || audio.unlocked || (e.type !== 'keydown' && e.type !== 'gamepad' && !armed)) return; audio.unlocked = true;
  const m = audio.music; if (m && m.a && m.a.paused) m.a.play().catch(() => { if (e.type === 'gamepad') audio.unlocked = false; });
}
// controller buttons are not DOM gestures; try to start audio anyway (browsers that refuse will start it on the next tap / key)
export function audioKick() { if (audio.ready && !audio.unlocked) unlockAudio({ type: 'gamepad' }); }
for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) addEventListener(ev, unlockAudio, true);
// called once the game is fully loaded: drop the input-swallowing loading overlay and allow audio on the next tap
export function loaded() {
  if (audio.ready) return; audio.ready = true; window.__loaded = true;
  const el = document.getElementById('loading'); if (el) { el.classList.add('done'); setTimeout(() => el.remove(), 400); }
}
export class Music {
  constructor(man) { this.man = man; this.a = null; this.mood = null; audio.music = this; }
  play(mood, { loop = true, vol = 0.55 } = {}) {
    if (this.mood === mood) return; this.stop();
    const t = (this.man.music || []).find((m) => m.mood === mood); if (!t) return;
    this.a = new Audio(t.wav); this.a.loop = loop && t.loop !== false && (t.always_on !== false); this.a.volume = vol; this.mood = mood;
    if (audio.unlocked) this.a.play().catch(() => {});  // otherwise starts on the first tap after load
  }
  stop() { if (this.a) { this.a.pause(); this.a = null; } this.mood = null; }
}

// ---------- HUD helpers (normalised 4:3 rects -> % CSS)
// HUD rects / circles come in 4:3 layout space. Each item hugs its nearest edge (left / right / centre) in stage-height units, so a 4:3 stage
// looks exactly as before while a wide phone keeps thumb controls in the corners. --sal/--sar/--sat/--sab (safe-area insets) keep them off
// notches and the home bar; --tmin is the minimum touch-target size, and circles never get pushed off the edge.
const AX = 4 / 3;
const hx = (x, w, side) => (side === 'l' ? `calc(${x * AX * 100}cqh + var(--sal, 0px))` : side === 'r' ? `calc(100% - ${(1 - x) * AX * 100}cqh - var(--sar, 0px))` : `calc(50% + ${(x - 0.5) * AX * 100}cqh)`);
const side = (cx) => (cx < 0.4 ? 'l' : cx > 0.6 ? 'r' : 'c');
export function place(el, r) {
  const s = side((r[0] + r[2]) / 2), w = (r[2] - r[0]) * AX * 100;
  const left = s === 'r' ? `calc(100% - ${(1 - r[0]) * AX * 100}cqh - var(--sar, 0px))` : hx(r[0], w, s);
  const top = r[1] < 0.5 ? `calc(${r[1] * 100}% + var(--sat, 0px))` : `calc(${r[1] * 100}% - var(--sab, 0px))`;
  Object.assign(el.style, { position: 'absolute', left, top, width: `${w}cqh`, height: `${(r[3] - r[1]) * 100}%` }); el.dataset.side = s; return el;
}
export function placeCircle(el, c, minTop = 0) {
  const s = side(c[0]), d = 'var(--d)', pad = `calc(${d} / 2 + 4px)`;
  const left = s === 'l' ? `calc(max(${c[0] * AX * 100}cqh, ${pad}) + var(--sal, 0px))` : s === 'r' ? `calc(100% - max(${(1 - c[0]) * AX * 100}cqh, ${pad}) - var(--sar, 0px))` : hx(c[0], 0, 'c');
  const top = c[1] < 0.5 ? `calc(max(${c[1] * 100}%, ${pad}, ${typeof minTop === 'number' ? `${minTop}px` : minTop}) + var(--sat, 0px))` : `calc(min(${c[1] * 100}%, 100% - ${pad}) - var(--sab, 0px))`;
  el.style.setProperty('--d', `max(${c[2] * 200}cqh, var(--tmin, 0px))`);
  Object.assign(el.style, { position: 'absolute', left, top, width: d, height: d, marginLeft: `calc(${d} / -2)`, marginTop: `calc(${d} / -2)` }); el.dataset.side = s; return el;
}
export function div(cls, parent = $('hud'), html = '') { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; parent.appendChild(d); return d; }
export function font(name, file) { const f = new FontFace(name, `url(fonts/${file})`); document.fonts.add(f); return f.load().catch(() => null); }
export function typewriter(el, text, cps = 30, onDone) {
  let i = 0; el.textContent = '';
  if (el._tw) clearInterval(el._tw);
  el._tw = setInterval(() => { i++; el.textContent = text.slice(0, i); if (i >= text.length) { clearInterval(el._tw); el._tw = null; onDone && onDone(); } }, 1000 / cps);
}
// pop-up damage numbers: large white serif with black outline, appear instantly then float up
export function floatText(camera, worldPos, text, cls = 'float') {
  const v = worldPos.clone().project(camera);
  if (v.z > 1) return;
  const d = div(cls, $('hud'), text);
  d.style.left = `${(v.x * 0.5 + 0.5) * 100}%`; d.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`;
  setTimeout(() => d.remove(), 900);
}

// ---------- input
export const keys = {};
export const pressed = [];
addEventListener('keydown', (e) => { if (!audio.ready) { e.preventDefault(); return; } if (!keys[e.code]) pressed.push(e.code); keys[e.code] = true; if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
export function takePressed() { return pressed.splice(0, pressed.length); }
export function pressKey(code) { pressed.push(code); }  // virtual presses (controller buttons, mouse clicks)

// ---------- 30 fps capped loop
export function loop(renderer, scene, getCamera, update) {
  const clock = new THREE.Clock();
  let acc = 0, frames = 0, fpsT = 0;
  const st = { fps: 0, t: 0 };
  function f() {
    requestAnimationFrame(f);
    acc += clock.getDelta();
    if (acc < 1 / 30 - 0.002) return;
    const dt = Math.min(acc, 0.1); acc = 0; st.t += dt;
    frames++; fpsT += dt; if (fpsT > 1) { st.fps = frames / fpsT; frames = 0; fpsT = 0; }
    update(dt, st.t);
    for (const m of mixers) m.update(dt);
    renderer.render(typeof scene === 'function' ? scene() : scene, getCamera());
  }
  f();
  return st;
}

// ---------- canvas-drawn sprites (2D clouds, puffs, bubbles)
export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.magFilter = THREE.LinearFilter; return t;
}
export const cloudTex = () => canvasTex(128, 64, (g, w, h) => {
  g.fillStyle = '#ffffff';
  for (const [x, y, r] of [[30, 40, 18], [52, 30, 22], [78, 34, 20], [98, 42, 14], [64, 46, 16], [42, 48, 12]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  g.fillStyle = '#dfe8f4'; g.fillRect(14, 50, 100, 6);
});
export const puffTex = () => canvasTex(32, 32, (g) => { const gr = g.createRadialGradient(16, 16, 2, 16, 16, 15); gr.addColorStop(0, 'rgba(235,225,200,0.9)'); gr.addColorStop(1, 'rgba(235,225,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); });
export const bubbleTex = () => canvasTex(32, 32, (g) => { g.strokeStyle = 'rgba(200,230,255,0.95)'; g.lineWidth = 2.5; g.beginPath(); g.arc(16, 16, 11, 0, 7); g.stroke(); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(10, 9, 4, 4); });
