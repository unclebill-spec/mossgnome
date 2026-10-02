// Reusable day/night cycle for n64-suite games (shared runtime layer; nothing here is wired into a game yet).
// Drives: a vertex-coloured sky dome (zenith/horizon + sun glow), stars at night, sun and moon sprites, one directional
// light that is the sun by day and the moon by night, a hemisphere ambient, and fog colour/range.
// Read time of day to fade other things in at dusk:
//   const dn = new DayNight({ scene, camera, cycleSeconds: 240, startHour: 19 });
//   dn.update(dt);  torches.level = dn.lightsOn;  wisps.level = dn.night;  dn.on('phase', (p) => ...);
// Time: dn.hour (0-24, settable), dn.phase ('night' | 'dawn' | 'day' | 'dusk'), dn.night (0 day .. 1 night),
// dn.lightsOn (rises a little before dusk ends), dn.daylight, dn.fade(h0, h1), dn.sunDir / dn.moonDir.
// cycleSeconds = real seconds per 24 h; nightShare = fraction of that real time spent at night (default 0.6, longer
// nights); timeScale multiplies speed (dn.fast(true) = a whole day in `fastSeconds`). Keys can come from
// `n64 daynight` (presets/daynight.json): new DayNight({ ...preset, scene, camera }).
import * as THREE from 'three';

export const DEFAULT_KEYS = [
  { h: 0.0, zenith: '#03051a', horizon: '#0c1236', fog: '#070b22', ambient: '#3a4a8c', ambientI: 0.32, sun: '#000000', sunI: 0, moonI: 0.42, stars: 1 },
  { h: 4.6, zenith: '#060a24', horizon: '#1a1c48', fog: '#0c1030', ambient: '#3a4a8c', ambientI: 0.32, sun: '#000000', sunI: 0, moonI: 0.38, stars: 1 },
  { h: 5.6, zenith: '#1c2458', horizon: '#e08a6a', fog: '#7a6070', ambient: '#7a6a9a', ambientI: 0.5, sun: '#ff9a6a', sunI: 0.45, moonI: 0.15, stars: 0.4 },
  { h: 7.0, zenith: '#5fa8dc', horizon: '#c8d8d0', fog: '#cfe6d2', ambient: '#b8c4dc', ambientI: 1.0, sun: '#ffe2b8', sunI: 1.3, moonI: 0, stars: 0 },
  { h: 12.0, zenith: '#5fa8dc', horizon: '#9fd0e8', fog: '#cfe6d2', ambient: '#d8e0f0', ambientI: 1.3, sun: '#fff6e6', sunI: 1.6, moonI: 0, stars: 0 },
  { h: 16.8, zenith: '#5fa8dc', horizon: '#c8d0c0', fog: '#cfe6d2', ambient: '#c8c8d8', ambientI: 1.05, sun: '#ffe8c8', sunI: 1.4, moonI: 0, stars: 0 },
  { h: 18.4, zenith: '#3a3a8a', horizon: '#ff7a4a', fog: '#a06070', ambient: '#8a6a8a', ambientI: 0.6, sun: '#ff7a3a', sunI: 0.6, moonI: 0.05, stars: 0.15 },
  { h: 19.4, zenith: '#141a4a', horizon: '#6a3a6a', fog: '#2a2448', ambient: '#4a4a8a', ambientI: 0.36, sun: '#ff5a2a', sunI: 0.05, moonI: 0.3, stars: 0.7 },
  { h: 20.6, zenith: '#05081e', horizon: '#121a40', fog: '#080c26', ambient: '#3a4a8c', ambientI: 0.32, sun: '#000000', sunI: 0, moonI: 0.42, stars: 1 },
  { h: 24.0, zenith: '#03051a', horizon: '#0c1236', fog: '#070b22', ambient: '#3a4a8c', ambientI: 0.32, sun: '#000000', sunI: 0, moonI: 0.42, stars: 1 },
];

const SKY_VERT = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunCol, uMoonDir; uniform float uSunGlow, uMoonGlow;
varying vec3 vCol;
void main() {
  vec3 d = normalize(position);
  float up = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(up, 0.55));
  if (d.y < 0.0) c = mix(uHorizon, uGround, min(1.0, -d.y * 4.0));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunCol * (pow(s, 8.0) * 0.55 + pow(s, 2.0) * 0.18 * (1.0 - up)) * uSunGlow;
  c += vec3(0.55, 0.62, 0.9) * pow(max(dot(d, uMoonDir), 0.0), 12.0) * 0.18 * uMoonGlow;
  vCol = c;  // per-vertex sky: soft N64-style banding
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.9999;
}`;
const SKY_FRAG = /* glsl */`varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }`;
const STAR_VERT = /* glsl */`
attribute float aSeed; uniform float uTime, uStars, uPix; varying float vA;
void main() {
  float tw = 0.65 + 0.35 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 40.0);
  vA = uStars * tw * (0.5 + 0.5 * aSeed) * smoothstep(-0.02, 0.15, normalize(position).y);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99985;
  gl_PointSize = uPix * (1.0 + 1.6 * aSeed * aSeed);
}`;
const STAR_FRAG = /* glsl */`varying float vA; void main() { vec2 q = gl_PointCoord - 0.5; if (dot(q, q) > 0.25 || vA < 0.01) discard; gl_FragColor = vec4(vec3(0.9, 0.92, 1.0) * vA, 1.0); }`;

function discTex(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, inner); gr.addColorStop(0.32, inner); gr.addColorStop(0.4, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const C = (h) => new THREE.Color(h);

export class DayNight {
  constructor(o = {}) {
    this.scene = o.scene; this.camera = o.camera || null;
    this.cycleSeconds = o.cycleSeconds ?? 240; this.nightShare = Math.min(0.8, Math.max(0.2, o.nightShare ?? 0.6));
    this.sunrise = o.sunrise ?? 6.0; this.sunset = o.sunset ?? 18.6; this.timeScale = o.timeScale ?? 1; this.paused = !!o.paused;
    this.fastSeconds = o.fastSeconds ?? 24; this._fast = false;
    this.keys = (o.keys || DEFAULT_KEYS).map((k) => ({ ...k, _z: C(k.zenith), _hz: C(k.horizon), _f: C(k.fog), _a: C(k.ambient), _s: C(k.sun) }));
    const fog = o.fog === false ? null : (o.fog && typeof o.fog === 'object' ? o.fog : {});
    this.fogCfg = fog && { near: fog.near ?? 20, far: fog.far ?? 110, nightNear: fog.nightNear ?? 6, nightFar: fog.nightFar ?? 48 };
    this.radius = o.radius ?? 90; this.listeners = { phase: [], hour: [] };
    this.sunDir = new THREE.Vector3(); this.moonDir = new THREE.Vector3();
    this.zenith = new THREE.Color(); this.horizon = new THREE.Color(); this.fogColor = new THREE.Color(); this.ambientColor = new THREE.Color(); this.sunColor = new THREE.Color();
    this.group = new THREE.Group(); this.group.name = 'daynight_sky';
    if (o.sky !== false) {
      this.skyU = { uZenith: { value: this.zenith }, uHorizon: { value: this.horizon }, uGround: { value: new THREE.Color(0x05060c) }, uSunDir: { value: this.sunDir },
        uSunCol: { value: this.sunColor }, uSunGlow: { value: 1 }, uMoonDir: { value: this.moonDir }, uMoonGlow: { value: 0 } };
      const dome = new THREE.Mesh(new THREE.SphereGeometry(this.radius, 20, 12), new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
        uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false }));
      dome.renderOrder = -10; dome.frustumCulled = false; this.group.add(dome); this.dome = dome;
    }
    const nStars = o.stars === false ? 0 : (typeof o.stars === 'number' ? o.stars : 420);
    if (nStars) {
      const pos = new Float32Array(nStars * 3), sd = new Float32Array(nStars); let a = 1234567;
      const rnd = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
      for (let i = 0; i < nStars; i++) {
        const y = 0.05 + 0.95 * Math.pow(rnd(), 0.7), th = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
        pos.set([Math.cos(th) * r * this.radius * 0.95, y * this.radius * 0.95, Math.sin(th) * r * this.radius * 0.95], i * 3); sd[i] = rnd();
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
      this.starU = { uTime: { value: 0 }, uStars: { value: 0 }, uPix: { value: Math.max(1, Math.round((o.pixelRatio || 1) * 1.5)) } };
      this.stars = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: this.starU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      this.stars.frustumCulled = false; this.stars.renderOrder = -9; this.group.add(this.stars);
    }
    if (o.sky !== false) {
      this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex('rgba(255,250,220,1)', 'rgba(255,200,120,.35)'), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
      this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex('rgba(230,236,255,1)', 'rgba(150,170,255,.25)'), color: C((o.moon && o.moon.color) || '#c8d4ff'), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
      this.sunSprite.scale.setScalar(((o.sun && o.sun.size) || 7) * this.radius / 90 * 1.6); this.moonSprite.scale.setScalar(((o.moon && o.moon.size) || 5) * this.radius / 90 * 1.6);
      this.sunSprite.renderOrder = this.moonSprite.renderOrder = -8; this.group.add(this.sunSprite, this.moonSprite);
    }
    if (o.lights !== false) {
      this.light = o.sunLight || new THREE.DirectionalLight(0xffffff, 1); this.light.name = 'daynight_sun_moon';
      this.ambient = o.ambientLight || new THREE.HemisphereLight(0xffffff, 0x202018, 0.6); this.ambient.name = 'daynight_ambient';
      if (this.scene) { this.scene.add(this.light, this.ambient); if (!this.light.target.parent) this.scene.add(this.light.target); }
    }
    this.lightGain = o.lightGain ?? 1.6; this.ambientGain = o.ambientGain ?? 1.4; this.moonColor = C((o.moon && o.moon.color) || '#b8c8ff');
    if (this.scene) { this.scene.add(this.group); if (this.fogCfg && !this.scene.fog) this.scene.fog = new THREE.Fog(0x000000, this.fogCfg.near, this.fogCfg.far); }
    this.u = 0; this.hour = o.startHour ?? 19; this.t = 0; this._phase = null; this.update(0);
  }
  // ---- time mapping: u in [0,1) is cycle progress from sunrise; night gets `nightShare` of the real time
  get dayLen() { return this.sunset - this.sunrise; }
  get hour() {
    const ds = 1 - this.nightShare;
    if (this.u < ds) return this.sunrise + (this.u / ds) * this.dayLen;
    return (this.sunset + ((this.u - ds) / this.nightShare) * (24 - this.dayLen)) % 24;
  }
  set hour(h) {
    h = ((h % 24) + 24) % 24; const ds = 1 - this.nightShare;
    if (h >= this.sunrise && h <= this.sunset) this.u = ((h - this.sunrise) / this.dayLen) * ds;
    else this.u = ds + (((h - this.sunset + 24) % 24) / (24 - this.dayLen)) * this.nightShare;
    this.u = Math.min(0.999999, Math.max(0, this.u));
  }
  /** sun elevation proxy: + by day (0..1), - by night (0..-1) */
  get elevation() {
    const h = this.hour;
    if (h >= this.sunrise && h <= this.sunset) return Math.sin(Math.PI * (h - this.sunrise) / this.dayLen);
    return -Math.sin(Math.PI * (((h - this.sunset + 24) % 24) / (24 - this.dayLen)));
  }
  get night() { return 1 - sstep(-0.14, 0.22, this.elevation); }
  get daylight() { return 1 - this.night; }
  get lightsOn() { return 1 - sstep(0.04, 0.32, this.elevation); }
  get phase() {
    const h = this.hour;
    if (Math.abs(h - this.sunrise) < 1.0) return 'dawn';
    if (h > this.sunset - 1.2 && h < this.sunset + 1.1) return 'dusk';
    return h > this.sunrise && h < this.sunset ? 'day' : 'night';
  }
  /** 0 before h0, ramps to 1 at h1 (wraps midnight, e.g. fade(18, 20)). */
  fade(h0, h1) { const h = this.hour, span = (h1 - h0 + 24) % 24 || 24, x = (h - h0 + 24) % 24; return x > span + (24 - span) / 2 ? 0 : Math.min(1, x / span); }
  on(ev, fn) { (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); return () => { this.listeners[ev] = this.listeners[ev].filter((f) => f !== fn); }; }
  fast(on = !this._fast) { this._fast = !!on; this.timeScale = this._fast ? this.cycleSeconds / this.fastSeconds : 1; return this._fast; }
  get isFast() { return this._fast; }
  state() { return { hour: +this.hour.toFixed(3), phase: this.phase, night: +this.night.toFixed(3), lightsOn: +this.lightsOn.toFixed(3), timeScale: this.timeScale, cycleSeconds: this.cycleSeconds, nightShare: this.nightShare }; }
  _sample(h) {
    const K = this.keys; let i = 0; while (i < K.length - 2 && h > K[i + 1].h) i++;
    const a = K[i], b = K[i + 1], t = Math.min(1, Math.max(0, (h - a.h) / Math.max(1e-6, b.h - a.h)));
    this.zenith.copy(a._z).lerp(b._z, t); this.horizon.copy(a._hz).lerp(b._hz, t); this.fogColor.copy(a._f).lerp(b._f, t);
    this.ambientColor.copy(a._a).lerp(b._a, t); this.sunColor.copy(a._s).lerp(b._s, t);
    return { ambientI: a.ambientI + (b.ambientI - a.ambientI) * t, sunI: a.sunI + (b.sunI - a.sunI) * t, moonI: a.moonI + (b.moonI - a.moonI) * t, stars: a.stars + (b.stars - a.stars) * t };
  }
  update(dt = 0) {
    this.t += dt;
    if (!this.paused && dt) this.u = (this.u + dt * this.timeScale / this.cycleSeconds) % 1;
    const h = this.hour, k = this._sample(h);
    const ds = this.dayLen, sa = Math.PI * Math.min(1, Math.max(0, (h - this.sunrise) / ds));
    this.sunDir.set(Math.cos(sa), Math.sin(sa) * 0.92 + (h < this.sunrise || h > this.sunset ? -0.4 : 0), 0.38).normalize();
    const na = Math.PI * (((h - this.sunset + 24) % 24) / (24 - ds));
    this.moonDir.set(-Math.cos(na) * 0.9, Math.max(-0.3, Math.sin(na) * 0.85), -0.42).normalize();
    if (this.skyU) { this.skyU.uSunGlow.value = Math.min(1, k.sunI * 1.6 + 0.15); this.skyU.uMoonGlow.value = k.moonI * 2; }
    if (this.starU) { this.starU.uStars.value = k.stars; this.starU.uTime.value = this.t; }
    const cam = this.camera;
    if (cam) this.group.position.copy(cam.position);
    if (this.sunSprite) { this.sunSprite.position.copy(this.sunDir).multiplyScalar(this.radius * 0.9); this.sunSprite.visible = this.sunDir.y > -0.12; this.sunSprite.material.color.copy(this.sunColor).lerp(new THREE.Color(1, 1, 1), 0.4); }
    if (this.moonSprite) { this.moonSprite.position.copy(this.moonDir).multiplyScalar(this.radius * 0.88); this.moonSprite.visible = k.moonI > 0.02 && this.moonDir.y > -0.1; this.moonSprite.material.opacity = Math.min(1, k.moonI * 2.6); }
    if (this.light) {
      const sunUp = k.sunI >= k.moonI;
      const dir = sunUp ? this.sunDir : this.moonDir;
      this.light.color.copy(sunUp ? this.sunColor : this.moonColor);
      this.light.intensity = Math.max(k.sunI, k.moonI) * this.lightGain;
      const tgt = this.light.target.position; this.light.position.copy(tgt).addScaledVector(dir, 40);
      this.ambient.color.copy(this.ambientColor); this.ambient.groundColor.copy(this.ambientColor).multiplyScalar(0.35); this.ambient.intensity = k.ambientI * this.ambientGain;
    }
    if (this.scene) {
      if (this.scene.fog && this.fogCfg) {
        const n = this.night; this.scene.fog.color.copy(this.fogColor);
        this.scene.fog.near = this.fogCfg.near + (this.fogCfg.nightNear - this.fogCfg.near) * n; this.scene.fog.far = this.fogCfg.far + (this.fogCfg.nightFar - this.fogCfg.far) * n;
      }
      if (!this.scene.background || this.scene.background.isColor) this.scene.background = (this.scene.background || new THREE.Color()).copy(this.horizon);
    }
    const ph = this.phase;
    if (ph !== this._phase) { const old = this._phase; this._phase = ph; if (old !== null) for (const f of this.listeners.phase) f(ph, old); }
    for (const f of this.listeners.hour) f(h);
    return this;
  }
}
