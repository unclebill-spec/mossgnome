// Luminescent butterflies from `n64 butterflies` GLBs: big, slow, graceful flyers with glowing neon wing patterns, a soft
// pulse, glides, and short rests on mushroom caps (perches). A whole swarm costs 4 draw calls (instanced body, fore wings,
// hind wings + one Points draw for the halo sprites). Only `lights` butterflies (0-2) borrow a real light from the shared
// LightPool, so phones stay cheap; the rest glow through the halo.
//   const sw = new ButterflySwarm(gltf, { preset: 'grove', seed: 3, pool, perches: ButterflySwarm.perchesFrom(caps) });
//   scene.add(sw.object);  sw.update(dt, t);  sw.level = dayNight.night;   // wings glow brighter at night
// Wing angles use the same curves as the GLB's flap / glide / perch clips (n64/glow_butterflies.py WING), so a single
// hero butterfly can also just play the clips with an AnimationMixer.
import * as THREE from 'three';
import { NEON, NEON_IDS, color, glowTexture, mulberry32 } from './glowkit.js';

// same presets as n64/glow_butterflies.py::PRESETS (n64 butterflies writes them to presets/butterflies.json)
export const BUTTERFLY_PRESETS = {
  grove: { count: 8, colors: ['cyan', 'magenta', 'lime', 'amber', 'violet', 'blue', 'mixed'], span: 1.2, speed: 0.7, flap: 1.25, glide: 0.35, pulse: 0.22, min: 0.45, center: [0, 1.6, 0], bounds: [14, 1.8, 12], height: [0.8, 3.4], perch: 0.35, perchTime: [3, 8], lights: 2 },
  moonwings: { count: 4, colors: ['blue', 'violet', 'cyan'], span: 1.7, speed: 0.55, flap: 0.9, glide: 0.5, pulse: 0.15, min: 0.5, center: [0, 2.2, 0], bounds: [16, 2.2, 14], height: [1.2, 4.0], perch: 0.2, perchTime: [5, 10], lights: 2 },
  neon_flutter: { count: 14, colors: ['cyan', 'magenta', 'lime', 'amber', 'violet', 'blue'], span: 0.8, speed: 0.9, flap: 1.7, glide: 0.2, pulse: 0.35, min: 0.4, center: [0, 1.4, 0], bounds: [10, 1.6, 10], height: [0.6, 2.6], perch: 0.45, perchTime: [2, 5], lights: 2 },
  emberwings: { count: 6, colors: ['amber', 'magenta', 'amber', 'mixed'], span: 1.3, speed: 0.65, flap: 1.1, glide: 0.35, pulse: 0.25, min: 0.45, center: [0, 1.4, 0], bounds: [12, 1.6, 12], height: [0.7, 2.8], perch: 0.3, perchTime: [3, 7], lights: 1 },
};
// wing-angle curves (radians, + = wing up), same table as glow_butterflies.py WING
export const WING = { up: 1.2, down: -0.5, downShare: 0.42, hindLag: 0.06, glide: 0.3, tremble: 0.05, perchOpen: 0.5, perchClosed: 1.45, bob: 0.03 };
export const SPAN0 = 0.864;  // GLB wingspan at scale 1
const FORE = [[0, 0.03], [0.07, 0.11], [0.18, 0.17], [0.30, 0.20], [0.40, 0.16], [0.41, 0.07], [0.32, 0], [0.18, -0.03], [0.05, -0.02]];
const HIND = [[0, -0.01], [0.10, -0.04], [0.22, -0.08], [0.30, -0.16], [0.28, -0.26], [0.19, -0.33], [0.10, -0.30], [0.04, -0.18], [0, -0.07]];
const HINGE_FORE = [0.022, 0.012, 0.012], HINGE_HIND = [0.02, 0.006, -0.018];

export function flapAngle(u) {
  u -= Math.floor(u); const { up, down, downShare: e } = WING;
  return u < e ? up - (up - down) * (0.5 - 0.5 * Math.cos(Math.PI * u / e)) : down + (up - down) * (0.5 - 0.5 * Math.cos(Math.PI * (u - e) / (1 - e)));
}
export const glideAngle = (u) => WING.glide + WING.tremble * Math.sin(2 * Math.PI * 2 * u);
export const perchAngle = (u) => WING.perchOpen + (WING.perchClosed - WING.perchOpen) * (0.5 + 0.5 * Math.cos(2 * Math.PI * u));

// ---------------------------------------------------------------- geometry (from the GLB, or a procedural fallback)
function wingGeo(poly, uvmap, half) {  // fan from the centroid, same mapping as the Python mesh
  const [xe, z0, ze] = uvmap, P = poly.map(([x, z]) => [x, 0.035 * (x / 0.4) ** 2, z]);
  const c = P.reduce((a, p) => [a[0] + p[0] / P.length, a[1] + p[1] / P.length, a[2] + p[2] / P.length], [0, 0, 0]);
  const pos = [], uv = [], U = (p) => [p[0] / xe * 0.5 + 0.5 * half, (p[2] - z0) / ze];
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; pos.push(...c, ...a, ...b); uv.push(...U(c), ...U(a), ...U(b)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
function partGeo(root, name) {
  let m = null; root.traverse((o) => { if (!m && o.name === name) m = o; });
  if (m && !m.isMesh) { let c = null; m.traverse((o) => { if (!c && o.isMesh) c = o; }); m = c; }
  return m;
}

const VERT = /* glsl */`
attribute vec3 aColor; attribute float aSize; uniform float uScale; varying vec3 vColor;
void main() { vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 1.0, 160.0); }`;
const FRAG = /* glsl */`
uniform sampler2D uMap; varying vec3 vColor;
void main() { float a = texture2D(uMap, gl_PointCoord).a; if (a < 0.01) discard; gl_FragColor = vec4(vColor * a, 1.0); }`;

const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _h = new THREE.Matrix4(), _r = new THREE.Matrix4(), _mir = new THREE.Matrix4().makeScale(-1, 1, 1);
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
const _white = new THREE.Color(1, 1, 1), _sz = new THREE.Vector2(), _halo = new THREE.Vector3(0, 0.01, -0.02);
const wrap = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

export class ButterflySwarm {
  /** gltf: any loaded butterfly_<color>.glb (geometry + wing pattern; the tint comes per instance). opts: preset or preset
   *  fields (count, colors, span, speed, flap, glide, pulse, min, center, bounds, height, perch, perchTime, lights), seed,
   *  pool (LightPool), perches ([Vector3 | [x,y,z]]), haloTexture, wingTexture (fallback when no gltf), palette, level */
  constructor(gltf, opts = {}) {
    const P = { ...(BUTTERFLY_PRESETS[opts.preset] || BUTTERFLY_PRESETS.grove), ...opts };
    this.p = P; this.seed = opts.seed ?? 1; this.palette = { ...NEON, ...(opts.palette || {}) }; const n = this.count = P.count;
    // parts
    let bodyGeo, foreGeo, hindGeo, wingMap = null, hf = HINGE_FORE, hh = HINGE_HIND;
    const root = gltf && (gltf.scene || gltf);
    const body = root && partGeo(root, 'body'), fore = root && partGeo(root, 'wing_l_fore'), hind = root && partGeo(root, 'wing_l_hind');
    if (body && fore && hind) {
      bodyGeo = body.geometry.clone(); foreGeo = fore.geometry.clone(); hindGeo = hind.geometry.clone();
      const ca = bodyGeo.getAttribute('color');  // body: neutral greys so the instance tint shows on the antenna tips
      if (ca) for (let i = 0; i < ca.count; i++) { const l = 0.3 * ca.getX(i) + 0.59 * ca.getY(i) + 0.11 * ca.getZ(i); ca.setXYZ(i, l, l, l); }
      foreGeo.deleteAttribute('color'); hindGeo.deleteAttribute('color');
      wingMap = fore.material.map || null;
      if (wingMap && THREE.ColorManagement.enabled === false) wingMap.colorSpace = THREE.NoColorSpace;  // raw glow mask in unmanaged scenes
      const wf = root.getObjectByName('wing_l_fore'), wh = root.getObjectByName('wing_l_hind');
      if (wf) hf = wf.position.toArray(); if (wh) hh = wh.position.toArray();
    } else {
      bodyGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.2, 5).rotateX(Math.PI / 2);
      foreGeo = wingGeo(FORE, [0.42, -0.04, 0.26], 0); hindGeo = wingGeo(HIND, [0.32, -0.34, 0.34], 1);
      wingMap = opts.wingTexture || glowTexture('halo');
    }
    this.hinges = [new THREE.Vector3(...hf), new THREE.Vector3(...hh)];
    const bodyMat = new THREE.MeshBasicMaterial({ vertexColors: !!bodyGeo.getAttribute('color'), fog: true });
    const wingMat = new THREE.MeshBasicMaterial({ map: wingMap, side: THREE.DoubleSide, fog: false });
    this.body = new THREE.InstancedMesh(bodyGeo, bodyMat, n); this.fore = new THREE.InstancedMesh(foreGeo, wingMat, 2 * n); this.hind = new THREE.InstancedMesh(hindGeo, wingMat, 2 * n);
    for (const [im, nm] of [[this.body, 'butterfly_bodies'], [this.fore, 'butterfly_fore_wings'], [this.hind, 'butterfly_hind_wings']]) {
      im.name = nm; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < im.count; i++) im.setColorAt(i, _white);
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    // halos: one Points draw
    const hg = new THREE.BufferGeometry();
    this.hPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.hCol = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.hSize = new THREE.BufferAttribute(new Float32Array(n), 1);
    hg.setAttribute('position', this.hPos); hg.setAttribute('aColor', this.hCol); hg.setAttribute('aSize', this.hSize);
    this.uniforms = { uScale: { value: 400 }, uMap: { value: opts.haloTexture || glowTexture('halo') } };
    this.halos = new THREE.Points(hg, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.halos.name = 'butterfly_halos'; this.halos.frustumCulled = false; this.halos.renderOrder = 6;
    this.halos.onBeforeRender = (renderer, scene, camera) => { renderer.getDrawingBufferSize(_sz); this.uniforms.uScale.value = camera.isPerspectiveCamera ? _sz.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) : _sz.y; };
    this.object = new THREE.Group(); this.object.name = `butterflies_${opts.preset || 'custom'}`; this.object.add(this.body, this.fore, this.hind, this.halos);
    // perches + butterflies
    this.perches = []; for (const p of opts.perches || []) this.addPerch(p);
    this.b = [];
    const c = P.center, bd = P.bounds, hr = P.height;
    for (let i = 0; i < n; i++) {
      const nx = mulberry32(this.seed * 7919 + i * 104729 + 11), R = Array.from({ length: 8 }, nx);
      const id = P.colors[i % P.colors.length];
      this.b.push({ nx, pos: new THREE.Vector3(c[0] + (R[0] - 0.5) * bd[0], hr[0] + R[1] * (hr[1] - hr[0]), c[2] + (R[2] - 0.5) * bd[2]), yaw: R[3] * 6.2832, pitch: 0, bank: 0,
        speed: P.speed * (0.8 + 0.4 * R[4]), mode: 'fly', perch: -1, last: -1, timer: 0, cool: 0, glide: false, gt: R[5] * 3, ph: R[6], pph: R[7], pulsePh: nx() * 6.2832,
        rate: 0.8 + 0.4 * nx(), flapHz: P.flap * (0.85 + 0.3 * nx()), scale: (P.span / SPAN0) * (0.85 + 0.3 * nx()), id, mixed: id === 'mixed',
        col: id === 'mixed' ? null : color(this.palette[id] || id), w: [1, 0, 0], wing: WING.glide, hindWing: WING.glide, bright: 1, target: new THREE.Vector3(), halo: new THREE.Vector3() });
    }
    for (let i = 0; i < n; i++) this._pick(i);
    this._level = opts.level ?? 1; this.t = 0;
    this.pool = opts.pool || null; this.emitters = [];
    if (this.pool) for (let i = 0; i < Math.min(P.lights || 0, n); i++) {
      this.emitters.push({ i, e: this.pool.add({ color: this.b[i].col ? this.b[i].col.clone() : new THREE.Color(1, 0.9, 1), intensity: opts.lightIntensity ?? 0.8, distance: opts.lightDistance ?? 3.4, priority: 0.6 }) });
    }
    this._write(0);
  }
  /** Top-centre of each object's bounding box (mushroom caps, stones...) as perch points. */
  static perchesFrom(objects, lift = 0.01) {
    const box = new THREE.Box3(), out = [];
    for (const o of objects) { if (!o) continue; o.updateMatrixWorld(true); box.setFromObject(o); if (box.isEmpty()) continue; const p = box.getCenter(new THREE.Vector3()); p.y = box.max.y + lift; out.push(p); }
    return out;
  }
  addPerch(p) { this.perches.push({ p: p.isVector3 ? p.clone() : new THREE.Vector3(...p), busy: -1 }); return this.perches.length - 1; }
  get level() { return this._level; }
  set level(v) { this._level = Math.max(0, Math.min(1, v)); }
  _pick(i) {
    const b = this.b[i], P = this.p;
    const free = this.perches.map((q, k) => k).filter((k) => this.perches[k].busy < 0 && k !== b.last);
    if (free.length && b.cool <= 0 && b.nx() < P.perch) {
      free.sort((a, c) => this.perches[a].p.distanceToSquared(b.pos) - this.perches[c].p.distanceToSquared(b.pos));
      const k = free[Math.min(free.length - 1, Math.floor(b.nx() * 3))];
      this.perches[k].busy = i; b.perch = k; b.mode = 'land'; b.target.copy(this.perches[k].p); b.target.y += 0.015; return;
    }
    const c = P.center, bd = P.bounds, hr = P.height;
    b.mode = 'fly'; b.target.set(c[0] + (b.nx() - 0.5) * bd[0], hr[0] + b.nx() * (hr[1] - hr[0]), c[2] + (b.nx() - 0.5) * bd[2]);
  }
  /** Advance the simulation (no rendering work); call update() once per frame instead. */
  step(dt) {
    const P = this.p; this.t += dt; const t = this.t;
    for (let i = 0; i < this.count; i++) {
      const b = this.b[i]; b.cool -= dt;
      let want = 0;  // 0 fly, 1 glide, 2 perch
      if (b.mode === 'perch') {
        want = 2; b.timer -= dt; b.pph += dt / 4;
        if (b.timer <= 0) {  // take off: up and away, short cooldown before the next landing
          this.perches[b.perch].busy = -1; b.last = b.perch; b.perch = -1; b.cool = 2; b.mode = 'fly'; b.pitch = 0.5; want = 0;
          b.target.set(b.pos.x + (b.nx() - 0.5) * 4, b.pos.y + 1.2, b.pos.z + (b.nx() - 0.5) * 4);
        }
      } else {
        _p.subVectors(b.target, b.pos); let dist = _p.length();
        if (b.mode === 'fly' && dist < 0.7) { this._pick(i); _p.subVectors(b.target, b.pos); dist = _p.length(); }
        if (b.mode === 'land' && dist < 0.1) {
          b.pos.copy(b.target); b.mode = 'perch'; b.pitch = 0; b.bank = 0; b.pph = 0.5; b.timer = P.perchTime[0] + b.nx() * (P.perchTime[1] - P.perchTime[0]); want = 2;
        } else {
          const near = b.mode === 'land' && dist < 1.6, rate = 1.1 * (near ? 2.2 : 1);
          const dy = wrap(Math.atan2(_p.x, _p.z) - b.yaw);
          let turn = Math.max(-rate * dt, Math.min(rate * dt, dy));
          if (b.mode === 'fly') turn += Math.sin(t * 0.6 + b.pulsePh) * 0.35 * dt;  // lazy meander
          b.yaw += turn;
          b.bank += (Math.max(-0.55, Math.min(0.55, -turn / Math.max(dt, 1e-4) * 0.5)) - b.bank) * Math.min(1, dt * 3);
          if (b.mode === 'fly') { b.gt -= dt; if (b.gt <= 0) { b.glide = b.nx() < P.glide * 1.6; b.gt = b.glide ? 0.8 + 1.4 * b.nx() : 1.2 + 2.5 * b.nx(); } } else b.glide = false;
          const pl = b.mode === 'land' ? 0.9 : 0.6;
          let wp = Math.max(-pl, Math.min(pl, Math.atan2(_p.y, Math.max(Math.hypot(_p.x, _p.z), 0.3))));
          if (b.glide) wp = Math.min(wp, -0.08);
          b.pitch += (wp - b.pitch) * Math.min(1, dt * 2);
          const spd = b.speed * (b.mode === 'land' ? Math.max(0.35, Math.min(1, dist / 1.2)) : 1) * (b.glide ? 0.85 : 1), cp = Math.cos(b.pitch);
          if (near && dist < 0.6) b.pos.addScaledVector(_p, Math.min(dist, spd * dt) / dist);  // final approach: glide straight onto the cap
          else { b.pos.x += Math.sin(b.yaw) * cp * spd * dt; b.pos.y += Math.sin(b.pitch) * spd * dt; b.pos.z += Math.cos(b.yaw) * cp * spd * dt; }
          b.pos.y = Math.max(0.25, b.pos.y);
          b.ph += b.flapHz * dt * (b.pitch > 0.2 ? 1.3 : 1) * (b.glide ? 0.2 : 1);
          want = b.glide ? 1 : 0;
        }
      }
      const k = Math.min(1, dt * 4);
      for (let j = 0; j < 3; j++) b.w[j] += ((j === want ? 1 : 0) - b.w[j]) * k;
      const g = glideAngle(t * 0.5 + b.pulsePh), pa = perchAngle(b.pph);
      b.wing = b.w[0] * flapAngle(b.ph) + b.w[1] * g + b.w[2] * pa;
      b.hindWing = b.w[0] * flapAngle(b.ph - WING.hindLag) + b.w[1] * g + b.w[2] * pa;
      b.bright = P.min + (1 - P.min) * Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * P.pulse * b.rate * t + b.pulsePh), 1.4);
    }
  }
  /** Fast-forward `seconds` (e.g. so some butterflies are already resting when a scene opens). */
  warm(seconds, dt = 1 / 20) { for (let s = 0; s < seconds; s += dt) this.step(dt); this._write(this.t); }
  update(dt) { this.step(Math.min(dt, 0.1)); this._write(this.t); }
  _colorOf(b, t, out, hind = false) {
    if (!b.mixed) return out.copy(b.col);
    const x = ((t * 0.1 + b.pulsePh + (hind ? 2 : 0)) % 6 + 6) % 6, k = Math.floor(x);  // two-tone, drifting through the neons
    return out.set(this.palette[NEON_IDS[k]]).lerp(_c2.set(this.palette[NEON_IDS[(k + 1) % 6]]), x - k);
  }
  _write(t) {
    const lv = this._level;
    for (let i = 0; i < this.count; i++) {
      const b = this.b[i], s = b.scale;
      _e.set(-b.pitch, b.yaw, b.bank); _q.setFromEuler(_e); _s.setScalar(s);
      _p.copy(b.pos); _p.y += b.w[0] * WING.bob * SPAN0 * s * Math.sin(2 * Math.PI * (b.ph - 0.25));
      _m.compose(_p, _q, _s); this.body.setMatrixAt(i, _m);
      for (const [im, h, a] of [[this.fore, this.hinges[0], b.wing], [this.hind, this.hinges[1], b.hindWing]]) {
        _w.multiplyMatrices(_m, _h.makeTranslation(h.x, h.y, h.z)).multiply(_r.makeRotationZ(a)); im.setMatrixAt(2 * i, _w);
        _w.multiplyMatrices(_m, _h.makeTranslation(-h.x, h.y, h.z)).multiply(_r.makeRotationZ(-a)).multiply(_mir); im.setMatrixAt(2 * i + 1, _w);
      }
      const glow = b.bright * (0.3 + 0.95 * lv);
      this._colorOf(b, t, _c).multiplyScalar(glow); this.fore.setColorAt(2 * i, _c); this.fore.setColorAt(2 * i + 1, _c);
      const fr = _c.r, fg = _c.g, fb = _c.b;
      this._colorOf(b, t, _c, true).multiplyScalar(glow); this.hind.setColorAt(2 * i, _c); this.hind.setColorAt(2 * i + 1, _c);
      _c.setRGB(fr, fg, fb).multiplyScalar(0.6 / Math.max(glow, 0.05)).lerp(_white, 0.4).multiplyScalar(0.55 + 0.45 * lv); this.body.setColorAt(i, _c);
      b.halo.copy(_halo).applyMatrix4(_m);
      this.hPos.setXYZ(i, b.halo.x, b.halo.y, b.halo.z);
      const hk = b.bright * lv * 0.8; this.hCol.setXYZ(i, fr / Math.max(glow, 0.05) * hk, fg / Math.max(glow, 0.05) * hk, fb / Math.max(glow, 0.05) * hk);
      this.hSize.setX(i, SPAN0 * 2.4 * s);
    }
    for (const im of [this.body, this.fore, this.hind]) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
    this.hPos.needsUpdate = this.hCol.needsUpdate = this.hSize.needsUpdate = true;
    if (this.emitters.length) {
      this.object.updateMatrixWorld();
      for (const { i, e } of this.emitters) { const b = this.b[i]; e.position.copy(b.halo).applyMatrix4(this.object.matrixWorld); this._colorOf(b, t, e.color); e.level = b.bright * lv; }
    }
  }
  /** World-space state of butterfly i (before the swarm object's own transform). */
  butterflyAt(i) { const b = this.b[i]; return { position: b.pos.clone(), mode: b.mode, wing: b.wing, brightness: b.bright, color: b.id, perch: b.perch, scale: b.scale }; }
  stats() {
    const m = (k) => this.b.filter((b) => b.mode === k).length;
    return { count: this.count, flying: m('fly'), landing: m('land'), perched: m('perch'), perches: this.perches.length, lights: this.emitters.length, draws: 4 };
  }
  dispose() {
    for (const { e } of this.emitters) this.pool && this.pool.remove(e);
    for (const o of [this.body, this.fore, this.hind, this.halos]) { o.geometry.dispose(); o.material.dispose(); }
    this.object.parent && this.object.parent.remove(this.object);
  }
}
