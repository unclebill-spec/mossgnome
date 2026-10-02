// Shared corner minimap for n64-suite games: a small round parchment disc in a wooden rim, north up, showing the local
// area around the player, a facing arrow, a few friendly markers, and (optionally) a faint chevron on the rim that points the
// general way to the current quest step (red, so it reads at a glance). No distance and no beam: just a heading; once you
// are there (within `near`, default 7) the chevron hides and an orange dot marks the goal itself (`goalColor`, M.goal).
//   const mm = createMinimap({ parent: hud, view: () => ({ img, size, x, z, facing, marks, heading }) | null });
//   mm.update(dt, t) every frame (draws at ~15 Hz); mm.el is the disc (CSS: .n64-mini; pointer-events: none).
// Size / place it with CSS: --mmd (diameter); default top-right corner, inside the safe area; scales with --hk.
// html[data-res=retro] draws it at a chunky 56 px; html[data-res=p1080] makes it a bit bigger for the sofa.
const CSS = `
.n64-mini { position: absolute; z-index: 6; pointer-events: none; box-sizing: border-box; border-radius: 50%;
  --mmd: calc(max(18cqh, 76px) * var(--hk, 1) * var(--mmk, 1)); width: var(--mmd); height: var(--mmd);
  right: calc(2cqh + var(--sar, 0px)); top: calc(2cqh + var(--sat, 0px));
  border: calc(var(--mmd) * 0.055) solid #6b4423; background: #ecdcae;
  box-shadow: 0 0 0 calc(var(--mmd) * 0.016) #e7c66a inset, 0 0 0 calc(var(--mmd) * 0.012) #3a2412, 0 0.6cqh 1.4cqh rgba(30, 16, 6, 0.45);
  opacity: 0.92; transition: opacity 0.25s; }
.n64-mini.hide { opacity: 0; visibility: hidden; }
.n64-mini canvas { width: 100%; height: 100%; display: block; border-radius: 50%; }
.n64-mini::after { content: ''; position: absolute; left: 50%; top: calc(var(--mmd) * -0.075); margin-left: calc(var(--mmd) * -0.05);
  border: calc(var(--mmd) * 0.05) solid transparent; border-bottom: calc(var(--mmd) * 0.075) solid #e7c66a; border-top: 0; filter: drop-shadow(0 0 1px #3a2412); }
html[data-res=retro] .n64-mini canvas { image-rendering: pixelated; }
html[data-res=p1080] .n64-mini { --mmk: 1.15; }
html[data-res=retro] .n64-mini { --mmk: 0.95; }
`;
const TAU = Math.PI * 2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createMinimap({ parent, view, radius = 22, cls = '', arrowColor = '#e8261c', goalColor = '#ff8a1c' }) {
  if (!document.getElementById('n64-mini-css')) { const st = document.createElement('style'); st.id = 'n64-mini-css'; st.textContent = CSS; document.head.appendChild(st); }
  const el = document.createElement('div'); el.className = `n64-mini hide ${cls}`.trim(); el.innerHTML = '<canvas></canvas>'; parent.appendChild(el);
  const cv = el.querySelector('canvas'), g = cv.getContext('2d');
  const M = { el, visible: false, arrow: false, goal: false, angle: null, shown: 0, acc: 1, radius, last: null };
  function size() {
    const retro = document.documentElement.dataset.res === 'retro', css = el.clientWidth || 80;
    const n = retro ? 56 : Math.max(48, Math.min(224, Math.round(css * Math.min(devicePixelRatio || 1, 2))));
    if (cv.width !== n) { cv.width = n; cv.height = n; }
    return n;
  }
  function draw(v, t) {
    const N = size(), c = N / 2, R = M.radius, s = (N / 2) / R;  // px per world unit
    const P = (x, z) => [c + (x - v.x) * s, c + (z - v.z) * s];
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, N, N);
    g.save(); g.beginPath(); g.arc(c, c, c, 0, TAU); g.clip();
    g.fillStyle = '#ecdcae'; g.fillRect(0, 0, N, N);
    const iw = v.img ? (v.img.naturalWidth || v.img.width || 0) : 0, ih = v.img ? (v.img.naturalHeight || v.img.height || 0) : 0;
    if (iw && (v.img.complete !== false)) {  // level map, cropped round the player (world -size/2..size/2 -> image)
      const kx = iw / v.size, kz = ih / v.size;
      const sx = (v.x - R + v.size / 2) * kx, sy = (v.z - R + v.size / 2) * kz;
      g.globalAlpha = 0.82; g.imageSmoothingEnabled = N > 60;
      g.drawImage(v.img, sx, sy, 2 * R * kx, 2 * R * kz, 0, 0, N, N); g.globalAlpha = 1;
    }
    const vg = g.createRadialGradient(c, c, c * 0.55, c, c, c); vg.addColorStop(0, 'rgba(120,80,30,0)'); vg.addColorStop(1, 'rgba(110,70,25,0.38)');
    g.fillStyle = vg; g.fillRect(0, 0, N, N);
    const u = N / 100;  // drawing unit
    for (const m of v.marks || []) {
      const [px, py] = P(m.x, m.z); if (Math.hypot(px - c, py - c) > c - 3 * u) continue;
      g.fillStyle = m.c; g.beginPath(); g.arc(px, py, (m.r || 3) * u, 0, TAU); g.fill();
      if (m.ring) { g.strokeStyle = '#4a2a14'; g.lineWidth = Math.max(1, 1.2 * u); g.stroke(); }
    }
    // faint quest heading: a small chevron just inside the rim (eased so it drifts, never snaps)
    M.arrow = false; M.goal = false;
    if (v.heading) {
      const want = Math.atan2(v.heading.z - v.z, v.heading.x - v.x), d = Math.hypot(v.heading.x - v.x, v.heading.z - v.z);
      M.angle = M.angle === null ? want : M.angle + wrap(want - M.angle) * 0.18;
      if (d > (v.near || 7)) {
        M.arrow = true; const a = M.angle, rr = c - 9 * u;
        g.save(); g.translate(c + Math.cos(a) * rr, c + Math.sin(a) * rr); g.rotate(a);
        g.globalAlpha = 0.8 + 0.15 * Math.sin(t * 2.2);
        g.fillStyle = arrowColor; g.strokeStyle = 'rgba(255,248,232,0.95)'; g.lineWidth = Math.max(1, 1.2 * u);
        g.beginPath(); g.moveTo(6 * u, 0); g.lineTo(-4 * u, -6 * u); g.lineTo(-1.5 * u, 0); g.lineTo(-4 * u, 6 * u); g.closePath(); g.fill(); g.stroke();
        g.restore();
      } else {  // arrived: the chevron hides and the goal itself gets an orange dot (gently pulsing, dark ring)
        const [gx, gy] = P(v.heading.x, v.heading.z);
        if (Math.hypot(gx - c, gy - c) < c - 4 * u) {
          M.goal = true; g.fillStyle = goalColor; g.strokeStyle = '#4a2a14'; g.lineWidth = Math.max(1, 1.3 * u);
          g.beginPath(); g.arc(gx, gy, (4.2 + 0.6 * Math.sin(t * 3)) * u, 0, TAU); g.fill(); g.stroke();
        }
      }
    } else M.angle = null;
    // the player: a red arrow showing facing (same convention as the parchment map)
    g.save(); g.translate(c, c); g.rotate(-v.facing + Math.PI);
    g.fillStyle = '#d6322a'; g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, 1.3 * u);
    g.beginPath(); g.moveTo(0, -9 * u); g.lineTo(6.5 * u, 6.5 * u); g.lineTo(0, 3 * u); g.lineTo(-6.5 * u, 6.5 * u); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.restore();
  }
  M.update = (dt, t) => {
    const v = view();
    if (!v) { if (M.visible) { el.classList.add('hide'); M.visible = false; } M.arrow = false; return; }
    if (!M.visible) { el.classList.remove('hide'); M.visible = true; M.acc = 1; }
    M.acc += dt; if (M.acc < 1 / 15) return; M.acc = 0; M.last = v; draw(v, t); M.shown++;
  };
  return M;
}

// Quest heading helper. steps: [{ level, npc?, springs?: [ids], any?, fox?, boss?, exit?, until?: flag }].
// The first unfinished step wins; a springs step points to the nearest unfound one. If the step is in another level,
// the heading is the link (portal / exit) from this level that leads there, else the link back to the hub.
// ctx: { level, hub, flag(name), found(springId), where(step, springId?) -> {x,z}|null, links: [{to, x, z}], from: {x,z} }
export function questHeading(steps, ctx) {
  if (!steps || !steps.length) return null;
  for (const st of steps) {
    if (st.until && ctx.flag(st.until)) continue;
    let ids = null;
    if (st.springs) { ids = st.springs.filter((id) => !ctx.found(id)); if (st.any ? ids.length < st.springs.length : !ids.length) continue; }
    if (st.level !== ctx.level) {
      const l = ctx.links.find((q) => q.to === st.level) || ctx.links.find((q) => q.to === ctx.hub) || null;
      return l ? { x: l.x, z: l.z, via: l.to, step: st } : null;
    }
    if (ids) {
      let best = null, bd = 1e9;
      for (const id of ids) { const p = ctx.where(st, id); if (!p) continue; const d = Math.hypot(p.x - ctx.from.x, p.z - ctx.from.z); if (d < bd) { bd = d; best = p; } }
      return best ? { ...best, step: st } : null;
    }
    const p = ctx.where(st); return p ? { ...p, step: st } : null;
  }
  return null;
}

// Bake a storybook-style terrain picture of a level (world -size/2..size/2, north up) for the minimap: soft greens shaded by
// the slopes, water, the dirt paths and the big landmarks. Hidden things (springs, chests) are never drawn here.
// opts: { size, h(x,z), water, paths: [[[x,z],...]], props: [{model, pos:[x,y,z], scale}], big: Set|array of model names, px }
export function bakeMap({ size, h, water = -1e9, paths = [], props = [], big = [], px = 192, ground = [143, 179, 106], path = '#a8784a', boss = false }) {
  const cv = document.createElement('canvas'); cv.width = cv.height = px; const g = cv.getContext('2d'), im = g.createImageData(px, px);
  const k = size / px, e = k, B = new Set(big), par = [232, 217, 168];
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const x = (i + 0.5) * k - size / 2, z = (j + 0.5) * k - size / 2, y = h(x, z);
    const sx = h(x + e, z) - h(x - e, z), sz = h(x, z + e) - h(x, z - e), slope = Math.hypot(sx, sz) / (2 * e);
    const lit = Math.max(-1, Math.min(1, (-sx - sz) / (2 * e) * 0.9));  // light from the north-west
    let c = y < water ? [127, 184, 216] : ground.map((v, n) => v * 0.62 + par[n] * 0.38);
    if (y >= water && slope > 0.9) c = c.map((v) => v * 0.72 + 70 * 0.28);  // cliffs / walls: a darker, browner band
    const f = 1 + lit * 0.16, o = (j * px + i) * 4;
    im.data[o] = Math.min(255, c[0] * f); im.data[o + 1] = Math.min(255, c[1] * f); im.data[o + 2] = Math.min(255, c[2] * f); im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const P = (x, z) => [(x + size / 2) / k, (z + size / 2) / k];
  g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = path; g.globalAlpha = 0.85; g.lineWidth = Math.max(2, 2.6 / k);
  for (const pt of paths) { g.beginPath(); pt.forEach(([x, z], n) => { const [u, v] = P(x, z); n ? g.lineTo(u, v) : g.moveTo(u, v); }); g.stroke(); }
  g.globalAlpha = 1;
  for (const pr of props) {
    if (!B.has(pr.model)) continue; const [u, v] = P(pr.pos[0], pr.pos[2]), sc = Array.isArray(pr.scale) ? pr.scale[0] : (pr.scale || 1);
    g.fillStyle = /house|tree|trunk|stump/.test(pr.model) ? 'rgba(92,60,30,0.8)' : 'rgba(176,58,46,0.75)';
    g.beginPath(); g.arc(u, v, Math.max(1.6, 1.5 * sc / k), 0, Math.PI * 2); g.fill();
  }
  return cv;
}
