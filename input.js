// Shared input layer for every n64-suite game: keyboard + mouse, touch, and Bluetooth / USB controllers (Gamepad API).
// Controller buttons are turned into the same key codes the games already handle (so menus, dialogue and battles just work),
// sticks are exposed as analog axes, and the last device used drives <html data-input="kbm|touch|pad"> so the HUD can
// swap button glyphs and hide the touch controls.  Settings (camera sensitivity, invert Y, mouse look) live in localStorage.
import { keys, pressKey, audio, audioKick } from './common.js';

export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
export const DEFAULT_BINDS = { A: 'Space', B: 'Escape', X: 'KeyF', Y: 'KeyE', LB: 'SpellPrev', RB: 'SpellNext', LT: 'AltL', RT: 'AltR',
  SELECT: 'KeyM', START: 'KeyP', L3: 'WalkToggle', R3: 'KeyH', UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight' };
// positional names: Switch Pro's bottom button is "B", PlayStation uses shapes
export const GLYPHS = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', SELECT: 'View', START: 'Menu', L3: 'L3', R3: 'R3', LS: 'L-stick', RS: 'R-stick', DPAD: 'D-pad' },
  ps: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', SELECT: 'Create', START: 'Options', L3: 'L3', R3: 'R3', LS: 'L-stick', RS: 'R-stick', DPAD: 'D-pad' },
  switch: { A: 'B', B: 'A', X: 'Y', Y: 'X', LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR', SELECT: '−', START: '+', L3: 'L-click', R3: 'R-click', LS: 'L-stick', RS: 'R-stick', DPAD: 'D-pad' },
  generic: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', SELECT: 'Select', START: 'Start', L3: 'L3', R3: 'R3', LS: 'L-stick', RS: 'R-stick', DPAD: 'D-pad' },
};
export function padType(id = '') {
  if (/xbox|xinput|045e/i.test(id)) return 'xbox';
  if (/playstation|dualshock|dualsense|054c|wireless controller/i.test(id)) return 'ps';
  if (/pro controller|nintendo|switch|057e|joy-con/i.test(id)) return 'switch';
  return 'generic';
}
const SETTINGS = { sens: 1, invertY: false, mouseLock: false, minimap: true, questArrow: true };
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function createInput({ storageKey = 'n64.input', stickKeys = true, binds = {}, onToast = null, onScheme = null, canvas = null } = {}) {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (e) { /* private mode */ }
  const I = {
    scheme: coarse() ? 'touch' : 'kbm', last: coarse() ? 'touch' : 'mouse', padType: 'generic', padName: '', pads: 0,
    move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, mouse: { dx: 0, dy: 0, wheel: 0 }, menu: false, dead: 0.18,
    settings: { ...SETTINGS, ...saved }, binds: { ...DEFAULT_BINDS, ...binds },
    save() { try { localStorage.setItem(storageKey, JSON.stringify(I.settings)); } catch (e) { /* private mode */ } },
    glyph(btn) { return (GLYPHS[I.padType] || GLYPHS.generic)[btn] || btn; },
    get locked() { return !!canvas && document.pointerLockElement === canvas; },
  };
  const setScheme = (s, last = s === 'kbm' ? 'key' : s) => { const ch = s !== I.scheme || last !== I.last; I.scheme = s; I.last = last; if (!ch) return; document.documentElement.dataset.input = s; onScheme && onScheme(s); };  // last: key | mouse | touch | pad
  document.documentElement.dataset.input = I.scheme;
  const pending = []; const say = (m) => { if (window.__loaded && onToast) onToast(m); else pending.push(m); };
  // ---- keyboard / mouse / touch: whichever was used last wins
  addEventListener('keydown', () => setScheme('kbm'), true);
  addEventListener('pointerdown', (e) => (e.pointerType === 'mouse' ? setScheme('kbm', 'mouse') : setScheme('touch')), true);
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 3 || I.locked)) setScheme('kbm', I.scheme === 'kbm' ? I.last : 'mouse'); if (I.locked && performance.now() - lockAt > 80) { const c = (v) => Math.max(-150, Math.min(150, v || 0)); I.mouse.dx += c(e.movementX); I.mouse.dy += c(e.movementY); } }, true);
  let lockAt = 0; document.addEventListener('pointerlockchange', () => { lockAt = performance.now(); });  // browsers report a bogus jump as the lock engages
  addEventListener('wheel', (e) => { if (!window.__loaded) return; I.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  if (canvas) canvas.addEventListener('click', () => { if (I.settings.mouseLock && !I.locked && window.__loaded && canvas.requestPointerLock) { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } });
  I.unlock = () => { if (I.locked) document.exitPointerLock(); };
  // ---- controllers
  addEventListener('gamepadconnected', (e) => { const g = e.gamepad; I.pads++; I.padType = padType(g.id); I.padName = g.id; say(`&#127918; Controller connected<br><small>${String(g.id).replace(/\(.*$/, '').trim().slice(0, 40) || 'Gamepad'}</small>`); });
  addEventListener('gamepaddisconnected', () => { I.pads = Math.max(0, I.pads - 1); say('&#127918; Controller disconnected'); if (I.scheme === 'pad' && !I.pads) setScheme(coarse() ? 'touch' : 'kbm'); });
  const prev = {}, held = {}; let last = performance.now();
  const radial = (x, y) => { const m = Math.hypot(x, y); if (m < I.dead) return [0, 0]; const k = (Math.min(1, m) - I.dead) / (1 - I.dead) / m; return [x * k, y * k]; };
  function fire(code) { if (code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight') keys[code] = true; pressKey(code); }
  function tick(now) {
    requestAnimationFrame(tick); const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (window.__loaded) while (pending.length) onToast && onToast(pending.shift());
    const list = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter((g) => g && g.connected);
    const g = list[0]; I.move = { x: 0, y: 0 }; I.look = { x: 0, y: 0 };
    if (!g) return;
    if (!I.padName) { I.padName = g.id; I.padType = padType(g.id); }
    const ax = (i) => (g.axes && g.axes[i]) || 0;
    const [mx, my] = radial(ax(0), ax(1)), [lx, ly] = radial(ax(2), ax(3));
    const active = (mx || my || lx || ly) !== 0;
    let any = false;
    const bon = (n) => { const b = g.buttons && g.buttons[PAD[n]]; return !!b && (b.pressed || b.value > 0.55); };
    const combo = bon('START') && bon('SELECT') && (!prev.START || !prev.SELECT);  // Start+Select together: fullscreen (instead of pause / map)
    if (combo && audio.ready) { fire('Fullscreen'); prev.START = prev.SELECT = true; any = true; }
    for (const [name, idx] of Object.entries(PAD)) {
      const b = g.buttons && g.buttons[idx]; const on = !!b && (b.pressed || b.value > 0.55);
      const code = I.binds[name];
      if (on && !prev[name]) { any = true; held[name] = 0; if (audio.ready && code) fire(code); }
      else if (on && code && /^Arrow/.test(code) && I.menu) { held[name] += dt; if (held[name] > 0.42) { held[name] -= 0.13; pressKey(code); } }
      if (!on && prev[name] && code && /^Arrow/.test(code)) keys[code] = false;
      prev[name] = on;
    }
    if (any || active) { setScheme('pad'); if (any) audioKick(); }
    if (!audio.ready) return;
    if (I.menu) {  // left stick flicks navigate menus like the d-pad, with auto-repeat
      const dir = my < -0.6 ? 'ArrowUp' : my > 0.6 ? 'ArrowDown' : mx < -0.6 ? 'ArrowLeft' : mx > 0.6 ? 'ArrowRight' : null;
      if (dir !== held.stick) { held.stick = dir; held.stickT = 0; if (dir) pressKey(dir); } else if (dir) { held.stickT += dt; if (held.stickT > 0.42) { held.stickT -= 0.13; pressKey(dir); } }
    } else { I.move = { x: mx, y: my }; held.stick = null; }
    I.look = { x: lx, y: ly };
    if (stickKeys) {  // digital fallback for games that only read WASD; only touches keys when the stick state changes
      const want = { KeyW: !I.menu && my < -0.5, KeyS: !I.menu && my > 0.5, KeyA: !I.menu && mx < -0.5, KeyD: !I.menu && mx > 0.5 };
      for (const k in want) if (want[k] !== !!held['s' + k]) { held['s' + k] = want[k]; keys[k] = want[k]; }
    }
  }
  requestAnimationFrame(tick);
  window.__input = I;
  return I;
}
