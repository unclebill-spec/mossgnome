// Hidden bubbly spring pools: mossy low-poly rock rim, clear teal water with two scrolling caustic layers, a bright glowing
// centre, rising bubbles of varied sizes that pop at the surface, steam wisps, floating sparkles and a soft light pool.
// Deterministic per spring (seeded by its id); per-spring colours/decor come from springs.json "look".
import { THREE, rng, canvasTex, reg, load } from './common.js';

const C = (h) => new THREE.Color(h);
const hashStr = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
let CAUSTIC = null, RADIAL = null, SOFT = null, BUB = null, RING = null, STAR = null, WISP = null;

// tileable cellular caustics (bright web of F2-F1 edges), white on black: used additively
function causticTex() {
  if (CAUSTIC) return CAUSTIC;
  const N = 128, r = rng(4242), pts = [];
  for (let i = 0; i < 18; i++) pts.push([r() * N, r() * N]);
  CAUSTIC = canvasTex(N, N, (g) => {
    const im = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let f1 = 1e9, f2 = 1e9;
      for (const [px, py] of pts) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const d = Math.hypot(x - (px + ox * N), y - (py + oy * N)); if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d; }
      const e = Math.max(0, 1 - (f2 - f1) / 7), v = Math.round(255 * Math.pow(e, 2.2));
      const k = (y * N + x) * 4; im.data[k] = im.data[k + 1] = im.data[k + 2] = v; im.data[k + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
  CAUSTIC.wrapS = CAUSTIC.wrapT = THREE.RepeatWrapping;
  return CAUSTIC;
}
const radialTex = () => RADIAL || (RADIAL = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }));
const softTex = () => SOFT || (SOFT = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }));
const bubTex = () => BUB || (BUB = canvasTex(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 6, 16, 16, 14); gr.addColorStop(0, 'rgba(255,255,255,0.08)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(16, 16, 14, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2; g.beginPath(); g.arc(16, 16, 11.5, 0, 7); g.stroke();
  g.fillStyle = 'rgba(255,255,255,1)'; g.beginPath(); g.ellipse(11.5, 10.5, 3, 2, -0.6, 0, 7); g.fill(); }));
const ringTex = () => RING || (RING = canvasTex(32, 32, (g) => { g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 1.6; g.beginPath(); g.arc(16, 16, 12, 0, 7); g.stroke(); }));
const starTex = () => STAR || (STAR = canvasTex(32, 32, (g) => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 8); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#fff'; g.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 ? 2.5 : 15; g.lineTo(16 + Math.cos(a) * rr, 16 + Math.sin(a) * rr); } g.fill(); }));
const wispTex = () => WISP || (WISP = canvasTex(64, 64, (g) => { const r = rng(77); for (let i = 0; i < 7; i++) { const x = 18 + r() * 28, y = 14 + r() * 36, rad = 8 + r() * 12;
  const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); } }));

function spriteOf(map, color, size, opacity = 1, additive = true) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: C(color), transparent: true, opacity, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  s.scale.setScalar(size); return s;
}
function flat(geo, mat, y) { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; return m; }

// one irregular low-poly rock: jittered icosahedron, squashed, baked facet shading + moss on top
function rockGeo(r, size, rockCol, mossCol, mossAmt) {
  const geo = new THREE.IcosahedronGeometry(size, 0), p = geo.attributes.position, key = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`, jit = {};
  for (let i = 0; i < p.count; i++) { const k = key(p.getX(i), p.getY(i), p.getZ(i)); if (!jit[k]) jit[k] = [0.75 + r() * 0.5, 0.75 + r() * 0.5, 0.75 + r() * 0.5]; const j = jit[k];
    p.setXYZ(i, p.getX(i) * j[0] * 1.15, Math.max(-size * 0.35, p.getY(i) * j[1] * 0.62), p.getZ(i) * j[2]); }
  geo.computeVertexNormals();
  const n = geo.attributes.normal, L = new THREE.Vector3(0.4, 0.85, 0.35).normalize(), cols = new Float32Array(p.count * 3), rc = C(rockCol), mc = C(mossCol), tmp = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {   // flat per-face colour (non-indexed geometry: 3 verts per face)
    const fn = new THREE.Vector3(n.getX(i) + n.getX(i + 1) + n.getX(i + 2), n.getY(i) + n.getY(i + 1) + n.getY(i + 2), n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2)).normalize();
    const shade = 0.5 + 0.62 * Math.max(0, fn.dot(L)), mossy = fn.y > 0.55 && r() < mossAmt;
    tmp.copy(mossy ? mc.clone().lerp(rc, 0.25) : rc).multiplyScalar(shade * (0.9 + r() * 0.2));
    for (let k = 0; k < 3; k++) cols.set([Math.min(1, tmp.r), Math.min(1, tmp.g), Math.min(1, tmp.b)], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

export function makeSpringPool(id, info, radius, opts = {}) {
  const look = { water: info.water || '#3ad8d0', deep: '#0a4a58', glow: info.foam || '#e8ffff', sparkle: '#ffffff', rock: '#6a6a60', moss: '#4f9a3a', steam: 0.8, decor: [], ...(info.look || {}) };
  const r = rng(hashStr(id) + 17), R = radius, g = new THREE.Group();
  const water = C(look.water), deep = C(look.deep), glow = C(look.glow);
  // basin (seen through the clear water), water surface with radial colour, two scrolling caustic layers
  g.add(flat(new THREE.CircleGeometry(R * 1.04, 28), new THREE.MeshBasicMaterial({ color: deep.clone().lerp(water, 0.25), fog: false }), -0.32));
  const sg = new THREE.CircleGeometry(R, 32, 0, Math.PI * 2), sp = sg.attributes.position, sc = new Float32Array(sp.count * 3);
  for (let i = 0; i < sp.count; i++) { const d = Math.hypot(sp.getX(i), sp.getY(i)) / R, c = water.clone().lerp(glow, Math.max(0, 0.75 - d) * 0.9).lerp(deep, Math.max(0, d - 0.55) * 0.9); sc.set([c.r, c.g, c.b], i * 3); }
  sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const surf = flat(sg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false, fog: false }), 0); g.add(surf);
  const cA = causticTex().clone(), cB = causticTex().clone(); for (const t of [cA, cB]) { t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  cA.repeat.set(R * 0.7, R * 0.7); cB.repeat.set(R * 0.45, R * 0.45);
  const causticMat = (t, o) => new THREE.MeshBasicMaterial({ map: t, color: water.clone().lerp(glow, 0.55), transparent: true, opacity: o, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  const lay1 = flat(new THREE.CircleGeometry(R * 0.97, 32), causticMat(cA, 0.42), 0.012), lay2 = flat(new THREE.CircleGeometry(R * 0.97, 32), causticMat(cB, 0.3), 0.02);
  const floorC = flat(new THREE.CircleGeometry(R, 28), causticMat(cB.clone(), 0.35), -0.3); floorC.material.map.repeat.set(R * 0.6, R * 0.6); floorC.material.map.needsUpdate = true;
  g.add(lay1, lay2, floorC);
  // bright glowing centre + soft light pool spilling onto the ground and rocks + a faint glow column
  const hot = flat(new THREE.CircleGeometry(R * 0.5, 24), new THREE.MeshBasicMaterial({ map: radialTex(), color: glow.clone().lerp(water, 0.35), transparent: true, opacity: 0.55, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }), 0.03); g.add(hot);
  const pool = flat(new THREE.PlaneGeometry(R * 5.2, R * 5.2), new THREE.MeshBasicMaterial({ map: softTex(), color: water.clone().lerp(glow, 0.3), transparent: true, opacity: 0.38, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 }), 0.05); g.add(pool);
  const halo = spriteOf(radialTex(), look.water, R * 3.6, 0.28); halo.position.y = 0.55; g.add(halo);
  const column = spriteOf(softTex(), look.glow, R * 2, 0.16); column.scale.set(R * 1.6, 4.2, 1); column.position.y = 2.0; g.add(column);
  // mossy rim of irregular low-poly rocks (plus a few pebbles inside the ring)
  const rockMat = reg(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const nRock = Math.round(11 + R * 7), avoid = opts.avoid, wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  const camSide = (a) => avoid !== undefined && Math.abs(wrap(Math.atan2(Math.cos(a), Math.sin(a)) - avoid)) < 0.85;
  for (let k = 0; k < nRock; k++) {
    const a = (k + r() * 0.5) / nRock * Math.PI * 2, size = (0.15 + r() * 0.17) * Math.sqrt(R / 1.1) * (camSide(a) ? 0.6 : 1), d = R + size * (0.35 + r() * 0.3);
    const m = new THREE.Mesh(rockGeo(r, size, look.rock, look.moss, 0.45), rockMat); m.position.set(Math.cos(a) * d, -0.05 + r() * 0.06, Math.sin(a) * d); m.rotation.y = r() * 6.28; g.add(m);
    if (r() < 0.45 && !camSide(a)) { const s2 = size * (0.45 + r() * 0.3), m2 = new THREE.Mesh(rockGeo(r, s2, look.rock, look.moss, 0.6), rockMat); m2.position.set(Math.cos(a + 0.12) * (d + size * 0.9), -0.02, Math.sin(a + 0.12) * (d + size * 0.9)); g.add(m2); }
  }
  for (let k = 0; k < 3; k++) { const a = r() * 6.28, d = R * (0.3 + r() * 0.5), m = new THREE.Mesh(rockGeo(r, 0.08 + r() * 0.06, look.rock, look.moss, 0.3), rockMat); m.position.set(Math.cos(a) * d, -0.27, Math.sin(a) * d); g.add(m); }
  // setting decor around the rim (ferns/clover, glowcaps, crystal caps, toadstools), with little glows on glowing kinds
  const decor = [];
  const DSC = { clover: 0.6, crystal_cap: 0.2, glowcap: 0.32, lantern_cap: 0.3, toadstool_red: 0.26, toadstool_blue: 0.26, toadstool_purple: 0.26 };
  (opts.tight ? [] : look.decor || []).forEach((kind, i) => { for (let k = 0; k < 2; k++) { let a = r() * 6.28; if (camSide(a)) a += Math.PI; const d = R * 1.45 + 0.35 + r() * 0.5, sc2 = (DSC[kind] || 0.3) * (0.85 + r() * 0.3);
    decor.push(load(`models/${kind}.glb`).then((m) => { m.position.set(Math.cos(a) * d, -0.04, Math.sin(a) * d); m.rotation.y = r() * 6.28; m.scale.setScalar(sc2); g.add(m);
      if (/glow|crystal|lantern/.test(kind)) { const gs = spriteOf(radialTex(), kind === 'crystal_cap' ? '#bff0ff' : '#ffe890', 0.9, 0.5); gs.position.set(m.position.x, 0.45, m.position.z); g.add(gs); } })); } });
  // bubbles rising from the basin, popping at the surface (a few fizz up into the air first)
  const bubMat = (o) => new THREE.SpriteMaterial({ map: bubTex(), color: glow.clone().lerp(C('#ffffff'), 0.5), transparent: true, opacity: o, depthWrite: false, fog: false });
  const nb = Math.round(Math.min(70, 26 + (info.bubbles_per_s || 12) * 2 * Math.min(1.6, R)));
  const bubbles = [], pops = [];
  const respawn = (u, first) => { const a = r() * 6.28, d = Math.sqrt(r()) * R * 0.85; u.x = Math.cos(a) * d; u.z = Math.sin(a) * d; u.y = first ? -0.3 + r() * 0.5 : -0.3; u.v = 0.25 + r() * 0.5;
    const big = r(); u.s = big > 0.9 ? 0.26 + r() * 0.1 : big > 0.55 ? 0.14 + r() * 0.07 : 0.06 + r() * 0.05; u.top = r() < 0.3 ? 0.15 + r() * 0.6 : 0; u.ph = r() * 6.28; };
  for (let i = 0; i < nb; i++) { const b = new THREE.Sprite(bubMat(0.9)); b.userData = {}; respawn(b.userData, true); g.add(b); bubbles.push(b); }
  for (let i = 0; i < 14; i++) { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex(), color: glow, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })); p.visible = false; p.userData = { t: 1 }; g.add(p); pops.push(p); }
  let popI = 0;
  const pop = (x, y, z, s) => { const p = pops[popI++ % pops.length]; p.visible = true; p.position.set(x, y + 0.02, z); p.userData = { t: 0, s }; };
  // steam wisps + floating sparkles
  const nSteam = Math.round(10 + 14 * look.steam * Math.min(1.5, R)), steam = [];
  for (let i = 0; i < nSteam; i++) { const w = spriteOf(wispTex(), '#ffffff', 1, 0, false); w.userData = { t: r(), a: r() * 6.28, d: r() * R * 0.7, sp: 0.1 + r() * 0.12, sw: 0.3 + r() * 0.5, rot: (r() - 0.5) * 0.8 }; g.add(w); steam.push(w); }
  const sparks = [];
  for (let i = 0; i < 18; i++) { const s = spriteOf(starTex(), i % 3 ? look.sparkle : look.glow, 0.2, 0); s.userData = { t: r(), a: r() * 6.28, d: R * (0.2 + r() * 0.9), sp: 0.12 + r() * 0.15, ph: r() * 6.28, sz: 0.1 + r() * 0.16 }; g.add(s); sparks.push(s); }
  // surface glints
  const glints = [];
  for (let i = 0; i < 10; i++) { const s = spriteOf(starTex(), '#ffffff', 0.18, 0); s.userData = { a: r() * 6.28, d: R * (0.15 + r() * 0.75), ph: r() * 6.28 }; g.add(s); glints.push(s); }

  let active = 1;
  function update(dt, t) {
    const k = active;
    cA.offset.set(t * 0.035, t * 0.02); cB.offset.set(-t * 0.025, t * 0.04); floorC.material.map.offset.set(t * 0.02, -t * 0.03);
    lay1.material.opacity = (0.36 + 0.08 * Math.sin(t * 1.3)) * k; lay2.material.opacity = (0.26 + 0.06 * Math.sin(t * 0.9 + 1)) * k;
    hot.material.opacity = (0.45 + 0.15 * Math.sin(t * 2.2)) * k; hot.scale.setScalar(1 + 0.08 * Math.sin(t * 1.7));
    halo.material.opacity = 0.15 + 0.05 * Math.sin(t * 1.9); pool.material.opacity = 0.32 + 0.06 * Math.sin(t * 1.1); column.material.opacity = 0.12 + 0.05 * Math.sin(t * 0.7);
    for (const b of bubbles) { const u = b.userData; u.y += u.v * dt * (u.y > 0 ? 0.6 : 1) * k; const x = u.x + Math.sin(t * 6 + u.ph) * 0.03 * (1 + u.s * 4), z = u.z + Math.cos(t * 5 + u.ph) * 0.03;
      b.position.set(x, u.y, z); const under = u.y < 0; b.material.opacity = under ? 0.45 : 0.95; b.scale.setScalar(u.s * (under ? 0.85 : 1) * (1 + 0.08 * Math.sin(t * 9 + u.ph)));
      if (u.y >= u.top) { pop(x, Math.max(0, u.top), z, u.s); respawn(u, false); } }
    for (const p of pops) { const u = p.userData; if (u.t >= 1) { p.visible = false; continue; } u.t += dt * 3; p.scale.setScalar(u.s * (1 + u.t * 2.4)); p.material.opacity = (1 - u.t) * 0.9; }
    for (const w of steam) { const u = w.userData; u.t += u.sp * dt; if (u.t > 1) u.t -= 1; const h = u.t * 3.2, sw = Math.sin(t * u.sw + u.a) * (0.2 + u.t * 0.6);
      w.position.set(Math.cos(u.a) * u.d + sw, 0.15 + h, Math.sin(u.a) * u.d + Math.cos(t * u.sw * 0.8 + u.a) * 0.3 * u.t); w.scale.setScalar(0.5 + u.t * 2.2);
      w.material.rotation = u.rot * t; w.material.opacity = 0.55 * look.steam * Math.sin(Math.min(1, u.t * 1.15) * Math.PI) * k; }
    for (const s of sparks) { const u = s.userData; u.t += u.sp * dt; if (u.t > 1) u.t -= 1; const a = u.a + t * 0.35;
      s.position.set(Math.cos(a) * u.d * (1 - u.t * 0.4), 0.1 + u.t * 2.2, Math.sin(a) * u.d * (1 - u.t * 0.4)); const tw = 0.5 + 0.5 * Math.sin(t * 7 + u.ph);
      s.scale.setScalar(u.sz * (0.6 + tw)); s.material.opacity = tw * Math.sin(u.t * Math.PI) * k; s.material.rotation = t + u.ph; }
    for (const s of glints) { const u = s.userData; s.position.set(Math.cos(u.a + t * 0.15) * u.d, 0.04, Math.sin(u.a + t * 0.15) * u.d); const v = Math.max(0, Math.sin(t * 3.3 + u.ph)); s.material.opacity = v * v * (info.shimmer ?? 0.8) * k; s.material.rotation = u.ph + t; }
  }
  return { group: g, update, ready: Promise.all(decor), setActive(v) { active = v; } };
}
