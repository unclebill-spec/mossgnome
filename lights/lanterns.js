// Glow lanterns from `n64 lanterns` GLBs: a pedestal with a water-filled glass orb, glow fish swimming loops (the GLB
// 'swim' clip), a gentle water shimmer (scrolling caustics, additive), a halo sprite as fake bloom, a glint, a ground-glow
// disc and one coloured light emitter in the shared LightPool (no shadow; the 'mixed' variant cycles through the neons).
//   const l = new GlowLantern(gltf, { pool, textures: lanternTextures('lights/') }); scene.add(l.object); l.update(dt, t);
import * as THREE from 'three';
import { cloneTex, color, findRole, glowTexture, groundGlow, haloSprite, mulberry32, stripLights } from './glowkit.js';

export function lanternTextures(base = '') {
  return { halo: glowTexture('halo', base + 'sprites/halo.png'), caustics: glowTexture('caustics', base + 'sprites/caustics.png'), mote: glowTexture('mote', base + 'sprites/glow_mote.png') };
}

export class GlowLantern {
  /** gltf: loaded lantern GLB. opts: pool, textures (lanternTextures()), seed, level, groundGlow (default true), shimmer (default true) */
  constructor(gltf, opts = {}) {
    const rnd = mulberry32((opts.seed ?? 1) * 977 + 3);
    this.object = gltf.scene.clone(true); this.object.name = gltf.scene.name || 'glow_lantern';
    stripLights(this.object);
    const tex = opts.textures || lanternTextures();
    this.lightNode = findRole(this.object, 'light')[0];
    const L = (this.lightNode && this.lightNode.userData.n64) || { color: [0.2, 1, 1], intensity: 1.7, distance: 5.5, pulse: 0.18 };
    this.color = color(L.color); this.cycle = (L.cycle || []).map(color); this.pulse = L.pulse ?? 0.18; this.ph = rnd() * 6.28;
    this.water = null; this.glass = null; this.fish = [];
    this.object.traverse((o) => {
      if (!o.isMesh) return;
      const role = o.material.userData && o.material.userData.n64 && o.material.userData.n64.role;
      if (role === 'water') {
        const t = cloneTex(tex.caustics); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1.5);
        o.material = new THREE.MeshBasicMaterial({ map: opts.shimmer === false ? null : t, vertexColors: true, color: 0xffffff, transparent: true, opacity: 0.6,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        o.renderOrder = 2; this.water = o; this.waterTex = t;
      } else if (role === 'glass') {
        o.material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false, fog: false });
        o.renderOrder = 3; this.glass = o;
      } else if (role === 'fish') {
        o.material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }); this.fish.push(o);
      } else { o.castShadow = true; o.receiveShadow = true; }
    });
    const orb = findRole(this.object, 'orb')[0];
    const R = (orb && orb.userData.n64.radius) || 0.3;
    const hn = findRole(this.object, 'halo')[0];
    const hs = (hn && hn.userData.n64.size) || 1.5;
    this.halo = haloSprite(this.color, hs, tex.halo, 0.42); this.halo.position.copy(hn ? hn.position : this.lightNode.position); this.object.add(this.halo);
    this.core = haloSprite(this.color, R * 2.2, tex.mote || tex.halo, 0.28); this.core.position.copy(this.halo.position); this.object.add(this.core);
    this.glint = haloSprite('#ffffff', R * 0.35, tex.mote || tex.halo, 0.5); this.glint.position.copy(this.halo.position).add(new THREE.Vector3(-R * 0.45, R * 0.5, R * 0.55)); this.object.add(this.glint);
    this.ground = opts.groundGlow === false ? null : groundGlow(this.color, (L.distance || 5.5) * 0.3, tex.halo, 0.22);
    if (this.ground) this.object.add(this.ground);
    this.mixer = null;
    const clip = (gltf.animations || []).find((c) => c.name === 'swim');
    if (clip) { this.mixer = new THREE.AnimationMixer(this.object); const a = this.mixer.clipAction(clip); a.play(); a.time = rnd() * clip.duration; a.timeScale = 0.85 + rnd() * 0.3; }
    this.emitter = opts.pool ? opts.pool.add({ color: this.color.clone(), intensity: L.intensity ?? 1.7, distance: L.distance ?? 5.5, priority: 1.0, castShadow: false }) : null;
    this.pool = opts.pool; this._level = 1; this.level = opts.level ?? 1; this._c = new THREE.Color();
  }
  get level() { return this._level; }
  set level(v) { this._level = Math.max(0, Math.min(1, v)); if (this.emitter) this.emitter.level = this._level; }
  /** current light colour (mixed lanterns drift through the six neons) */
  colorAt(t, out = this._c) {
    if (!this.cycle.length) return out.copy(this.color);
    const n = this.cycle.length, x = (t * 0.12 + this.ph) % n, i = Math.floor(x);
    return out.copy(this.cycle[i]).lerp(this.cycle[(i + 1) % n], x - i);
  }
  update(dt, t) {
    if (this.mixer) this.mixer.update(dt);
    const p = 1 + this.pulse * Math.sin(t * 1.7 + this.ph) * 0.8 + this.pulse * 0.2 * Math.sin(t * 4.3 + this.ph * 2);
    const c = this.colorAt(t), lv = this._level;
    if (this.waterTex) { this.waterTex.offset.set((t * 0.035) % 1, 0.04 * Math.sin(t * 0.5 + this.ph)); }
    if (this.water) { this.water.rotation.y = t * 0.15; this.water.material.opacity = (0.35 + 0.35 * lv) * (0.9 + 0.1 * p); }
    this.halo.material.color.copy(c); this.halo.material.opacity = this.halo.userData.baseOpacity * (0.2 + 0.8 * lv) * p;
    this.core.material.color.copy(c); this.core.material.opacity = this.core.userData.baseOpacity * (0.3 + 0.7 * lv) * p;
    this.glint.material.opacity = this.glint.userData.baseOpacity * (0.4 + 0.6 * lv);
    if (this.ground) { this.ground.material.color.copy(c); this.ground.material.opacity = this.ground.userData.baseOpacity * lv * p; }
    if (this.emitter) { this.emitter.color.copy(c); this.emitter.flicker = () => p; if (this.lightNode) this.lightNode.getWorldPosition(this.emitter.position); }
  }
  dispose() { if (this.emitter && this.pool) this.pool.remove(this.emitter); this.object.parent && this.object.parent.remove(this.object); }
}
