// Mossgnome night layer: the shared day/night cycle (daynight.js) plus the suite glow kit (lights/: torches, glow-fish
// lanterns, wisps + fireflies, luminescent butterflies), placed with taste from the level data.
//   const NL = await createNightLayer({ scene, camera, renderer, quality: 'auto', phone });
//   NL.build(ctx) after each level build; NL.update(dt, t, { advance, level }) every frame after the camera moved.
// The game's materials are flat MeshLambert with an AmbientLight of PI (looks exactly like the old unlit MeshBasic by day);
// night = a cooler, dimmer ambient + moonlight, and a FIXED LightPool (glowkit QUALITY caps) for the torches and lanterns.
import * as THREE from 'three';
import { GLTFLoader } from './vendor/addons/GLTFLoader.js';
import { DayNight } from './lights/daynight.js';
import { LightPool, QUALITY, NEON, NEON_IDS, detectQuality, glowTexture, litify, whenTextures, mulberry32, haloSprite, groundGlow } from './lights/glowkit.js';
import { WispSwarm } from './lights/wisps.js';
import { Torch, torchTextures } from './lights/torches.js';
import { GlowLantern, lanternTextures } from './lights/lanterns.js';
import { ButterflySwarm } from './lights/butterflies.js';
import { LIGHT, applyEnv } from './common.js';

// cycle: 20 real minutes per day, 55% of it night (about 11 minutes of night, ~2 minute dusks)
export const TOD = { cycleSeconds: 1200, nightShare: 0.55, newGame: 16.6, title: 20.3, day: 12.5, night: 22.5, rest: { night: 20.6, morning: 7.0 } };
export const TOD_MODES = ['cycle', 'day', 'night'];
export const QUALITY_IDS = ['auto', 'low', 'medium', 'high'];
// night floors (share of the day's ambient): phones a little brighter (small screens, glare)
// "gloom and glow" (Bill's favourite look): a darker, blue-violet night so the glowing things carry the scene
const NIGHT = { k: 0.4, kPhone: 0.5, tint: new THREE.Color(0.5, 0.58, 1.0), dusk: new THREE.Color(1.0, 0.74, 0.58), fog: new THREE.Color('#151a3e'), duskFog: new THREE.Color('#b07a72'), moon: new THREE.Color('#a9b4ff'), lift: { BOSS: 0.06 } };
// Bill's signature glow colours, in order: neon blue cold fire, violet neon, red neon (cyan rides along with the cold fire).
// Lanterns, wisps, butterflies and some torches are weighted toward them; warm torches stay for contrast.
export const GLOOM = { coldfire: '#3d9bff', violet: '#a24dff', red: '#ff2a48' };
export const PALETTE = { ...NEON, ...GLOOM };
const LANTERN_MIX = ['coldfire', 'violet', 'cyan', 'red', 'coldfire', 'violet', 'mixed', 'coldfire', 'red', 'cyan'];
const LANTERN_GLB = { coldfire: 'blue', red: 'magenta' };  // kit model each one is tinted from
const MIXED_CYCLE = ['coldfire', 'violet', 'red', 'cyan'];
const SWARM_COLS = { wisps: ['coldfire', 'violet', 'coldfire', 'red', 'cyan', 'violet'], marsh: ['coldfire', 'cyan', 'violet', 'coldfire'], spirit: ['coldfire', 'violet', 'coldfire'],
  fireflies: ['lime', 'coldfire', 'amber', 'lime', 'coldfire', 'violet'], neon_swarm: ['coldfire', 'violet', 'red', 'cyan'] };
const BF_COLS = ['coldfire', 'violet', 'cyan', 'red', 'coldfire', 'violet', 'mixed'];
// per-quality placement density + kit options (the LightPool caps real lights / shadows separately)
const DENS = {
  low: { lanternGap: 24, houseTorches: 3, swarm: 0.5, butterflies: 3, dayButterflies: 1, wispLights: 0, bfLights: 0, cull: 34, gates: false },
  medium: { lanternGap: 17, houseTorches: 5, swarm: 0.75, butterflies: 4, dayButterflies: 2, wispLights: 0, bfLights: 1, cull: 44, gates: true },
  high: { lanternGap: 12, houseTorches: 9, swarm: 1, butterflies: 6, dayButterflies: 2, wispLights: 1, bfLights: 1, cull: 64, gates: true },
};
const ORDER = ['low', 'medium', 'high'];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const LANTERN_COLS = ['cyan', 'blue', 'violet', 'magenta', 'mixed'];  // kit models loaded (others fall back to cyan)

// neon blue cold fire for a torch: the flame + ember sprites with red and blue swapped (orange -> blue), blue light / halo / ground pool
const swapRB = (tex) => {
  const im = tex && tex.image; if (!im || !im.width) return tex;
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), a = d.data; for (let i = 0; i < a.length; i += 4) { const r = a[i]; a[i] = a[i + 2]; a[i + 2] = r; } g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c); for (const k of ['colorSpace', 'magFilter', 'minFilter', 'wrapS', 'wrapT', 'generateMipmaps', 'flipY']) t[k] = tex[k]; return t;
};
let coldTex = null;
function coldFire(t, tTex) {
  if (!coldTex) coldTex = { flame: swapRB(t.sprites[0] ? t.sprites[0].t : null), ember: swapRB(t.eu.uMap.value) };
  const col = new THREE.Color(PALETTE.coldfire);
  t.color.copy(col); if (t.emitter) t.emitter.color.copy(col);
  t.halo.material.color.copy(col); if (t.ground) t.ground.material.color.copy(col);
  for (const sp of t.sprites) { if (!coldTex.flame) break; const nt = coldTex.flame.clone(); nt.repeat.copy(sp.t.repeat); nt.offset.copy(sp.t.offset); sp.s.material.map = nt; sp.s.material.needsUpdate = true; sp.t = nt; }
  if (coldTex.ember) t.eu.uMap.value = coldTex.ember;
  for (const f of t.flames) f.traverse((m) => {
    if (!m.isMesh) return; m.material = m.material.clone();
    const ca = m.geometry.attributes.color;
    if (ca) { m.geometry = m.geometry.clone(); const a = m.geometry.attributes.color; for (let i = 0; i < a.count; i++) { const r = a.getX(i); a.setX(i, a.getZ(i)); a.setZ(i, r); } a.needsUpdate = true; }
    else if (m.material.color) { const c0 = m.material.color, r = c0.r; c0.r = c0.b; c0.b = r; }
  });
  t.cold = true; return t;
}
// lantern colours beyond the kit models (cold fire from the blue one, red from the magenta one) + the 'mixed' cycle through Bill's neons
function tintLantern(l, c) {
  if (c === 'mixed') { l.cycle = MIXED_CYCLE.map((k) => new THREE.Color(PALETTE[k])); return; }
  if (!GLOOM[c]) return;
  l.color.set(PALETTE[c]); l.cycle = [];
  if (c === 'red') for (const m of [l.water, l.glass]) if (m) { m.material.color.set('#ff6a5c'); }
}

export async function createNightLayer({ scene, camera, renderer, quality = 'auto', phone = false, base = 'lights/', startHour = TOD.newGame, guard = false, onDowngrade = null }) {
  const loader = new GLTFLoader();
  const glb = {};
  const names = ['wall_torch', 'standing_torch', 'brazier', ...LANTERN_COLS.map((c) => 'glow_lantern_' + c), 'butterfly_cyan'];
  await Promise.all(names.map((n) => new Promise((res) => loader.load(`${base}models/${n}.glb`, (g) => {
    if (!n.startsWith('butterfly')) litify(g.scene, { shadows: true });
    glb[n] = g; res();
  }, undefined, () => res()))));
  if (!glb.standing_torch || !glb.glow_lantern_cyan) throw new Error('glow kit models missing');
  const tTex = torchTextures(base), lTex = lanternTextures(base), mote = glowTexture('mote', base + 'sprites/glow_mote.png');
  await whenTextures([...Object.values(tTex), ...Object.values(lTex), mote].filter((x) => x && x.isTexture));

  const dn = new DayNight({ scene: null, camera, lights: false, fog: false, radius: 170, cycleSeconds: TOD.cycleSeconds, nightShare: TOD.nightShare, startHour, pixelRatio: 1 });
  dn.group.renderOrder = -10; scene.add(dn.group);
  const amb = new THREE.AmbientLight(0xffffff, Math.PI); amb.name = 'night_ambient';
  const moon = new THREE.DirectionalLight(NIGHT.moon, 0); moon.name = 'night_moon';
  scene.add(amb, moon, moon.target);

  const N = { dn, amb, moon, pool: null, q: null, want: quality, phone, level: null, mode: 'cycle', env: { k: 1, night: 0, warm: 0 }, lastEnv: null, stats: {}, cullT: 0, cap: null, downgrades: 0, g: { t: 0, f: 0, low: 0, warm: 1 } };
  function makePool() {
    if (N.pool) N.pool.dispose();
    let q = quality === 'auto' || !QUALITY[quality] ? detectQuality() : quality;
    if (N.cap && (quality === 'auto' || !QUALITY[quality]) && ORDER.indexOf(q) > ORDER.indexOf(N.cap)) q = N.cap;  // auto guard stepped it down
    N.q = q;
    N.pool = new LightPool(scene, { quality: N.q });
    renderer.shadowMap.enabled = QUALITY[N.q].shadows > 0;
    renderer.shadowMap.type = N.q === 'high' ? THREE.PCFShadowMap : THREE.BasicShadowMap;
  }
  makePool();

  // ---------------------------------------------------------------- level placement
  function clear() {
    const lv = N.level; if (!lv) return;
    for (const x of [...lv.torches, ...lv.lanterns]) x.dispose();
    for (const s of [...lv.wisps, ...lv.flies]) { s.dispose(N.pool); s.object.parent && s.object.parent.remove(s.object); }
    for (const b of lv.butterflies) b.sw.dispose();
    for (const sg of lv.springs || []) { for (const q of sg.emitters) N.pool.remove(q); sg.object.parent && sg.object.parent.remove(sg.object); }
    for (const e of [...N.pool.emitters]) N.pool.remove(e);
    N.level = null;
  }
  /** ctx: { id, L, group, h(x,z), cols, addCol(x,z,r,tag), props: [Object3D with userData.model], springs, portals, exit, seed } */
  function build(ctx) {
    clear();
    const D = DENS[N.q], L = ctx.L, id = ctx.id, g = ctx.group, h = ctx.h, rnd = mulberry32((ctx.seed || 64) * 31 + id.charCodeAt(0) * 7 + id.length);
    const lv = N.level = { id, torches: [], lanterns: [], wisps: [], flies: [], butterflies: [], items: [], springs: [], audit: [], cave: id === 'L2' };
    const lim = L.size / 2 - 3, wl = L.water_level;
    const ok = (x, z, r) => Math.abs(x) < lim && Math.abs(z) < lim && h(x, z) > wl + 0.2 && ctx.cols.every((c) => Math.hypot(c.x - x, c.z - z) > c.r + r);
    const free = (x, z, r = 0.5) => { for (let ring = 0; ring < 7; ring++) for (let k = 0; k < (ring ? 10 : 1); k++) { const a = k / 10 * Math.PI * 2 + ring * 0.7, d = ring * 0.55, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d; if (ok(px, pz, r)) return [px, pz]; } return null; };
    const loc = (o, lx, lz) => { const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0); return [o.pos[0] + lx * c + lz * s, o.pos[2] - lx * s + lz * c]; };
    const track = (o, x, z, extra = {}) => { lv.items.push({ o, x, z, ...extra }); };
    const torch = (kind, x, z, opts = {}) => {
      const p = free(x, z, kind === 'brazier' ? 0.8 : 0.45); if (!p) return null;
      const t = new Torch(glb[kind], { pool: N.pool, textures: tTex, quality: N.q, seed: lv.torches.length + 1, shadows: opts.shadow !== false });
      t.object.position.set(p[0], h(p[0], p[1]), p[1]); t.object.rotation.y = opts.rot || 0; g.add(t.object); lv.torches.push(t);
      if (opts.cold) coldFire(t, tTex);
      ctx.addCol(p[0], p[1], kind === 'brazier' ? 0.7 : 0.35, 'light'); track(t, p[0], p[1], { kind: 'torch', cold: !!opts.cold }); return t;
    };
    let lc = Math.floor(rnd() * LANTERN_MIX.length);
    const lantern = (x, z, col, r = 0.45) => {
      const p = free(x, z, r); if (!p) return null;
      const c = col || LANTERN_MIX[lc++ % LANTERN_MIX.length];
      const l = new GlowLantern(glb['glow_lantern_' + (LANTERN_GLB[c] || c)] || glb.glow_lantern_cyan, { pool: N.pool, textures: lTex, seed: lv.lanterns.length + 3 });
      tintLantern(l, c); l.object.userData.glow = c;
      l.object.position.set(p[0], h(p[0], p[1]), p[1]); l.object.rotation.y = rnd() * 6.28; g.add(l.object); lv.lanterns.push(l);
      ctx.addCol(p[0], p[1], 0.32, 'light'); track(l, p[0], p[1], { kind: 'lantern' }); return l;
    };
    const swarm = (preset, x, z, o = {}) => {
      const s = new WispSwarm({ preset, seed: lv.wisps.length + lv.flies.length + 1 + (ctx.seed || 0), pool: N.pool, texture: mote, lights: o.lights ?? 0, palette: PALETTE,
        ...(SWARM_COLS[preset] ? { colors: SWARM_COLS[preset] } : {}), ...o,
        count: Math.max(4, Math.round((o.count || ({ wisps: 24, fireflies: 90, marsh: 14, spirit: 7, neon_swarm: 48 }[preset])) * D.swarm)) });
      s.object.position.set(x, h(x, z), z); g.add(s.object); (preset === 'fireflies' ? lv.flies : lv.wisps).push(s); track(s, x, z, { kind: 'swarm', r: 12 }); s.level = 0; return s;
    };
    const flutter = (x, z, o = {}) => {  // a night swarm + a couple that are out by day (dimmer)
      const y0 = h(x, z), near = ctx.props.filter((m) => /toadstool|glowcap|puffball|mossy_stone|crystal_cap|reed_cap|lantern_cap/.test(m.userData.model || '') && Math.hypot(m.position.x - x, m.position.z - z) < 9);
      const perches = ButterflySwarm.perchesFrom(near).map((p) => p.sub(new THREE.Vector3(x, y0, z)));
      for (const [night, count] of [[true, D.butterflies], [false, D.dayButterflies]]) {
        if (!count) continue;
        const sw = new ButterflySwarm(glb.butterfly_cyan, { preset: o.preset || 'grove', seed: lv.butterflies.length * 13 + 5, pool: night ? N.pool : null, perches, haloTexture: lTex.halo, palette: PALETTE, colors: BF_COLS,
          count, lights: night ? D.bfLights : 0, center: [0, 1.5, 0], bounds: o.bounds || [10, 1.6, 9], height: o.height || [0.8, 3.0], ...(o.colors ? { colors: o.colors } : {}) });
        sw.object.position.set(x, y0, z); g.add(sw.object); sw.warm(20 + rnd() * 30);
        lv.butterflies.push({ sw, night }); track(sw, x, z, { kind: 'bf', r: 10 });
      }
    };
    const springGlow = (sp, hd, col, ln) => {  // each spring glows at night: a halo over the water, a pool of light round it, one pool light
      const c = new THREE.Color(PALETTE[col] || col), y = h(sp.pos[0], sp.pos[2]), o = new THREE.Group(); o.name = 'spring_glow_' + sp.id;
      const tall = !hd ? 1.5 : hd.model === 'cave_mound' ? 2.6 : 3.5, big = hd ? 4.4 : 3.4;  // above a hideout roof so it shows from outside
      const halo = haloSprite(c, big, lTex.halo, 0.5); halo.position.y = tall; o.add(halo);
      const core = haloSprite(c, big * 0.4, mote, 0.55); core.position.y = tall; o.add(core);
      const ground = groundGlow(c, (sp.r || 1) + 2.4, lTex.halo, 0.34); ground.position.y = 0.05; o.add(ground);
      o.position.set(sp.pos[0], y, sp.pos[2]); g.add(o);
      const em = N.pool.add({ color: c, intensity: 2.4, distance: 10, priority: 2.2, castShadow: false });  // springs win the pool over path lanterns em.position.set(sp.pos[0], y + tall, sp.pos[2]);
      // walk-through hideouts (root tunnel, hollow log) are pitch dark inside at night: a soft glow in there too
      let inner = null, em2 = null;
      if (hd && hd.model !== 'cave_mound') {
        const hy = h(hd.pos[0], hd.pos[2]); inner = groundGlow(c, 2.6, lTex.halo, 0.3); inner.position.set(hd.pos[0] - sp.pos[0], hy - y + 0.06, hd.pos[2] - sp.pos[2]); o.add(inner);
        em2 = N.pool.add({ color: c, intensity: 1.8, distance: 7, priority: 2.0, castShadow: false }); em2.position.set(hd.pos[0], hy + 1.2, hd.pos[2]);
      }
      const ems = [em, em2].filter(Boolean);
      const ph = rnd() * 6.28, S = { object: o, emitter: em, emitters: ems, _level: 0,
        set level(v) { this._level = v; o.visible = v > 0.01; for (const q of ems) { q.level = v; q.enabled = v > 0.01; } },
        update(t) { const p = 0.85 + 0.15 * Math.sin(t * 1.3 + ph); halo.material.opacity = 0.5 * this._level * p; core.material.opacity = 0.55 * this._level * p; ground.material.opacity = 0.34 * this._level * p; if (inner) inner.material.opacity = 0.3 * this._level * p; } };
      lv.springs.push(S); track(S, sp.pos[0], sp.pos[2], { kind: 'spring', r: 4 });
    };
    const along = (path, gap, side0, fn) => {  // points along a 2-point path, alternating sides
      const [[ax, az], [bx, bz]] = path, len = Math.hypot(bx - ax, bz - az); if (len < 8) return;
      const dx = (bx - ax) / len, dz = (bz - az) / len; let side = side0;
      for (let s = 7; s < len - 7; s += gap) { fn(ax + dx * s - dz * 2.1 * side, az + dz * s + dx * 2.1 * side, s / len); side = -side; }
    };
    const toward = (o, tx, tz, back, across) => {  // point near o offset toward (tx,tz) by `back` and sideways by `across`
      const dx = tx - o.pos[0], dz = tz - o.pos[2], l = Math.hypot(dx, dz) || 1; return [o.pos[0] + dx / l * back - dz / l * across, o.pos[2] + dz / l * back + dx / l * across];
    };
    const paths = L.paths || [];
    // ---- springs: one glow-fish lantern by each hideout + butterflies round it (the hollow log too)
    for (const sp of ctx.springs) {
      if (sp.isMother) continue;
      const hd = (L.hideouts || []).find((q) => q.spring === sp.id);
      const a = sp.camA || 0, r = (sp.r || 1) + (hd && hd.model === 'cave_mound' ? 5.2 : 2.4);
      const p = hd && hd.model === 'cave_mound' ? loc(hd, 2.6, 5.6) : [sp.pos[0] + Math.sin(a + 0.9) * r, sp.pos[2] + Math.cos(a + 0.9) * r];
      const col = ['coldfire', 'violet', 'red', 'cyan', 'coldfire', 'violet'][(+sp.id.replace(/\D/g, '') || 0) % 6];
      // the lantern: the planned spot, else walk round the spring until there is room (every spring gets one)
      let ln = lantern(p[0], p[1], col);
      for (let k = 1; !ln && k < 12; k++) { const b = a + 0.9 + k * 0.52, rr = r + (k % 3) * 1.2; ln = lantern(sp.pos[0] + Math.sin(b) * rr, sp.pos[2] + Math.cos(b) * rr, col); }
      const nb = lv.butterflies.length;
      flutter(hd ? hd.pos[0] : sp.pos[0], hd ? hd.pos[2] : sp.pos[2], hd && hd.model === 'hollow_log' ? { preset: 'grove', bounds: [12, 1.8, 10] } : {});
      springGlow(sp, hd, col, ln);
      lv.audit.push({ id: sp.id, hideout: hd ? hd.model : null, color: col, lantern: ln ? +Math.hypot(ln.object.position.x - sp.pos[0], ln.object.position.z - sp.pos[2]).toFixed(1) : null,
        butterflies: lv.butterflies.slice(nb).reduce((n, b) => n + b.sw.count, 0), glow: true });
      // cavern entrances: a torch either side of each cave mouth
      if (hd && hd.model === 'cave_mound') for (const sx of [-2.3, 2.3]) { const q = loc(hd, sx, 5.0); torch('standing_torch', q[0], q[1], { rot: hd.rot, cold: sx < 0 }); }  // one cold, one warm
    }
    if (id === 'HUB') {
      const plaza = [0.5, 9.5];
      torch('brazier', plaza[0], plaza[1], { cold: true });  // the village's cold-fire heart
      const houses = L.props.filter((p) => /treehouse|mushroom_house|root_house/.test(p.model)).sort((a, b) => Math.hypot(a.pos[0], a.pos[2] - 8) - Math.hypot(b.pos[0], b.pos[2] - 8));
      for (const [hi, hs] of houses.slice(0, D.houseTorches).entries()) { const r = (hs.model === 'treehouse' ? 1.9 : hs.model === 'root_house' ? 2.4 : 2.2) + 0.9; const q = toward(hs, plaza[0], plaza[1], r, 1.6); torch('standing_torch', q[0], q[1], { cold: hi % 2 === 1 }); }
      for (const pt of L.portals || []) {
        if (pt.type === 'spore_ring') { for (const k of [-1, 0, 1]) { const q = toward(pt, 0, 10, 3.9, k * 2.6); lantern(q[0], q[1], ['violet', 'red', 'coldfire'][k + 1]); } continue; }
        if (pt.level === 'L2') { for (const s of [-1, 1]) { const q = toward(pt, 0, 10, 2.2, s * 2.6); torch('standing_torch', q[0], q[1], { cold: true }); } continue; }  // cavern gate: torches
        if (D.gates) for (const s of [-1, 1]) { const q = toward(pt, 0, 10, 2.0, s * 2.7); lantern(q[0], q[1], pt.level === 'L3' ? (s < 0 ? 'cyan' : 'violet') : (s < 0 ? 'coldfire' : 'red')); }
      }
      paths.forEach((pa, i) => along(pa, D.lanternGap, i % 2 ? 1 : -1, (x, z) => lantern(x, z)));
      swarm('fireflies', 0, 6, { center: [0, 0.9, 0], bounds: [46, 1.4, 40], count: 70 });
      const ring = (L.portals || []).find((q) => q.type === 'spore_ring'); if (ring) swarm('spirit', ring.pos[0], ring.pos[2], { center: [0, 2, 0], bounds: [8, 1.4, 8] });
    } else {
      // exit gate home: a lantern each side
      if (ctx.exit) for (const s of [-1, 1]) lantern(ctx.exit.x + s * 3.0, ctx.exit.z - 2.2, s < 0 ? 'coldfire' : 'violet');
      const gap = D.lanternGap * 1.15;
      paths.forEach((pa, i) => along(pa, gap, i % 2 ? 1 : -1, (x, z, f) => { if (id === 'BOSS' && f > 0.25 && f < 0.75 && i === 1) torch('standing_torch', x, z, { cold: f > 0.5 }); else lantern(x, z, id === 'L3' ? ['cyan', 'violet', 'coldfire'][Math.floor(rnd() * 3)] : id === 'BOSS' ? ['red', 'violet', 'coldfire'][Math.floor(rnd() * 3)] : null); }));
      const mid = (pa, f, off) => { const [[ax, az], [bx, bz]] = pa; const x = ax + (bx - ax) * f, z = az + (bz - az) * f, l = Math.hypot(bx - ax, bz - az) || 1; return [x - (bz - az) / l * off, z + (bx - ax) / l * off]; };
      if (id === 'L1') {  // Toadstool Wood: wisps drift between the caps, fireflies in the clearings
        paths.forEach((pa, i) => { const q = mid(pa, 0.55, i % 2 ? 7 : -7); swarm('wisps', q[0], q[1], { count: 18, bounds: [16, 2.4, 16], lights: D.wispLights }); });
        for (const f of [0.25, 0.75]) { const q = mid(paths[1] || paths[0], f, 0); swarm('fireflies', q[0], q[1], { bounds: [30, 1.4, 30], count: 70 }); }
      } else if (id === 'L3') {  // Mistcap Marsh: marsh wisps low over the water, more fireflies
        paths.forEach((pa, i) => { for (const f of [0.35, 0.8]) { const q = mid(pa, f, (i % 2 ? 1 : -1) * 8); swarm('marsh', q[0], q[1], { bounds: [18, 1.0, 18], lights: f > 0.5 ? D.wispLights : 0 }); } });
        swarm('wisps', 0, 14, { count: 14, bounds: [24, 2.2, 24] });
        for (const f of [0.3, 0.7]) { const q = mid(paths[0], f, 0); swarm('fireflies', q[0], q[1], { bounds: [32, 1.2, 32], count: 80 }); }
      } else if (id === 'L2') {  // Fizzwater Caverns: always lamp-lit, a few spirit wisps
        paths.forEach((pa) => { const q = mid(pa, 0.6, 5); swarm('spirit', q[0], q[1], { bounds: [10, 1.6, 10] }); });
        for (const s of [-1, 1]) torch('standing_torch', s * 3.4, 42, { cold: s > 0 });
      } else if (id === 'BOSS') {  // the cold forge: braziers by the anvil + forge, lanterns round the great spring
        for (const [x, z] of [[8.5, -27.5], [17.5, -27]]) torch('brazier', x, z, { cold: true });  // the cold forge burns blue
        for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; lantern(Math.sin(a) * 5.4, -18 + Math.cos(a) * 5.4, ['red', 'violet', 'coldfire', 'mixed'][k]); }
        swarm('fireflies', 0, 10, { bounds: [40, 1.4, 40], count: 50, colors: ['coldfire', 'red', 'violet', 'amber'] });
      }
    }
    const lcol = {}; for (const l of lv.lanterns) { const k = l.object.userData.glow || '?'; lcol[k] = (lcol[k] || 0) + 1; }
    lv.stats = { springs: lv.audit, torches: lv.torches.length, coldTorches: lv.torches.filter((t) => t.cold).length, lanternColors: lcol, lanterns: lv.lanterns.length, wisps: lv.wisps.length, fireflies: lv.flies.length, butterflies: lv.butterflies.reduce((s, b) => s + b.sw.count, 0) };
    N.cullT = 1; return lv;
  }

  // ---------------------------------------------------------------- time of day
  function setMode(m, hour) { N.mode = TOD_MODES.includes(m) ? m : 'cycle'; if (N.mode === 'day') dn.hour = TOD.day; else if (N.mode === 'night') dn.hour = TOD.night; else if (hour !== undefined) dn.hour = hour; dn.update(0); }
  function setQuality(q) { if (q !== 'auto') N.cap = null; quality = q; N.want = q; const lvCtx = N.lastCtx; clear(); makePool(); if (lvCtx) build(lvCtx); }
  const _c = new THREE.Color(), _v = new THREE.Vector3();
  function envAt(level) {
    if (level === 'L2') return { night: 0, warm: 0, k: 1, lights: 1, sky: 0, cave: true };
    const night = dn.night, h = dn.hour;
    const warm = Math.max(Math.exp(-(((h - 18.7) / 1.0) ** 2)), 0.8 * Math.exp(-(((h - 6.1) / 0.8) ** 2))) * (1 - night * 0.7);
    const nk = (N.phone ? NIGHT.kPhone : NIGHT.k) + (NIGHT.lift[level] || 0);  // dark-stone levels get a little more
    return { night, warm, k: 1 + (nk - 1) * night - 0.06 * warm, lights: dn.lightsOn, sky: 1 - sstep(0.15, 0.85, night), cave: false };
  }
  /** per frame (after the camera has moved). opts: { advance (cycle runs), level, levelFog: Color, fog, sky (panorama mesh), playerPos } */
  function update(dt, t, o) {
    // Auto guard (real play only): two slow 6 s windows in a row (under 21 fps; the game loop is capped at 30) step Auto down one level
    if (guard && (quality === 'auto' || !QUALITY[quality]) && N.q !== 'low' && N.level) {
      const g = N.g; g.t += dt; g.f++;
      if (g.t >= 6) { const fps = g.f / g.t; g.t = 0; g.f = 0;
        if (g.warm > 0) g.warm--; else if (fps < 21) { if (++g.low >= 2) { g.low = 0; g.warm = 1; N.cap = ORDER[ORDER.indexOf(N.q) - 1]; N.downgrades++; setQuality('auto'); if (onDowngrade) onDowngrade(N.q); return; } } else g.low = 0; }
    }
    dn.paused = !(o.advance && N.mode === 'cycle');
    dn.update(dt);
    const e = N.env = envAt(o.level);
    dn.group.visible = !e.cave;
    if (dn.sunSprite) dn.sunSprite.visible = dn.sunSprite.visible && e.sky < 0.6;  // the painted panorama has its own sun by day
    // ambient + moon: Lambert * PI ambient == the old unlit look; night is cooler and dimmer
    _c.setRGB(1, 1, 1).lerp(NIGHT.dusk, e.warm * 0.85).lerp(NIGHT.tint, e.night);
    amb.color.copy(_c); amb.intensity = Math.PI * e.k;
    LIGHT.k = e.k; LIGHT.tint.copy(_c);
    moon.intensity = e.cave ? 0 : Math.PI * (0.34 * e.night + 0.22 * e.warm);
    moon.color.copy(NIGHT.moon).lerp(NIGHT.dusk, e.warm * (1 - e.night));
    const dir = e.night > 0.5 || e.warm < 0.05 ? dn.moonDir : dn.sunDir;
    if (o.playerPos) { moon.target.position.copy(o.playerPos); moon.position.copy(o.playerPos).addScaledVector(_v.copy(dir).setY(Math.max(0.35, dir.y)).normalize(), 30); }
    if (o.fog && o.levelFog) { o.fog.color.copy(o.levelFog).lerp(NIGHT.duskFog, e.warm * 0.45).lerp(NIGHT.fog, e.night * 0.82); }
    if (o.sky) { o.sky.material.opacity = e.sky; o.sky.visible = o.skyOn && e.sky > 0.01; o.sky.material.color.setRGB(1, 1, 1).lerp(NIGHT.dusk, e.warm * 0.7); }
    // re-tint the unlit (MeshBasic) materials only when the light has really changed (it is a loop over every material)
    const le = N.lastEnv;
    if (!le || Math.abs(le.k - e.k) > 0.006 || Math.abs(le.warm - e.warm) > 0.01 || Math.abs(le.night - e.night) > 0.006 || le.level !== o.level) { applyEnv(); N.lastEnv = { ...e, level: o.level }; if (o.onEnv) o.onEnv(e); }
    const lv = N.level; if (!lv) { N.pool.update(camera, dt, t); return; }
    // fades: torches at dusk, lanterns glow faintly by day, wisps + fireflies with the night, butterflies brighter at night
    const lon = e.cave ? 0.9 : e.lights;
    const ffl = e.cave ? 0 : dn.fade(18.4, 20.0) * (1 - dn.fade(4.6, 5.9));
    // distance culling (cheap on phones): far lights go to sleep and give their pool light back
    N.cullT += dt;
    if (N.cullT > 0.25) {
      N.cullT = 0; const cp = camera.position, R = DENS[N.q].cull;
      for (const it of lv.items) { const d = Math.hypot(it.x - cp.x, it.z - cp.z) - (it.r || 0); it.on = d < R; }
    }
    for (const it of lv.items) {
      const x = it.o, on = it.on !== false;
      if (it.kind === 'torch') { x.object.visible = on; x.level = on ? lon : 0; if (on) x.update(dt, t); }
      else if (it.kind === 'lantern') { x.object.visible = on; if (x.emitter) x.emitter.enabled = on; x.level = 0.06 + 0.94 * lon; if (on) x.update(dt, t); }
      else if (it.kind === 'spring') { x.level = on ? (e.cave ? 0.9 : e.lights) : 0; if (x._level > 0.01) x.update(t); }
    }
    for (const s of lv.wisps) { const it = lv.items.find((q) => q.o === s); s.level = (e.cave ? 1 : e.night) * (it && it.on === false ? 0 : 1); if (s.level > 0) s.update(t); }
    for (const s of lv.flies) { const it = lv.items.find((q) => q.o === s); s.level = ffl * (it && it.on === false ? 0 : 1); if (s.level > 0) s.update(t); }
    for (const b of lv.butterflies) {
      const it = lv.items.find((q) => q.o === b.sw), on = it ? it.on !== false : true;
      const vis = b.night ? (e.cave ? 1 : sstep(0.05, 0.35, e.night)) : 1;
      b.sw.object.visible = on && vis > 0.01; b.sw.level = b.night ? 0.35 + 0.65 * (e.cave ? 1 : e.night) : 0.12 + 0.6 * e.night;
      for (const em of b.sw.emitters) em.e.enabled = b.sw.object.visible;
      if (b.sw.object.visible) b.sw.update(dt);
    }
    camera.updateMatrixWorld(); N.pool.update(camera, dt, t);
  }
  function rebuildLast(ctx) { N.lastCtx = ctx; return build(ctx); }
  function state() {
    const ps = N.pool.stats(), lv = N.level;
    return { ...dn.state(), mode: N.mode, quality: N.q, want: quality, cap: N.cap, downgrades: N.downgrades, k: +N.env.k.toFixed(3), warm: +N.env.warm.toFixed(3), ambient: +(amb.intensity / Math.PI).toFixed(3), moon: +(moon.intensity / Math.PI).toFixed(3),
      pool: ps, caps: { ...QUALITY[N.q] }, shadowsOn: renderer.shadowMap.enabled, sceneLights: { point: countLights((o) => o.isPointLight), shadow: countLights((o) => o.isPointLight && o.castShadow) },
      level: lv ? { ...lv.stats, awake: lv.items.filter((i) => i.on !== false).length, items: lv.items.length } : null,
      levels: lv ? { torch: +(lv.torches[0] ? lv.torches[0].level : 0).toFixed(3), lantern: +(lv.lanterns[0] ? lv.lanterns[0].level : 0).toFixed(3), wisps: +(lv.wisps[0] ? lv.wisps[0].level : 0).toFixed(3), flies: +(lv.flies[0] ? lv.flies[0].level : 0).toFixed(3), bf: lv.butterflies.map((b) => +b.sw.level.toFixed(2)) } : null };
  }
  const countLights = (f) => { let n = 0; scene.traverse((o) => { if (f(o)) n++; }); return n; };
  return Object.assign(N, { build: rebuildLast, clear, update, setMode, setQuality, state, glb, NEON });
}
