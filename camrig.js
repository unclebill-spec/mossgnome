// Shared third-person camera helpers for n64-suite games (plain math, no three.js dependency).
//  - Follow mode: yaw eases round behind the way the player faces / moves; manual nudges win for `delay` seconds.
//  - Free mode: the game simply skips followYaw().
//  - Target Lock: frame player + target from behind the player, and circle-strafe around the target.
// Yaw convention: camera sits at player + (sin yaw, cos yaw) * dist, so "behind" a player facing `f` is yaw = f + PI.
export const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function followYaw(cy, { facing, moving, moveT = 1, idle, dt, delay = 1.5, rate = 1.7, lag = 0.25 }) {
  if (idle < delay) return cy;                       // the player is steering the camera
  if (moving && moveT < lag) return cy;               // short delay before swinging round
  const d = wrapA(facing + Math.PI - cy);
  // walking toward the camera (d ~ PI) must not whip it round; walking away gets the full pull
  const w = moving ? Math.max(0, 0.3 + 0.7 * Math.cos(d)) : 0.55;
  return cy + d * (1 - Math.exp(-dt * rate * w));
}

// camera position / look point that frames player and target from behind the player
export function lockFrame(p, t, { dist = 6.2, height = 2.4, mix = 0.42, lift = 0.9 } = {}) {
  const dx = t.x - p.x, dz = t.z - p.z, yaw = Math.atan2(-dx, -dz);
  return { yaw, pos: { x: p.x + Math.sin(yaw) * dist, y: p.y + height, z: p.z + Math.cos(yaw) * dist },
    look: { x: p.x + dx * mix, y: p.y + (t.y - p.y) * mix + lift, z: p.z + dz * mix }, face: Math.atan2(dx, dz) };
}

// ix: + = strafe right / - = left (circles the target); iz: + = back away / - = close in.  Returns the new x/z.
export function strafe(p, t, ix, iz, step, minR = 1.5, maxR = 30) {
  const r0 = Math.max(0.01, Math.hypot(p.x - t.x, p.z - t.z)); let a = Math.atan2(p.x - t.x, p.z - t.z);
  a += (ix * step) / r0; const r = Math.min(maxR, Math.max(minR, r0 + iz * step));
  return { x: t.x + Math.sin(a) * r, z: t.z + Math.cos(a) * r };
}

// nearest candidate within `range` (candidates: [{ pos: {x,z}, ... }]); `after` cycles to the next one by distance
export function pickTarget(p, cands, range, after = null) {
  const list = cands.map((c) => ({ c, d: Math.hypot(c.pos.x - p.x, c.pos.z - p.z) })).filter((o) => o.d <= range).sort((a, b) => a.d - b.d).map((o) => o.c);
  if (!after) return list[0] || null;
  const i = list.indexOf(after); return i < 0 ? list[0] || null : list[i + 1] || null;  // past the last one -> release
}

// ---- pitch + look-up into the canopy (shared by follow / free / target-lock cameras)
// cp is the orbit pitch in radians (+ = camera above, looking down). Below PITCH.low the camera stops orbiting under the
// player (it would dig into the ground) and instead sinks to just above the grass, slides in a little and tilts its view up,
// so you can look up into the trees while the player stays in the bottom of the frame.
export const PITCH = { min: -0.62, low: 0.05, max: 0.9, rest: 0.32 };
export const clampPitch = (cp) => Math.min(PITCH.max, Math.max(PITCH.min, cp));
export const upAmount = (cp) => Math.min(1, Math.max(0, (PITCH.low - cp) / (PITCH.low - PITCH.min)));
const ease = (u) => u * u * (3 - 2 * u);
// pos / look / pivot: {x,y,z} (pivot = the player's feet). h(x, z) = ground height (optional).
// Returns new {pos, look}; with u = 0 it returns the inputs unchanged.
export function lookUp(pos, look, pivot, u, { pull = 0.32, camLow = 0.75, tilt = 0.4, h = null, clear = 0.75 } = {}) {
  if (!(u > 0)) return { pos, look };
  const e = ease(u), vx = pos.x - pivot.x, vz = pos.z - pivot.z, hd0 = Math.hypot(vx, vz) || 1e-3;
  const k = 1 - pull * e, cam = { x: pivot.x + vx * k, y: pos.y + (pivot.y + camLow - pos.y) * e, z: pivot.z + vz * k };
  if (h) {  // never inside the ground, and keep the line of sight to the player's head above it
    cam.y = Math.max(cam.y, h(cam.x, cam.z) + clear);
    for (const f of [0.25, 0.5, 0.75]) { const gx = cam.x + (pivot.x - cam.x) * f, gz = cam.z + (pivot.z - cam.z) * f, need = h(gx, gz) + 0.25;
      const ly = cam.y + (pivot.y + 1.1 - cam.y) * f; if (ly < need) cam.y += (need - ly) / (1 - f); }
  }
  const hd = hd0 * k, base = Math.atan2(look.y - pos.y, Math.hypot(look.x - pos.x, look.z - pos.z) || hd0);
  const ang = base + (tilt - base) * e, lx = look.x, lz = look.z, lh = Math.hypot(lx - cam.x, lz - cam.z) || hd;
  return { pos: cam, look: { x: lx, y: cam.y + lh * Math.tan(ang), z: lz } };
}
