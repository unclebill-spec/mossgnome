// Will-o'-wisps and fireflies: one THREE.Points draw call per swarm. Wandering, bobbing and the staggered
// bright -> dim -> bright pulse all run in the vertex shader (no per-frame CPU work per mote). Only `lights` motes
// (0-3) get a real point light, borrowed from the shared LightPool, so the swarm stays cheap on phones.
//   const sw = new WispSwarm({ preset: 'wisps', seed: 7, pool, texture });  scene.add(sw.object);
//   sw.update(t);  sw.level = dayNight.night;      // fade in at dusk
import * as THREE from 'three';
import { NEON, color, glowTexture, mulberry32 } from './glowkit.js';

// same presets as n64/glowlights.py::WISP_PRESETS (n64 wisps writes them to presets/wisps.json)
export const WISP_PRESETS = {
  wisps: { count: 24, colors: ['cyan', 'magenta', 'lime', 'amber', 'violet', 'blue'], size: 0.55, center: [0, 1.9, 0], bounds: [12, 2.4, 12], wander: 1.3, bob: 0.35, pulse: 0.32, mode: 'pulse', min: 0.12, speed: 1.0, lights: 2 },
  fireflies: { count: 90, colors: ['lime', 'amber', 'lime', 'amber', 'cyan'], size: 0.2, center: [0, 0.8, 0], bounds: [16, 1.4, 16], wander: 0.9, bob: 0.25, pulse: 0.45, mode: 'blink', min: 0.0, speed: 1.4, lights: 0 },
  neon_swarm: { count: 48, colors: ['cyan', 'magenta', 'lime', 'amber', 'violet', 'blue'], size: 0.34, center: [0, 1.6, 0], bounds: [8, 2.0, 8], wander: 0.9, bob: 0.3, pulse: 0.55, mode: 'pulse', min: 0.2, speed: 1.3, lights: 3 },
  marsh: { count: 14, colors: ['cyan', 'lime', 'violet'], size: 0.7, center: [0, 1.1, 0], bounds: [14, 1.0, 14], wander: 2.0, bob: 0.2, pulse: 0.2, mode: 'pulse', min: 0.05, speed: 0.6, lights: 2 },
  spirit: { count: 7, colors: ['blue', 'violet', 'cyan'], size: 0.95, center: [0, 2.2, 0], bounds: [6, 1.6, 6], wander: 1.6, bob: 0.45, pulse: 0.25, mode: 'pulse', min: 0.25, speed: 0.5, lights: 1 },
};

const VERT = /* glsl */`
attribute vec3 aF; attribute vec4 aP; attribute vec3 aColor; attribute float aRate;
uniform float uTime, uSpeed, uWander, uBob, uPulse, uMin, uMode, uSize, uScale, uLevel;
varying vec3 vColor; varying float vB;
void main() {
  float s = uTime * uSpeed;
  vec3 p = position;
  p.x += uWander * sin(s * aF.x + aP.x) + 0.3 * uWander * sin(s * aF.y * 1.7 + aP.z);
  p.y += uBob * sin(s * aF.y * 2.0 + aP.y);
  p.z += uWander * cos(s * aF.z + aP.z) + 0.3 * uWander * cos(s * aF.x * 1.3 + aP.y);
  float ph = uTime * 6.2832 * uPulse * aRate + aP.w;
  float k = uMode > 0.5 ? pow(max(0.0, sin(ph)), 10.0) : pow(0.5 + 0.5 * sin(ph), 1.6);
  vB = (uMin + (1.0 - uMin) * k) * uLevel;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uScale * (0.55 + 0.45 * k) / max(0.1, -mv.z), 1.5, 96.0);
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap; varying vec3 vColor; varying float vB;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vB;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a * 1.5 + vec3(a * a * 0.45), 1.0);
}`;

const _sz = new THREE.Vector2();
export class WispSwarm {
  /** opts: preset name or fields of WISP_PRESETS (count, colors, size, center, bounds, wander, bob, pulse, mode, min, speed, lights),
   *  seed, pool (LightPool), texture (glow mote), palette (id -> hex), lightIntensity, lightDistance */
  constructor(opts = {}) {
    const P = { ...(WISP_PRESETS[opts.preset] || WISP_PRESETS.wisps), ...opts };
    this.p = P; this.seed = opts.seed ?? 1; this.palette = { ...NEON, ...(opts.palette || {}) };
    const n = P.count, pos = new Float32Array(n * 3), F = new Float32Array(n * 3), Ph = new Float32Array(n * 4), C = new Float32Array(n * 3), R = new Float32Array(n);
    this.rand = [];
    for (let i = 0; i < n; i++) {
      const nx = mulberry32(this.seed * 9973 + i * 7919 + 1); const r = Array.from({ length: 10 }, nx); this.rand.push(r);
      pos.set([P.center[0] + (r[0] - 0.5) * P.bounds[0], P.center[1] + (r[1] - 0.5) * P.bounds[1], P.center[2] + (r[2] - 0.5) * P.bounds[2]], i * 3);
      F.set([0.15 + 0.25 * r[3], 0.2 + 0.3 * r[4], 0.12 + 0.22 * r[5]], i * 3);
      Ph.set([r[6] * 6.2832, r[7] * 6.2832, r[8] * 6.2832, r[9] * 6.2832], i * 4);
      const c = color(this.palette[P.colors[i % P.colors.length]] || P.colors[i % P.colors.length]); C.set([c.r, c.g, c.b], i * 3);
      R[i] = 0.75 + 0.5 * r[3];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aF', new THREE.BufferAttribute(F, 3));
    g.setAttribute('aP', new THREE.BufferAttribute(Ph, 4)); g.setAttribute('aColor', new THREE.BufferAttribute(C, 3)); g.setAttribute('aRate', new THREE.BufferAttribute(R, 1));
    const pad = P.wander * 1.3 + P.size;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(...P.center), Math.hypot(P.bounds[0], P.bounds[1], P.bounds[2]) / 2 + pad);
    this.uniforms = {
      uTime: { value: 0 }, uSpeed: { value: P.speed }, uWander: { value: P.wander }, uBob: { value: P.bob }, uPulse: { value: P.pulse }, uMin: { value: P.min },
      uMode: { value: P.mode === 'blink' ? 1 : 0 }, uSize: { value: P.size }, uScale: { value: 400 }, uLevel: { value: 1 }, uMap: { value: opts.texture || glowTexture('mote') },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.object = new THREE.Points(g, mat); this.object.name = `wisps_${opts.preset || 'custom'}`; this.object.renderOrder = 6;
    this.object.onBeforeRender = (renderer, scene, camera) => {  // pixels per world unit at distance 1
      renderer.getDrawingBufferSize(_sz); this.uniforms.uScale.value = camera.isPerspectiveCamera ? _sz.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) : _sz.y;
    };
    this._level = 1; this.emitters = [];
    if (opts.pool) for (let i = 0; i < Math.min(P.lights || 0, n); i++) {
      const c = color(this.palette[P.colors[i % P.colors.length]] || P.colors[i % P.colors.length]);
      this.emitters.push({ i, e: opts.pool.add({ color: c, intensity: opts.lightIntensity ?? 0.9, distance: opts.lightDistance ?? 3.6, priority: 0.55 }) });
    }
  }
  get level() { return this._level; }
  set level(v) { this._level = Math.max(0, v); this.uniforms.uLevel.value = this._level; this.object.visible = this._level > 0.003; }
  /** CPU mirror of the vertex shader: position (world, before object transform) + brightness of mote i at time t. */
  moteAt(i, t, out = new THREE.Vector3()) {
    const P = this.p, r = this.rand[i], s = t * P.speed, w = P.wander;
    const f1 = 0.15 + 0.25 * r[3], f2 = 0.2 + 0.3 * r[4], f3 = 0.12 + 0.22 * r[5], p1 = r[6] * 6.2832, p2 = r[7] * 6.2832, p3 = r[8] * 6.2832;
    out.set(P.center[0] + (r[0] - 0.5) * P.bounds[0] + w * Math.sin(s * f1 + p1) + 0.3 * w * Math.sin(s * f2 * 1.7 + p3),
      P.center[1] + (r[1] - 0.5) * P.bounds[1] + P.bob * Math.sin(s * f2 * 2 + p2),
      P.center[2] + (r[2] - 0.5) * P.bounds[2] + w * Math.cos(s * f3 + p3) + 0.3 * w * Math.cos(s * f1 * 1.3 + p2));
    const ph = t * 6.2832 * P.pulse * (0.75 + 0.5 * r[3]) + r[9] * 6.2832;
    const k = P.mode === 'blink' ? Math.pow(Math.max(0, Math.sin(ph)), 10) : Math.pow(0.5 + 0.5 * Math.sin(ph), 1.6);
    return { position: out, brightness: P.min + (1 - P.min) * k };
  }
  update(t) {
    this.uniforms.uTime.value = t;
    if (this.emitters.length) { this.object.updateMatrixWorld(); }
    for (const { i, e } of this.emitters) {
      const m = this.moteAt(i, t, e.position); e.position.applyMatrix4(this.object.matrixWorld); e.level = m.brightness * this._level;
    }
  }
  dispose(pool) { for (const { e } of this.emitters) pool && pool.remove(e); this.object.geometry.dispose(); this.object.material.dispose(); }
}
