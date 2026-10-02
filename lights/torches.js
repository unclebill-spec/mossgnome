// Torches (wall torch, standing torch, brazier) from `n64 torches` GLBs:
//   - the GLB 'flicker' clip scales/sways the vertex-coloured flame cards (made additive here)
//   - an animated billboard flame (8-frame strip), a warm halo sprite and a ground-glow disc
//   - rising embers: one Points draw per torch, animated in the vertex shader
//   - one flickering light emitter in the shared LightPool. It asks for a shadow; the pool's quality preset decides how
//     many torches actually get a shadow-casting light (phones: 0-1, desktop: 2), nearest/most visible first.
//   const t = new Torch(gltf, { pool, textures: torchTextures('lights/') }); scene.add(t.object); t.update(dt, time);
import * as THREE from 'three';
import { QUALITY, cloneTex, color, findRole, glowTexture, groundGlow, haloSprite, mulberry32, stripLights } from './glowkit.js';

export function torchTextures(base = '', flame = 'flame_strip.png') {
  return { flame: glowTexture('flame', base + 'sprites/' + flame), ember: glowTexture('ember', base + 'sprites/ember.png'), halo: glowTexture('halo', base + 'sprites/halo.png'), frames: 8 };
}
const EMBER_VERT = /* glsl */`
attribute vec4 aR; uniform float uTime, uRise, uSpread, uLife, uSize, uScale, uLevel;
varying float vA; varying vec3 vC;
void main() {
  float age = fract(uTime / uLife * (0.7 + 0.6 * aR.x) + aR.y);
  vec3 p = vec3((aR.z - 0.5) * uSpread * 2.0 + sin(age * 6.0 + aR.w * 6.0) * 0.06 * age, age * uRise, (aR.w - 0.5) * uSpread * 2.0 + cos(age * 5.0 + aR.z * 6.0) * 0.06 * age);
  vA = pow(1.0 - age, 1.5) * uLevel * step(0.02, age);
  vC = mix(vec3(1.0, 0.92, 0.55), vec3(1.0, 0.28, 0.05), age);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uScale * (1.0 - age * 0.6) / max(0.1, -mv.z), 1.0, 24.0);
}`;
const EMBER_FRAG = /* glsl */`
uniform sampler2D uMap; varying float vA; varying vec3 vC;
void main() { float a = texture2D(uMap, gl_PointCoord).a * vA; if (a < 0.02) discard; gl_FragColor = vec4(vC * a * 1.6, 1.0); }`;

const flameMats = new WeakMap();
function additive(m) {
  if (flameMats.has(m)) return flameMats.get(m);
  const a = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  a.userData = m.userData; flameMats.set(m, a); return a;
}
const _sz = new THREE.Vector2();

export class Torch {
  /** gltf: loaded torch GLB. opts: pool, textures (torchTextures()), shadows (ask for a shadow light), selfShadow (torch body casts too),
   *  seed, level, quality (ember density), groundGlow (false = no fake light disc) */
  constructor(gltf, opts = {}) {
    const rnd = mulberry32((opts.seed ?? 1) * 131 + 7);
    this.object = gltf.scene.clone(true); this.object.name = gltf.scene.name || 'torch';
    stripLights(this.object);
    const tex = opts.textures || torchTextures();
    this.lightNode = findRole(this.object, 'light')[0];
    const L = (this.lightNode && this.lightNode.userData.n64) || { color: [1, 0.62, 0.28], intensity: 2.4, distance: 7, flicker: 0.22 };
    this.color = color(L.color);
    this.flames = [];
    this.object.traverse((o) => {
      if (o.isMesh) {
        const role = o.material.userData && o.material.userData.n64 && o.material.userData.n64.role;
        if (role === 'flame') { o.material = additive(o.material); o.castShadow = false; o.receiveShadow = false; o.renderOrder = 4; }
        else { o.castShadow = !!opts.selfShadow; o.receiveShadow = true; }  // the torch body would only shadow its own base
      }
      if (o.userData && o.userData.n64 && o.userData.n64.role === 'flame') this.flames.push(o);
    });
    // billboard flames + halo at the main flame
    const main = this.flames[0];
    const frames = tex.frames || 8;
    this.sprites = [];
    for (const f of this.flames) {
      const t = cloneTex(tex.flame); t.repeat.set(1 / frames, 1);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color: 0xffffff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const sc = (f.userData.n64 && f.userData.n64.scale) || 1;
      s.scale.set(0.24 * sc, 0.38 * sc, 1); s.center.set(0.5, 0.12); s.position.copy(f.position); s.renderOrder = 5; s.raycast = () => {};
      s.userData.frame = Math.floor(rnd() * frames); s.userData.base = s.scale.clone();
      this.object.add(s); this.sprites.push({ s, t, frames });
    }
    this.halo = haloSprite(this.color, 1.0 + 0.5 * (this.flames.length > 1), tex.halo, 0.55);
    if (this.lightNode) this.halo.position.copy(this.lightNode.position); else if (main) this.halo.position.copy(main.position);
    this.object.add(this.halo);
    this.ground = opts.groundGlow === false ? null : groundGlow(this.color, (L.distance || 7) * 0.3, tex.halo, 0.2);
    if (this.ground) { this.ground.position.set(this.halo.position.x, 0.03, this.halo.position.z + (this.object.name.includes('wall') ? 0.6 : 0)); this.object.add(this.ground); }
    // embers
    const eNode = findRole(this.object, 'embers')[0];
    const E = (eNode && eNode.userData.n64) || { count: 10, rise: 1.1, spread: 0.08, life: 1.4 };
    const dens = QUALITY[opts.quality] ? QUALITY[opts.quality].embers : 1;
    const n = Math.max(2, Math.round(E.count * dens));
    const g = new THREE.BufferGeometry(); const R = new Float32Array(n * 4); for (let i = 0; i < n * 4; i++) R[i] = rnd();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aR', new THREE.BufferAttribute(R, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, E.rise / 2, 0), E.rise);
    this.eu = { uTime: { value: 0 }, uRise: { value: E.rise }, uSpread: { value: E.spread }, uLife: { value: E.life }, uSize: { value: 0.05 }, uScale: { value: 400 }, uLevel: { value: 1 }, uMap: { value: tex.ember } };
    this.embers = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG, uniforms: this.eu, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.embers.onBeforeRender = (r, s, cam) => { r.getDrawingBufferSize(_sz); this.eu.uScale.value = _sz.y / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov || 50) / 2)); };
    this.embers.renderOrder = 6;
    (eNode || this.object).add(this.embers);
    // animation
    this.mixer = null;
    const clip = (gltf.animations || []).find((c) => c.name === 'flicker');
    if (clip) { this.mixer = new THREE.AnimationMixer(this.object); const a = this.mixer.clipAction(clip); a.play(); a.time = rnd() * clip.duration; }
    // light emitter
    const ph = rnd() * 100, fl = L.flicker ?? 0.22;
    this.flicker = (t) => Math.max(0.3, 1 + fl * (0.55 * Math.sin(t * 11.3 + ph) + 0.3 * Math.sin(t * 23.1 + ph * 1.7) + 0.15 * Math.sin(t * 37.7 + ph * 2.3)));
    this.emitter = opts.pool ? opts.pool.add({ color: this.color, intensity: L.intensity ?? 2.4, distance: L.distance ?? 7, priority: 1.5,
      castShadow: opts.shadows !== false && L.castShadow !== false, flicker: this.flicker }) : null;
    this.pool = opts.pool; this._level = 1; this.level = opts.level ?? 1; this._fps = 12; this._acc = rnd();
  }
  get level() { return this._level; }
  set level(v) {
    this._level = Math.max(0, Math.min(1, v)); const on = this._level > 0.01;
    for (const f of this.flames) f.visible = on; for (const { s } of this.sprites) s.visible = on; this.embers.visible = on;
    this.halo.visible = on; if (this.ground) this.ground.visible = on;
    if (this.emitter) this.emitter.level = this._level; this.eu.uLevel.value = this._level;
  }
  update(dt, t) {
    if (this._level <= 0.01) return;
    if (this.mixer) this.mixer.update(dt);
    const k = 0.35 + 0.65 * this._level;
    for (const f of this.flames) f.scale.multiplyScalar(k);
    this._acc += dt * this._fps;
    const fl = this.flicker(t);
    for (const sp of this.sprites) {
      const fr = (sp.s.userData.frame + Math.floor(this._acc)) % sp.frames; sp.t.offset.x = fr / sp.frames;
      sp.s.scale.set(sp.s.userData.base.x * k * (0.92 + 0.08 * fl), sp.s.userData.base.y * k * (0.85 + 0.15 * fl), 1);
    }
    this.halo.material.opacity = this.halo.userData.baseOpacity * this._level * (0.75 + 0.25 * fl);
    if (this.ground) this.ground.material.opacity = this.ground.userData.baseOpacity * this._level * (0.8 + 0.2 * fl);
    this.eu.uTime.value = t;
    if (this.emitter && this.lightNode) this.lightNode.getWorldPosition(this.emitter.position);
  }
  dispose() { if (this.emitter && this.pool) this.pool.remove(this.emitter); this.object.parent && this.object.parent.remove(this.object); }
}

/** Convenience group: many torches, one level / update call. */
export class TorchSet {
  constructor({ pool, textures, quality, shadows = true } = {}) { Object.assign(this, { pool, textures, quality, shadows }); this.torches = []; this.group = new THREE.Group(); this.group.name = 'torches'; this._level = 1; }
  add(gltf, position, rotY = 0, opts = {}) {
    const t = new Torch(gltf, { pool: this.pool, textures: this.textures, quality: this.quality, shadows: this.shadows, seed: this.torches.length + 1, ...opts });
    t.object.position.copy(position); t.object.rotation.y = rotY; this.group.add(t.object); this.torches.push(t); t.level = this._level; return t;
  }
  get level() { return this._level; }
  set level(v) { this._level = v; for (const t of this.torches) t.level = v; }
  update(dt, t) { for (const x of this.torches) x.update(dt, t); }
}
