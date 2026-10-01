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
