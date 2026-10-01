// Spell VFX templates (stateless: fx.at(t) poses everything for absolute time t, so previews are deterministic).
import { THREE, rng, canvasTex, clamp } from './common.js';

const C = (h) => new THREE.Color(h);
const ease = (x) => 1 - (1 - x) * (1 - x);
const bell = (x) => Math.sin(Math.PI * clamp(x, 0, 1));
function mat(spec, extra = {}) {
  return new THREE.MeshBasicMaterial({ color: C(spec.color), transparent: true, opacity: spec.alpha ?? 0.6, depthWrite: false, side: THREE.DoubleSide,
    blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false, ...extra });
}
const TEX = {};
function stripes(c1, c2) {
  const k = c1 + c2;
  if (!TEX[k]) TEX[k] = canvasTex(64, 64, (g) => { g.fillStyle = c1; g.fillRect(0, 0, 64, 64); g.fillStyle = c2; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(i * 12, 0); g.lineTo(i * 12 + 6, 0); g.lineTo(i * 12 + 26, 64); g.lineTo(i * 12 + 20, 64); g.fill(); } });
  const t = TEX[k].clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
}
function crescentTex(c1, c2) {
  return canvasTex(128, 64, (g) => {
    g.fillStyle = c1; g.beginPath(); g.ellipse(64, 62, 63, 60, 0, Math.PI, 2 * Math.PI); g.ellipse(64, 66, 54, 38, 0, 2 * Math.PI, Math.PI, true); g.fill();
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = c2; g.globalAlpha = 0.55;
    for (let i = 0; i < 10; i++) { g.beginPath(); g.moveTo(i * 14, 0); g.lineTo(i * 14 + 5, 0); g.lineTo(i * 14 - 10, 64); g.lineTo(i * 14 - 15, 64); g.fill(); }
  });
}
const glowTex = () => canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
let GLOW = null;
function glowSprite(color, size, additive = true) {
  GLOW = GLOW || glowTex();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: C(color), transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false }));
  s.scale.setScalar(size); return s;
}
function jag(geo, r, amt) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { p.setX(i, p.getX(i) * (1 + (r() - 0.5) * amt)); p.setZ(i, p.getZ(i) * (1 + (r() - 0.5) * amt)); } geo.computeVertexNormals(); return geo; }

export const TEMPLATES = {
  orb_bolt(spec, from, to, g, r) {
    const orb = glowSprite(spec.color, 1.9); const core = glowSprite('#ffffff', 0.8); g.add(orb, core);
    const sparks = []; for (let i = 0; i < spec.count; i++) { const s = glowSprite(spec.color2, 0.6); s.userData.d = new THREE.Vector3(r() - 0.5, r() * 0.8, r() - 0.5).normalize(); g.add(s); sparks.push(s); }
    const fly = 0.55 * spec.life;
    return (t) => {
      const u = clamp(t / fly, 0, 1), p = from.clone().lerp(to, u); p.y += Math.sin(u * Math.PI) * 0.8;
      orb.position.copy(p); core.position.copy(p); orb.visible = core.visible = u < 1;
      orb.material.rotation = t * 6;
      const b = clamp((t - fly) / (spec.life - fly), 0, 1);
      for (const s of sparks) { s.visible = b > 0 && b < 1; s.position.copy(to).addScaledVector(s.userData.d, ease(b) * 1.6); s.material.opacity = 1 - b; }
    };
  },
  ray_fan(spec, from, to, g, r) {
    const rays = []; const dir = to.clone().sub(from); const len = dir.length(); const yaw = Math.atan2(dir.x, dir.z);
    for (let i = 0; i < spec.count; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25, len), mat(spec, { color: C(i % 2 ? spec.color2 : spec.color) })); m.geometry.translate(0, len / 2, 0); m.geometry.rotateX(Math.PI / 2); m.position.copy(from); m.rotation.y = yaw + (i / (spec.count - 1) - 0.5) * 0.8; g.add(m); rays.push(m); }
    return (t) => { const u = t / spec.life; for (const [i, m] of rays.entries()) { m.scale.z = ease(clamp(u * 3 - i * 0.05, 0, 1)); m.material.opacity = (spec.alpha ?? 0.6) * bell(u); } };
  },
  spike_ring(spec, from, to, g, r) {
    const sp = []; for (let i = 0; i < spec.count; i++) { const m = new THREE.Mesh(jag(new THREE.ConeGeometry(0.32, 1.9, 4), r, 0.4), mat(spec, { opacity: 1, transparent: false, depthWrite: true, color: C(i % 2 ? spec.color2 : spec.color) })); m.geometry.translate(0, 0.95, 0); const a = i / spec.count * 6.283; m.position.set(to.x + Math.cos(a) * 1.1, to.y - 0.1, to.z + Math.sin(a) * 0.9); m.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); g.add(m); sp.push(m); }
    return (t) => { const u = t / spec.life; for (const [i, m] of sp.entries()) { const k = clamp(u * 4 - i * 0.08, 0, 1) * (1 - clamp((u - 0.75) * 4, 0, 1)); m.scale.set(1, Math.max(0.001, ease(k)), 1); } };
  },
  dust_cloud(spec, from, to, g, r) {
    const ps = []; for (let i = 0; i < spec.count + 4; i++) { const s = glowSprite(i % 2 ? spec.color : spec.color2, 1, false); s.userData.d = new THREE.Vector3(r() - 0.5, r() * 0.5, r() - 0.5); g.add(s); ps.push(s); }
    return (t) => { const u = t / spec.life; for (const s of ps) { s.position.copy(to).addScaledVector(s.userData.d, 1 + u * 3); s.scale.setScalar(0.8 + u * 2.2); s.material.opacity = 0.8 * (1 - u); } };
  },
  pillar(spec, from, to, g, r) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 6, 8, 1, true), mat(spec, { map: stripes(spec.color, spec.color2) })); m.geometry.translate(0, 3, 0); m.position.copy(to); g.add(m);
    const cap = glowSprite(spec.color2, 2.2); g.add(cap);
    return (t) => { const u = t / spec.life; m.scale.set(1 - u * 0.3, Math.max(0.001, ease(clamp(u * 3, 0, 1))), 1 - u * 0.3); m.material.map.offset.y = -t * 2; m.rotation.y = t * 3; m.material.opacity = (spec.alpha ?? 0.6) * bell(u); cap.position.set(to.x, to.y + 0.3, to.z); cap.material.opacity = bell(u); };
  },
  wave(spec, from, to, g, r) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.3, 24), mat(spec)); m.rotation.x = -Math.PI / 2; g.add(m);
    const m2 = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.8, 24, 1, true), mat(spec, { color: C(spec.color2), map: stripes(spec.color, spec.color2) })); g.add(m2);
    return (t) => { const u = t / spec.life; const R = 0.5 + u * from.distanceTo(to) * 1.2; m.position.set(from.x, from.y + 0.08, from.z); m.scale.setScalar(R); m2.position.set(from.x, from.y + 0.4, from.z); m2.scale.set(R, 1 - u * 0.6, R); m.material.opacity = m2.material.opacity = (spec.alpha ?? 0.6) * (1 - u); };
  },
  crescent_blades(spec, from, to, g, r) {
    // single flat crescent plane with a scrolling texture, flying linearly ~1 s
    const tx = crescentTex(spec.color, spec.color2); tx.wrapS = THREE.RepeatWrapping;
    const blades = []; const dir = to.clone().sub(from).setY(0).normalize(); const yaw = Math.atan2(dir.x, dir.z);
    for (let i = 0; i < Math.max(1, spec.count); i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), mat(spec, { map: tx, color: C('#ffffff'), opacity: 0.95, blending: THREE.NormalBlending })); m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2 + 0.45, yaw, 0); g.add(m); blades.push(m); }
    return (t) => { const u = clamp(t / spec.life, 0, 1); tx.offset.x = -t * 3; for (const [i, m] of blades.entries()) { const p = from.clone().lerp(to, clamp(u * 1.05 - i * 0.12, 0, 1)); p.y += 0.9 + i * 0.25; m.position.copy(p); m.material.opacity = 0.95 * (u < 0.9 ? 1 : (1 - u) * 10); } };
  },
  feather_fan(spec, from, to, g, r) {
    const fs = []; for (let i = 0; i < spec.count; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.6), mat(spec, { color: C(i % 2 ? spec.color2 : spec.color) })); m.userData.a = (i / spec.count - 0.5) * 1.6; m.userData.s = r(); g.add(m); fs.push(m); }
    const dir = to.clone().sub(from); const yaw = Math.atan2(dir.x, dir.z); const len = dir.length();
    return (t) => { const u = t / spec.life; for (const m of fs) { const a = yaw + m.userData.a; const d = ease(u) * len; m.position.set(from.x + Math.sin(a) * d, from.y + 1 + Math.sin(t * 8 + m.userData.s * 6) * 0.3, from.z + Math.cos(a) * d); m.rotation.set(t * 5 + m.userData.s, a, t * 3); m.material.opacity = (spec.alpha ?? 0.6) * (1 - u); } };
  },
  shard_burst(spec, from, to, g, r) {
    // 2-4 intersecting flat planes of green/red triangular shards pulsing on the target (~0.5 s)
    const tx = canvasTex(64, 64, (c) => { for (let i = 0; i < 14; i++) { c.fillStyle = i % 3 ? spec.color : spec.color2; const x = r() * 64, y = r() * 64, s = 6 + r() * 12; c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s * 0.6, y + s * 0.5); c.lineTo(x - s * 0.6, y + s * 0.5); c.fill(); } });
    const n = clamp(spec.count, 2, 4); const ps = [];
    for (let i = 0; i < n; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), mat(spec, { map: tx, color: C('#ffffff'), alphaTest: 0.05 })); m.rotation.y = i * Math.PI / n; m.rotation.x = (r() - 0.5) * 0.6; g.add(m); ps.push(m); }
    return (t) => { const u = t / spec.life; for (const m of ps) { m.position.set(to.x, to.y + 1, to.z); m.scale.setScalar(0.6 + 0.5 * Math.abs(Math.sin(t * 18))); m.material.opacity = bell(u); } };
  },
  ice_spikes(spec, from, to, g, r) {
    // 3 large jagged light-blue crystals jutting diagonally from the ground under the target (~1.5 s)
    const cs = [];
    for (let i = 0; i < spec.count; i++) {
      const geo = jag(new THREE.ConeGeometry(0.6, 3.2, 5, 2), r, 0.7); geo.translate(0, 1.6, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: C(i % 2 ? spec.color2 : spec.color), transparent: true, opacity: 0.85, fog: false }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })); m.add(edges);
      const a = i / spec.count * 6.283 + r(); m.position.set(to.x + Math.cos(a) * 0.35, to.y - 0.3, to.z + Math.sin(a) * 0.35);
      m.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); g.add(m); cs.push(m);
    }
    return (t) => { const u = t / spec.life; for (const [i, m] of cs.entries()) { const k = ease(clamp((t - i * 0.06) / 0.18, 0, 1)) * (1 - clamp((u - 0.8) * 5, 0, 1)); m.scale.set(1, Math.max(0.001, k), 1); m.material.opacity = 0.85 * (u < 0.85 ? 1 : (1 - u) / 0.15); } };
  },
  whirlwind(spec, from, to, g, r) {
    // inverted tornado: ~10 stacked rotating textured rings, purple/white (~3 s)
    const rings = [];
    for (let i = 0; i < 10; i++) { const rad = 0.35 + i * 0.16; const m = new THREE.Mesh(new THREE.CylinderGeometry(rad + 0.08, rad, 0.42, 14, 1, true), mat(spec, { map: stripes(spec.color, '#ffffff'), color: C(i % 2 ? '#ffffff' : '#e0c8ff'), opacity: 0.8, blending: THREE.NormalBlending })); m.position.set(to.x, to.y + 0.2 + i * 0.38, to.z); g.add(m); rings.push(m); }
    return (t) => { const u = t / spec.life; for (const [i, m] of rings.entries()) { const k = clamp(u * 5 - i * 0.12, 0, 1) * (1 - clamp((u - 0.85) * 6.6, 0, 1)); m.rotation.y = t * (5 + i * 0.6) * (i % 2 ? 1 : -1); m.scale.set(k, k, k); m.position.x = to.x + Math.sin(t * 4 + i * 0.5) * 0.12 * i / 10; m.material.map.offset.x = t * 0.7; } };
  },
  bone_wall(spec, from, to, g, r) {
    // a line of bone-white ribs thrusting from the ground between caster and target (~2 s)
    const ribs = []; const n = Math.max(6, spec.count);
    const dir = to.clone().sub(from).setY(0); const yaw = Math.atan2(dir.x, dir.z);
    for (let i = 0; i < n; i++) {
      for (const side of [-1, 1]) {
        const h = 1.7 + r() * 0.6;
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(side * 0.85, 0, 0), new THREE.Vector3(side * 1.05, h * 0.75, 0), new THREE.Vector3(side * 0.2, h, 0));
        const geo = new THREE.TubeGeometry(curve, 6, 0.09, 4, false);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: C(i % 3 ? '#efe8d8' : '#d8ccb0'), fog: false }));
        const p = from.clone().lerp(to, 0.2 + 0.8 * i / n); m.position.set(p.x, p.y, p.z); m.rotation.set(0, yaw + Math.PI / 2, 0); g.add(m); ribs.push([m, i, p.y]);
      }
    }
    return (t) => { const u = t / spec.life; for (const [m, i, y0] of ribs) { const k = ease(clamp((t - i * 0.07) / 0.25, 0, 1)) * (1 - clamp((u - 0.8) * 5, 0, 1)); m.scale.y = Math.max(0.001, k); m.position.y = y0 - 0.3 * (1 - k); } };
  },
  light_flash(spec, from, to, g, r) {
    const s = glowSprite(spec.color2 || '#ffffff', 1); const s2 = glowSprite(spec.color, 1); g.add(s, s2);
    const rays = []; for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 3), mat(spec, { color: C('#ffffff') })); m.rotation.z = i * Math.PI / 8; g.add(m); rays.push(m); }
    return (t) => { const u = t / spec.life; const k = bell(u * 1.3); s.position.set(to.x, to.y + 1, to.z); s2.position.copy(s.position); s.scale.setScalar(1 + k * 3); s2.scale.setScalar(2 + u * 5); s2.material.opacity = 1 - u; for (const m of rays) { m.position.copy(s.position); m.scale.y = k * 1.4; m.material.opacity = k; } };
  },
  heal_motes(spec, from, to, g, r) {
    const ms = []; for (let i = 0; i < spec.count + 6; i++) { const s = glowSprite(i % 2 ? spec.color : spec.color2, 0.6); s.userData.a = r() * 6.283; s.userData.o = r(); g.add(s); ms.push(s); }
    return (t) => { const u = t / spec.life; for (const s of ms) { const k = (u + s.userData.o) % 1; s.position.set(from.x + Math.cos(s.userData.a + t * 2) * 0.7, from.y + k * 2.2, from.z + Math.sin(s.userData.a + t * 2) * 0.7); s.material.opacity = bell(k) * (1 - clamp((u - 0.8) * 5, 0, 1)); } };
  },
  barrier_dome(spec, from, to, g, r) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 6, 0, 6.283, 0, Math.PI / 2), mat(spec, { wireframe: false, opacity: 0.3 }));
    const w = new THREE.LineSegments(new THREE.WireframeGeometry(m.geometry), new THREE.LineBasicMaterial({ color: C(spec.color2), transparent: true }));
    g.add(m, w);
    return (t) => { const u = t / spec.life; const k = ease(clamp(u * 4, 0, 1)); for (const o of [m, w]) { o.position.copy(from); o.scale.setScalar(k); o.rotation.y = t; } m.material.opacity = 0.3 * (1 - clamp((u - 0.8) * 5, 0, 1)); w.material.opacity = 1 - clamp((u - 0.8) * 5, 0, 1); };
  },
  // ---- cozy grove (mossgnome) templates
  cap_burst(spec, from, to, g, r) {  // spotted toadstools pop up round the target, bounce, then shrink back into the soil
    const caps = []; const n = Math.max(3, Math.min(9, spec.count));
    for (let i = 0; i < n; i++) {
      const grp = new THREE.Group();
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.7, 6), mat(spec, { color: C('#f4ead2'), opacity: 1, transparent: false, depthWrite: true }));
      stalk.position.y = 0.35;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 4, 0, 6.283, 0, Math.PI / 2), mat(spec, { color: C(spec.color), opacity: 1, transparent: false, depthWrite: true }));
      cap.position.y = 0.66;
      grp.add(stalk, cap);
      for (let k = 0; k < 4; k++) { const d = glowSprite(spec.color2, 0.16, false); const a = k * 1.6 + r(); d.position.set(Math.cos(a) * 0.26, 0.9, Math.sin(a) * 0.26); grp.add(d); }
      const a = i / n * 6.283 + r() * 0.3, d = i === 0 ? 0 : 0.9 + r() * 0.4;
      grp.position.set(to.x + Math.cos(a) * d, to.y - 0.05, to.z + Math.sin(a) * d); grp.userData.o = i * 0.06; g.add(grp); caps.push(grp);
    }
    const puff = []; for (let i = 0; i < 8; i++) { const s = glowSprite('#f4ecd8', 0.6, false); s.userData.a = i * 0.785; g.add(s); puff.push(s); }
    return (t) => {
      const u = t / spec.life;
      for (const c of caps) { const k = clamp((u - c.userData.o) * 4, 0, 1); const out = 1 - clamp((u - 0.78) * 4.5, 0, 1); const bounce = 1 + 0.25 * Math.sin(k * Math.PI * 3) * (1 - k);
        c.scale.set(ease(k) * out * bounce, Math.max(0.001, ease(k) * out), ease(k) * out * bounce); }
      for (const s of puff) { const k = clamp(u * 2, 0, 1); s.position.set(to.x + Math.cos(s.userData.a) * k * 1.6, to.y + 0.2 + k * 0.4, to.z + Math.sin(s.userData.a) * k * 1.6); s.scale.setScalar(0.4 + k); s.material.opacity = 0.7 * (1 - k); }
    };
  },
  spore_cloud(spec, from, to, g, r) {  // a puff of glittering lilac spores drifts from the caster and blooms over the target
    const ps = []; for (let i = 0; i < spec.count + 10; i++) { const s = glowSprite(i % 3 ? spec.color : spec.color2, 0.5, i % 4 === 0); s.userData.d = new THREE.Vector3(r() - 0.5, r() * 0.7, r() - 0.5); s.userData.o = r() * 0.25; s.userData.w = 2 + r() * 3; g.add(s); ps.push(s); }
    return (t) => {
      const u = t / spec.life;
      for (const s of ps) { const k = clamp((u - s.userData.o) / 0.5, 0, 1); const b = clamp((u - 0.5) / 0.5, 0, 1);
        const p = from.clone().lerp(to, ease(k)); p.y += 0.6 + Math.sin(k * Math.PI) * 0.7 + Math.sin(t * s.userData.w) * 0.08;
        p.addScaledVector(s.userData.d, 0.4 + b * 2.4); s.position.copy(p); s.scale.setScalar(0.35 + b * 1.4); s.material.opacity = 0.85 * (1 - b * 0.9) * clamp(u * 8, 0, 1); }
    };
  },
  bubble_stream(spec, from, to, g, r) {  // a wobbling stream of fizzy bubbles that pop in a splash ring at the target
    const tex = canvasTex(32, 32, (c) => { c.strokeStyle = 'rgba(220,255,250,0.95)'; c.lineWidth = 2.5; c.beginPath(); c.arc(16, 16, 12, 0, 7); c.stroke(); c.fillStyle = 'rgba(255,255,255,0.95)'; c.fillRect(9, 8, 5, 4); c.fillStyle = 'rgba(120,220,220,0.25)'; c.beginPath(); c.arc(16, 16, 11, 0, 7); c.fill(); });
    const bs = []; for (let i = 0; i < spec.count + 12; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: C(spec.color2), transparent: true, depthWrite: false, fog: false })); s.userData.o = r() * 0.45; s.userData.ph = r() * 6.283; s.userData.sz = 0.2 + r() * 0.35; g.add(s); bs.push(s); }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 16), mat(spec, { color: C(spec.color) })); ring.rotation.x = -Math.PI / 2; g.add(ring);
    return (t) => {
      const u = t / spec.life;
      for (const s of bs) { const k = clamp((u - s.userData.o) / 0.45, 0, 1); const p = from.clone().lerp(to, k); p.y += 0.7 + Math.sin(k * Math.PI) * 0.5 + Math.sin(t * 9 + s.userData.ph) * 0.15;
        p.x += Math.cos(t * 7 + s.userData.ph) * 0.18; s.position.copy(p); s.visible = k > 0 && k < 1; s.scale.setScalar(s.userData.sz * (1 + 0.15 * Math.sin(t * 12 + s.userData.ph))); }
      const b = clamp((u - 0.55) / 0.45, 0, 1); ring.position.set(to.x, to.y + 0.05, to.z); ring.scale.setScalar(0.3 + b * 2.4); ring.material.opacity = (spec.alpha ?? 0.6) * (1 - b) * (b > 0 ? 1 : 0);
    };
  },
  firefly_swarm(spec, from, to, g, r) {  // a swirl of warm fireflies spirals round the target and flashes
    const fl = []; for (let i = 0; i < spec.count + 8; i++) { const s = glowSprite(i % 2 ? spec.color : spec.color2, 0.45); s.userData.a = r() * 6.283; s.userData.rad = 0.6 + r() * 0.8; s.userData.o = r() * 0.3; s.userData.h = r(); g.add(s); fl.push(s); }
    const flash = glowSprite(spec.color2, 1); g.add(flash);
    return (t) => {
      const u = t / spec.life;
      for (const s of fl) { const k = clamp((u - s.userData.o) / 0.45, 0, 1); const sw = clamp((u - 0.45) / 0.55, 0, 1);
        const p = from.clone().lerp(to, ease(k)); p.y += 1.0 + Math.sin(k * Math.PI) * 0.8;
        const a = s.userData.a + t * 5; p.x += Math.cos(a) * s.userData.rad * (0.3 + sw); p.z += Math.sin(a) * s.userData.rad * (0.3 + sw); p.y += s.userData.h * sw * 0.8;
        s.position.copy(p); s.material.opacity = (0.5 + 0.5 * Math.sin(t * 20 + s.userData.a)) * (1 - clamp((u - 0.85) * 6, 0, 1)); }
      const f = bell(clamp((u - 0.6) / 0.3, 0, 1)); flash.position.set(to.x, to.y + 1, to.z); flash.scale.setScalar(0.5 + f * 3.5); flash.material.opacity = f;
    };
  },
};

export function makeVFX(spec, from, to) {
  const g = new THREE.Group();
  const r = rng(spec.seed || 1);
  const fn = TEMPLATES[spec.template] || TEMPLATES.orb_bolt;
  const pose = fn({ count: 6, life: 1, alpha: 0.6, color2: '#ffffff', ...spec }, from.clone(), to.clone(), g, r);
  const fx = { group: g, life: spec.life || 1, t: 0, done: false,
    at(t) { fx.t = t; pose(Math.min(t, fx.life)); g.visible = t <= fx.life; return fx; },
    step(dt) { fx.at(fx.t + dt); if (fx.t >= fx.life) fx.done = true; return fx.done; },
    dispose() { g.removeFromParent(); g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); } };
  fx.at(0);
  return fx;
}
