# Building games with Nintendo 64-style graphics: the complete guide

This guide is for anyone (person or AI builder) making a browser game that looks and plays like a late-90s console 3D game, using
three.js. It is self-contained: the numbers, the setup code and the gotchas are all here. For complete, tested reference code you
can read or import the public files of **Mossgnome and the Hidden Springs** (<https://github.com/unclebill-spec/mossgnome>),
especially the **starter game** in [`starter/`](https://github.com/unclebill-spec/mossgnome/tree/main/starter), which is about 450
lines and has every required feature.

- Play the starter: <https://unclebill-spec.github.io/mossgnome/starter/> (flags: `?hour=22&cycle=0` for night, `?lightq=low`)
- Play the full game: <https://unclebill-spec.github.io/mossgnome/>
- Paste-in prompt for chat builders: [`docs/GROK_BUILD_PROMPT.md`](GROK_BUILD_PROMPT.md)

Contents: 1. The look in numbers · 2. Renderer, materials, fog, lights · 3. Low-poly models in plain three.js · 4. Terrain and
props · 5. The shared runtime (input, camera, display, minimap, day/night, glow) · 6. Required features checklist · 7. Suite tools
(only if you have the n64-suite box) · 8. Why builds fail · 9. Verification · 10. Build order · 11. File reference

---

## 1. What "the N64 look" means, in numbers

| Thing | Target | Notes |
|---|---|---|
| Hero / player | **300-700 triangles** (starter gnome: 326) | chunky, faceted, readable silhouette; 3-4 heads tall for cute styles |
| NPC humanoids | 200-400 tris | same rig as the hero with different colours / hats |
| Creatures | 150-450 tris | round, toy-like bodies, big eyes |
| Bosses | 600-1200 tris, 1.8-3x hero scale | |
| Props | 10-120 tris each | tree = 5-6 sided trunk + 2-3 cones or 1 low icosphere; rock = jittered icosahedron (20 tris) |
| Visible frame | **4k-12k triangles** | starter: about 4,200 per frame |
| Textures | **32x32** (most surfaces), 64x64 max (faces, signs) | 8-16 colours each, soft noise or Bayer dither, tiling |
| Texture filtering | **bilinear** (LinearFilter), mipmaps on | `NearestFilter` only for a deliberate "crisp" mode or pixel-art HUD |
| Colour | **vertex colours carry most of the colour** | textures are light and low-contrast; tint them with vertex or material colour |
| Shading | flat (faceted) or baked vertex light | `flatShading: true`; no normal maps, no PBR, no specular |
| Fog | linear, always on; day near 18-45 / far 70-170; night near 6-9 / far 38-48 | fog colour = horizon colour; fog hides the draw distance |
| Draw distance | camera far 150-250, but fog ends the view at 70-170 | size the level so the far edge is in fog |
| Camera | FOV 50-60, third person at 6-8 units, pitch about 0.32 rad above | follow behind, free orbit, lock-on |
| Render resolution | **Retro preset 320x240**; Phone preset up to 480 px tall; window/720p/1080p for TVs | `antialias: false`, pixel ratio 1, upscale with CSS |
| Frame rate | game loop capped at **30 fps** | low-end phones still hold it |
| Animation | **15 fps stepped keys** (snap time to 1/15 s); walk cycle about 0.4-0.8 s per stride pair | rigid parts (one mesh per limb), no smooth skin weights |
| Skinning | rigid: every limb is a separate mesh on a pivot | if you load skinned glTF, see section 8 (shadows + normals) |
| Palette | one theme palette of 16-32 colours for the whole level, 5-step ramps | saturated greens/blues by day; deep blue-violet at night |
| UI | big chunky panels, 2-3 px borders, rounded, high contrast | at least 44 px touch targets |
| Sky | vertex-coloured gradient dome + a few painted clouds; stars and moon at night | no HDRI, no skybox photos |

**Bill's look: "gloom and glow."** Dark environments full of glowing objects. Signature glow colours: **neon blue cold fire
`#3d9bff`** (top favourite), **violet neon `#a24dff`**, **red neon `#ff2a48`**, with cyan `#19f6ff` alongside the cold fire. Use
blue cold-fire flames on most torches, with a few warm orange ones for contrast. Weight lanterns, wisps and butterflies toward
these colours. It must stay playable: on desktop the night should average luminance of about 20-75 out of 255 with under 25%
near-black pixels, and phones get a higher ambient floor.

---

## 2. Renderer, materials, fog, lights, shadows (copy-paste)

```html
<script type="importmap">{"imports":{"three":"https://unclebill-spec.github.io/mossgnome/vendor/three.module.js",
                                     "kit/":"https://unclebill-spec.github.io/mossgnome/"}}</script>
```
three.js r160 is vendored there. Use **one** copy of three (the kit's addons import `'three'`, so map it to the same file).

```js
import * as THREE from 'three';
THREE.ColorManagement.enabled = false;                 // colours are used as authored (no sRGB conversion)
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);                             // the display layer picks the render size (presets)
renderer.setSize(320, 240, false);                     // CSS stretches the canvas; 320x240 = Retro
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true;                     // only if the light quality allows shadows (see LightPool)
renderer.shadowMap.type = THREE.BasicShadowMap;        // hard pixelly edges; PCFShadowMap on "high" only

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 220);
scene.fog = new THREE.Fog(0x9fc4b0, 18, 70);           // DayNight drives colour/near/far later

// textures: tiny canvases (or 32px PNGs), bilinear, tiling, no colour-space conversion
function canvasTex(draw, px = 32, crisp = false) {
  const c = document.createElement('canvas'); c.width = c.height = px; draw(c.getContext('2d'), px);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = crisp ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = crisp ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter; return t;
}

// materials: flat-shaded Lambert so day/night + torch lights reach everything; share one per colour
const mats = new Map();
function mat(color, opts = {}) {
  const key = color + (opts.map ? opts.map.uuid : '');
  if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts }));
  return mats.get(key);
}
function mesh(geo, color, opts) { geo.computeVertexNormals(); const m = new THREE.Mesh(geo, mat(color, opts)); m.receiveShadow = true; return m; }
```

**Which material when:**
- `MeshLambertMaterial({ flatShading: true, vertexColors? , map? })` is for everything that should react to the sun, moon and
  torches. Always make sure the geometry has normals (`computeVertexNormals()`).
- `MeshBasicMaterial` (unlit) is for glowing things: flames, lantern glass, portal swirls, water caustics, the sky. Give glows
  `blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false`.
- Don't use MeshStandard/Physical, normal maps, environment maps, antialiasing, or high pixel ratios. They break the look and slow
  down phones.

**Lights:** one directional light (sun by day, moon by night) plus one hemisphere ambient, both driven by `DayNight`. Point lights
come only from a **fixed LightPool** (section 5.6): 3 on low, 4 on medium, 8 on high. Never put a `PointLight` on every torch.
Shader cost grows with the number of lights, and phones stall.

**Shadows (glow kit quality caps):**

| quality | pool lights | shadow-casting lights | shadow map | shadow update | when |
|---|---|---|---|---|---|
| low | 3 | 0 | 256 | every frame | weak devices (<=2 GB RAM or <=2 cores) |
| medium | 4 | 1 | 256 | every 2nd frame | phones / tablets (coarse pointer or small screen) |
| high | 8 | 2 | 512 | every frame | desktops |

Only the player (and static props) cast shadows. NPCs that are skinned glTF meshes must **not** cast point-light cube shadows
(section 8).

---

## 3. Low-poly models in plain three.js (procedural, no model files)

Build characters from primitives with low segment counts. Hang each limb on a pivot `Group` so you can pose it by rotating the
pivot. That is "rigid skinning", the N64 way.

```js
function gnome({ coat = '#3a6ad0', hat = '#d63a2a', beard = '#f4f0e8', skin = '#f0b088' } = {}) {
  const g = new THREE.Group(), P = {};
  const body = mesh(new THREE.CylinderGeometry(0.34, 0.5, 0.8, 8), coat); body.position.y = 0.75; g.add(body);
  const head = new THREE.Group(); head.position.y = 1.3; g.add(head); P.head = head;
  head.add(mesh(new THREE.SphereGeometry(0.32, 8, 6), skin));                       // 8x6 sphere = ~80 tris
  const nose = mesh(new THREE.IcosahedronGeometry(0.1, 0), '#e88a6a'); nose.position.set(0, -0.02, 0.32); head.add(nose);
  for (const s of [-1, 1]) { const e = mesh(new THREE.BoxGeometry(0.07, 0.09, 0.04), '#1a1010'); e.position.set(0.12 * s, 0.08, 0.28); head.add(e); }
  const bd = mesh(new THREE.ConeGeometry(0.3, 0.55, 6), beard); bd.position.set(0, -0.3, 0.12); bd.rotation.x = Math.PI; head.add(bd);
  const ht = mesh(new THREE.ConeGeometry(0.36, 0.9, 8), hat); ht.position.y = 0.55; head.add(ht);
  for (const [n, s] of [['armL', -1], ['armR', 1]]) {             // pivot at the shoulder
    const piv = new THREE.Group(); piv.position.set(0.42 * s, 1.05, 0); g.add(piv); P[n] = piv;
    const a = mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), coat); a.position.y = -0.22; piv.add(a);
  }
  for (const [n, s] of [['legL', -1], ['legR', 1]]) {             // pivot at the hip
    const piv = new THREE.Group(); piv.position.set(0.18 * s, 0.38, 0); g.add(piv); P[n] = piv;
    const l = mesh(new THREE.BoxGeometry(0.18, 0.32, 0.18), '#5a3a20'); l.position.y = -0.16; piv.add(l);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.parts = P; return g;                                 // model faces +Z
}
// 15 fps stepped animation: snap time, then swing the pivots
function pose(g, t, speed, inAir) {
  const P = g.userData.parts, ts = Math.floor(t * 15) / 15, w = Math.min(1, speed / 4), s = Math.sin(ts * 11) * 0.7 * w;
  P.legL.rotation.x = inAir ? -0.5 : s;  P.legR.rotation.x = inAir ? 0.3 : -s;
  P.armL.rotation.x = inAir ? -2.4 : -s * 0.8;  P.armR.rotation.x = inAir ? -2.4 : s * 0.8;
  P.head.position.y = 1.3 + (w > 0.05 ? Math.abs(Math.sin(ts * 11)) * 0.05 : Math.sin(ts * 2) * 0.015);
}
const player = gnome(); scene.add(player);
const friend = gnome({ coat: '#8a3ac0', hat: '#3d9bff' }); scene.add(friend);   // ALWAYS scene.add() every NPC
```

Tips:
- Count triangles as you go: `(g.index ? g.index.count : g.attributes.position.count) / 3` per mesh. Keep the hero at 300-700.
- Give each part one colour per material (vertex-colour look). Reuse the same material for the same colour.
- Use `jitter(geo, 0.15)` (random vertex offsets) on cones and icosahedrons for hand-made, lumpy shapes.
- Faces: two small dark boxes for eyes, or a 32x32 face texture on the sphere. Hats, beards and capes give silhouettes.
- More animation: `jump` (arms up, legs tucked), `talk` (head nod ±0.1 rad at 4 Hz), `wave` (one arm up ±0.6). All stepped at 15 fps.
- If you load glTF characters instead, use 15 fps clips and rigid single-bone weights. Read section 8 first.

---

## 4. Terrain and props

```js
const SIZE = 96, GRID = 33;   // 32x32 quads = 2048 tris; lumpy, low-res hills are the look
function heightAt(x, z) { const r = Math.hypot(x, z), rim = Math.min(10, Math.max(0, r - 34));
  return Math.sin(x * 0.11) * 0.9 + Math.cos(z * 0.13) * 0.8 + Math.sin((x + z) * 0.05) * 1.4 + rim * rim * 0.06; }
function buildTerrain(grassTex) {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, GRID - 1, GRID - 1); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = heightAt(x, z); pos.setY(i, y); uv.setXY(i, x / 4, z / 4);   // texture every 4 units
    c.set('#5a9a3a').lerp(new THREE.Color('#78ac44'), Math.random() * 0.6);                                   // vertex colour carries hue
    if (onPath(x, z)) c.lerp(new THREE.Color('#9a7448'), 0.85);                                                // paint dirt paths in
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: grassTex, vertexColors: true, flatShading: true }));
  m.receiveShadow = true; return m;
}
```
- Snap everything to the ground with `heightAt(x, z)` (props, NPCs, the player's feet, the camera's minimum height).
- Fence the playable area with a ring of hills or tree lines that fade into fog. Cap the rim height so the sky stays visible.
- Colliders: circles `{x, z, r}`; push the player out along the radius each frame.
- Props: a tree is a 6-sided trunk plus 2-3 jittered 7-sided cones. A rock is a jittered icosahedron. A hut is an 8-sided
  cylinder with a cone roof and a box door. A mushroom is a 5-sided stem with a 7-sided cap. Each is under 100 tris.

---

## 5. The shared runtime layer

These files are public and served by GitHub Pages with CORS, so a page on any origin can **import** them with the import map
above. raw.githubusercontent.com serves `text/plain` with `nosniff`, so it can only be **read** (to copy code), never imported.

| file (import as `kit/...`) | what it does | key API |
|---|---|---|
| `common.js` | renderer factory, 30 fps loop, key state, virtual presses, loading/audio gate | `makeRenderer()`, `loop(renderer, scene, () => camera, update)`, `keys`, `takePressed()`, `pressKey(code)`, `loaded()`, `rng(seed)` |
| `input.js` | keyboard + mouse, touch scheme detection, **Gamepad API** (Xbox/PlayStation/Switch glyphs), settings in localStorage | `createInput({ storageKey, canvas, binds, onToast })` → `I.move`, `I.look`, `I.mouse`, `I.scheme`, `I.menu`, `I.settings`, `I.glyph('A')` |
| `camrig.js` | third-person camera maths | `followYaw`, `lockFrame`, `pickTarget`, `strafe`, `PITCH`, `clampPitch`, `upAmount`, `lookUp` |
| `display.js` | resolution presets (Auto/Phone/720p/1080p/Retro 320x240), aspect (fit/16:9/4:3), render scale, fullscreen, iPhone add-to-home tip, **Install app**, turn-sideways overlay, safe-area CSS vars | `createDisplay({ renderer, cameras, storageKey, title, onToast })` → `apply()`, `cycle(k)`, `label(k)`, `toggleFS()`, `install()`, `installLabel()` |
| `minimap.js` | round corner minimap, facing arrow, marks, red quest chevron and orange goal dot | `bakeMap({ size, h, paths, props, big })`, `createMinimap({ parent, view })` → `update(dt, t)`, `.arrow`, `.goal` |
| `lights/glowkit.js` | **LightPool**, quality presets, halo/ground-glow sprites, procedural glow textures, `litify` | `new LightPool(scene, { quality })`, `pool.add({...})`, `pool.update(camera, dt, t)`, `haloSprite`, `groundGlow`, `glowTexture('halo'|'mote'|'flame'|'ember'|'caustics')` |
| `lights/daynight.js` | sky dome, stars, sun/moon sprites, sun/moon light + ambient, fog colour and range | `new DayNight({ scene, camera, cycleSeconds, startHour, fog })` → `update(dt)`, `.hour`, `.night`, `.lightsOn`, `.phase` |
| `lights/wisps.js` | GPU glow motes (wisps, fireflies, spirits) | `new WispSwarm({ preset, palette, colors, count, center, bounds })` → `.object`, `.level`, `update(t)` |
| `lights/torches.js`, `lights/lanterns.js`, `lights/butterflies.js` | GLB-based torches / glow lanterns / butterflies (need the `lights/models/*.glb`) | see Mossgnome `grovelights.js` |
| `grovelights.js` | Mossgnome's full night layer (cold-fire torches, tinted lanterns, spring glows, Auto quality guard) | reference only |

Page skeleton that the runtime expects (`display.js` looks for `#wrap` and `#stage`; `common.js` renders into `canvas#view`):
```html
<div id="loading">Loading…</div>
<div id="wrap"><div id="stage"><canvas id="view"></canvas>
  <div id="hud"> … buttons, joystick, clock, dialog, toast, menu … </div>
</div></div>
```
```css
html,body{margin:0;position:fixed;inset:0;overflow:hidden;touch-action:none;user-select:none;background:#000}
#wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
#stage{position:relative;overflow:hidden;container-type:size}     /* cqh units scale the HUD with the stage */
canvas#view{position:absolute;inset:0;width:100%;height:100%}
#hud{position:absolute;inset:0;pointer-events:none} #hud button{pointer-events:auto;min-width:48px;min-height:48px}
/* display.js sets --sat/--sar/--sab/--sal (safe areas) and --hk (HUD scale) on #stage: use them */
#row{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(var(--sab,0px) + 1.6cqh)}
```

### 5.1 Input: keyboard, mouse, gamepad, touch joystick
```js
import { keys, takePressed, pressKey, loaded } from 'kit/common.js';
import { createInput } from 'kit/input.js';
const input = createInput({ storageKey: 'mygame.input', stickKeys: false, canvas: renderer.domElement, onToast: toast,
  binds: { A: 'Space', B: 'Escape', X: 'KeyE', Y: 'KeyH', LT: 'KeyQ', START: 'KeyP', SELECT: 'KeyM', R3: 'KeyC' } });
// gamepad buttons arrive as virtual key presses; sticks as input.move / input.look; set input.menu = true while a menu is open
// (the d-pad and left stick then navigate with auto-repeat). <html data-input="kbm|touch|pad"> tracks the last device used.

// floating touch joystick: appears under the left thumb (left third of the screen), smooth analog output
let joyId = null, joyC = null, joyT = null, joyV = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  if (e.pointerType !== 'mouse' && joyId === null && e.clientX < innerWidth / 3) { joyId = e.pointerId; joyC = { x: e.clientX, y: e.clientY }; /* move #joy here */ }
  else drag = { id: e.pointerId, x: e.clientX, y: e.clientY };                       // camera drag (mouse or right side)
});
addEventListener('pointermove', (e) => { if (e.pointerId !== joyId) return; const R = 60;
  let x = (e.clientX - joyC.x) / R, y = (e.clientY - joyC.y) / R; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
  joyT = l < 0.08 ? { x: 0, y: 0 } : { x, y }; });
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, (e) => { if (e.pointerId === joyId) { joyId = null; joyT = null; } });
// in the frame: joyV eases toward joyT (f = 1 - exp(-dt*20)), glides to rest on release
// HUD buttons: pointerdown (not click) -> pressKey(code); e.stopPropagation() so they never start a drag
for (const b of document.querySelectorAll('[data-k]')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pressKey(b.dataset.k); });
```
Movement every frame (camera-relative, all devices summed):
```js
const k = (a, b) => (keys[a] || keys[b] ? 1 : 0);   // keys[] is undefined until first pressed: never subtract raw values
let ix = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + (joyV ? joyV.x : 0) + input.move.x;
let iz = k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp') + (joyV ? joyV.y : 0) + input.move.y;
const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
// camera at player + (sin yaw, cos yaw)*dist  =>  forward = -(sin yaw, cos yaw), right = (cos yaw, -sin yaw)
const mx = Math.cos(yaw) * ix + Math.sin(yaw) * iz, mz = -Math.sin(yaw) * ix + Math.cos(yaw) * iz;
player.position.x += mx * 5.2 * dt; player.position.z += mz * 5.2 * dt;
if (il > 0.05) player.rotation.y += wrapA(Math.atan2(mx, mz) - player.rotation.y) * (1 - Math.exp(-dt * 12));
for (const code of takePressed()) { /* Space jump, KeyE talk, KeyQ lock, KeyC camera, KeyM map, KeyP settings, KeyH hint */ }
```

### 5.2 Cameras: follow, free, lock-on
```js
import { followYaw, lockFrame, pickTarget, wrapA, PITCH, clampPitch, upAmount, lookUp } from 'kit/camrig.js';
const C = { yaw: Math.PI, pitch: PITCH.rest, dist: 7, idle: 9, mode: 'follow', lock: null };
function updateCamera(dt) {
  const yawIn = (keys.KeyX ? 1 : 0) - (keys.KeyZ ? 1 : 0) + input.look.x, pitchIn = input.look.y;
  const mdx = drag.dx + input.mouse.dx, mdy = drag.dy + input.mouse.dy; /* reset the accumulators */
  if (yawIn || pitchIn || mdx || mdy) C.idle = 0; else C.idle += dt;            // manual input wins for 1.5 s
  C.yaw -= yawIn * 2.4 * dt + mdx * 0.006; C.pitch = clampPitch(C.pitch + pitchIn * 1.6 * dt + mdy * 0.005);
  const p = player.position; let pos, look;
  if (C.lock) { const f = lockFrame(p, C.lock.pos, { dist: 6.4, height: 2.5 }); pos = f.pos; look = f.look; }     // frames both
  else {
    if (C.mode === 'follow') C.yaw = followYaw(C.yaw, { facing: player.rotation.y, moving, moveT, idle: C.idle, dt });
    const cp = Math.max(PITCH.low, C.pitch);
    pos = { x: p.x + Math.sin(C.yaw) * Math.cos(cp) * C.dist, y: p.y + 1.2 + Math.sin(cp) * C.dist, z: p.z + Math.cos(C.yaw) * Math.cos(cp) * C.dist };
    look = { x: p.x, y: p.y + 1.1, z: p.z };
    ({ pos, look } = lookUp(pos, look, p, upAmount(C.pitch), { h: heightAt }));   // pitch below 0.05: sink + look up into trees
  }
  pos.y = Math.max(pos.y, heightAt(pos.x, pos.z) + 0.5);                          // never inside the ground
  camera.position.set(pos.x, pos.y, pos.z); camera.lookAt(look.x, look.y, look.z);
}
// lock-on (Q / LT): C.lock = pickTarget(player.position, npcs.map((n) => ({ pos: n.position })), 14); release past 18 units
```

### 5.3 Display: presets, fullscreen, install, rotate overlay
```js
import { createDisplay } from 'kit/display.js';
const display = createDisplay({ renderer, cameras: () => [camera], storageKey: 'mygame.display', title: 'My Game', onToast: toast });
display.apply();                                     // sizes the stage + renderer; re-runs on resize / rotation
fsButton.addEventListener('click', () => display.toggleFS());       // must run INSIDE the user gesture
addEventListener('keydown', (e) => { if (e.code === 'Backquote') display.toggleFS(); });
// Settings rows: display.cycle('res' | 'aspect' | 'scale') + display.label(k); Install app: display.install() + display.installLabel()
```
In the page `<head>`, stash the install prompt early, register a network-first service worker, and link a manifest with
`"display":"fullscreen","orientation":"landscape"` and 192/512 px icons:
```html
<script>addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__bip = e; });
if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));</script>
```
```js
// sw.js: network-first, so updates always show up when online
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => { if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open('v1').then((k) => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request))); });
```

### 5.4 Minimap
```js
import { createMinimap, bakeMap } from 'kit/minimap.js';
const mapImg = bakeMap({ size: SIZE, h: heightAt, paths: [PATH], props: trees.map((t) => ({ model: 'tree', pos: [t.x, 0, t.z], scale: 1 })), big: ['tree', 'house'], px: 160 });
const mini = createMinimap({ parent: hud, view: () => (menuOpen ? null : {
  img: mapImg, size: SIZE, x: player.position.x, z: player.position.z, facing: player.rotation.y,
  marks: [{ x: friend.position.x, z: friend.position.z, c: '#a24dff', r: 3.2, ring: true }],
  heading: questGoal /* {x, z} or null: red chevron on the rim, orange dot when within 7 units */ }) });
// every frame: mini.update(dt, t)  (draws at 15 Hz; top-right, inside the safe area; return null to hide it)
```

### 5.5 Day / night cycle
```js
import { DayNight } from 'kit/lights/daynight.js';
const dn = new DayNight({ scene, camera, cycleSeconds: 240, nightShare: 0.6, startHour: 19.6, radius: 110,
  fog: { near: 18, far: 70, nightNear: 9, nightFar: 46 } });
dn.ambientGain = matchMedia('(pointer: coarse)').matches ? 1.9 : 1.55;   // gloom, never pitch black; phones brighter
// every frame (not while paused): dn.update(dt); then use dn.lightsOn (0..1, rises before dusk ends) and dn.night (0..1)
// Settings > Time of day: Cycle / Day (dn.hour = 12; dn.paused = true) / Night (dn.hour = 22.5; dn.paused = true)
```

### 5.6 Glow lights: torches, lanterns, springs, wisps (gloom and glow)
```js
import { LightPool, QUALITY, resolveQuality, haloSprite, groundGlow, glowTexture } from 'kit/lights/glowkit.js';
import { WispSwarm } from 'kit/lights/wisps.js';
const GLOOM = { coldfire: '#3d9bff', violet: '#a24dff', red: '#ff2a48', cyan: '#19f6ff' };
const quality = resolveQuality(new URLSearchParams(location.search).get('lightq') || 'auto');   // low | medium | high
renderer.shadowMap.enabled = QUALITY[quality].shadows > 0;
const pool = new LightPool(scene, { quality });       // 3 / 4 / 8 real PointLights, re-assigned every frame by priority + distance
const glows = [];
function addGlow(obj, at, col, { intensity = 1.6, distance = 8, priority = 1, halo = 1.6, ground = 2.2, shadow = false, day = 0.15 } = {}) {
  const h = haloSprite(col, halo, glowTexture('halo'), 0.6); h.position.copy(at); obj.add(h);         // always-on fake glow
  const gg = groundGlow(col, ground, glowTexture('halo'), 0.4); gg.position.set(at.x, 0.05, at.z); obj.add(gg);  // light pool on the ground
  obj.updateMatrixWorld(true); const wp = h.getWorldPosition(new THREE.Vector3());
  const emitter = pool.add({ position: wp, color: col, intensity, distance, priority, castShadow: shadow });
  glows.push({ halo: h, ground: gg, emitter, day });
}
// cold-fire torch: post + bowl + additive blue flame sprite + glow (priority 1.4, may cast the one shadow)
function torch(x, z) { const g = new THREE.Group(); g.position.set(x, heightAt(x, z), z);
  const post = mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.6, 5), '#5a3a20'); post.position.y = 0.8; g.add(post);
  const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: coldFlameTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  fl.scale.set(0.55, 0.8, 1); fl.position.y = 2.0; g.add(fl);
  addGlow(g, new THREE.Vector3(0, 2, 0), GLOOM.coldfire, { intensity: 1.8, distance: 9, priority: 1.4, shadow: true }); return g; }
// every frame, after dn.update(dt):
for (const gl of glows) { const l = Math.max(gl.day, dn.lightsOn); gl.emitter.level = l;
  gl.halo.material.opacity = 0.6 * (0.35 + 0.65 * l); gl.ground.material.opacity = 0.4 * l; }
pool.update(camera, dt, t);
// wisps around the spring + fireflies over the clearing, in Bill's palette
const wisps = new WispSwarm({ preset: 'spirit', palette: GLOOM, colors: ['coldfire', 'violet', 'red', 'cyan'], count: 10, center: [26, 2, -24], bounds: [10, 2, 10], lights: 0 });
scene.add(wisps.object); /* each frame: wisps.level = Math.max(0.25, dn.night); wisps.update(t); */
```
Cold-fire flame texture: a 32 px canvas with a radial gradient `rgba(235,250,255,1)` → `rgba(110,190,255,.95)` →
`rgba(40,90,255,0)` in an upright ellipse. For GLB torches, swap the red and blue channels of the flame and ember textures and of
the flame vertex colours (Mossgnome `grovelights.js` → `coldFire()`).

Make every **goal** glow (springs, portals, quest items): give it `day: 0.3-0.45` so it shows by day too, priority 1.6-2.2, a big
halo (2.4-2.6) and a ground glow (3.4). In walk-through hideouts, add an inner glow so they are never pitch black.

### 5.7 Portals (Gravewake style)
Portals are swirling **spiral vortices with stepped colour rings**: a light rim, darker rings toward a dark eye, and a slightly
ragged rim. Draw them procedurally; never copy reference art.
```js
function vortexTex(cols /* rim -> eye, e.g. ['#fff6ff','#d8a8ff','#a24dff','#5a2aa0','#1a0a30'] */) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), im = g.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const dx = (x - 31.5) / 32, dy = (y - 31.5) / 32, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx), i = (y * 64 + x) * 4;
    if (r > 1) continue;
    const band = Math.floor((((r * 4.2 + a / (2 * Math.PI) * 2) % 1) + 1) % 1 * 2) + Math.floor(r * (cols.length - 1));
    const k = new THREE.Color(cols[Math.max(0, cols.length - 1 - Math.min(band, cols.length - 1))]), rim = r > 0.9 ? 1.3 : 1;
    im.data[i] = Math.min(255, k.r * 255 * rim); im.data[i + 1] = Math.min(255, k.g * 255 * rim); im.data[i + 2] = Math.min(255, k.b * 255 * rim); im.data[i + 3] = r > 0.96 ? 140 : 255;
  }
  g.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.magFilter = THREE.NearestFilter; return t;
}
// a stone arch (2 box posts + lintel) + CircleGeometry(1.25, 16) with MeshBasicMaterial({ map: vortexTex(...), transparent, fog: false })
// spin: fill.rotation.z -= dt * 1.6; glow with addGlow(... GLOOM.violet, { priority: 1.6, day: 0.3 });
// walk in (distance < 1): fade a violet overlay, teleport 2.4 units out of the linked portal, face away from it, 1.2 s cooldown
```

---

## 6. Bill's required features checklist

- [ ] **Controls:** floating touch joystick (left third) + camera drag (right side) + on-screen A/B buttons; Bluetooth/USB
      gamepad (left stick move, right stick camera, A jump, X talk, B back, Start settings, d-pad menus); WASD/arrows + mouse drag
      (optional pointer lock).
- [ ] **Cameras:** follow (eases behind, manual input wins for 1.5 s), free orbit, lock-on (Q / LT) that frames the player and
      target; toggle with C / R3 / a Cam button; look up under the trees; never inside the ground.
- [ ] **Display:** fullscreen button at the left edge plus the ` key (iPhone: Add to Home Screen tip); Settings with Resolution
      (Auto / Phone / 720p / 1080p / Retro 320x240), Aspect, Render scale, Time of day, Lights quality, Minimap, Camera.
- [ ] **Install app** row in Settings (`beforeinstallprompt`, or steps for iPhone / Android / desktop), manifest, network-first `sw.js`.
- [ ] **Minimap** top-right: facing arrow, friend marks, red quest chevron, orange goal dot on arrival; M toggles it.
- [ ] **Bottom HUD row:** pause, hint, map, camera, plus the clock, in one row between the joystick and the action buttons.
      Every touch target at least 44 px, everything inside the safe areas, no overlaps.
- [ ] **Day/night cycle** with gloom-and-glow lights: cold-fire torches, violet/red lanterns, glowing goals, wisps; readable at night.
- [ ] **Gravewake-style portals:** spiral vortex, stepped rings, glowing, teleporting.
- [ ] Portrait phones get a "turn your phone sideways" overlay; no page scroll, pinch zoom or long-press menus.
- [ ] **Repo hygiene:** `CHANGELOG.md` entry for every change, `AGENTS.md` describing the current state, layout and gotchas;
      run a **secret scan** over files and history before every push (abort if anything is found).

---

## 7. Suite tools (only with access to the n64-suite box)

Skip this section if you are building in a chat tool without the box. Everything above works without it.

```bash
n64 themes                                            # verdant frost ember haunted dunes reef storybook chronicle castlekeep mossgnome
n64 new moss-cave --title "Moss Cave"                 # minimal playable starter + runtime -> ./moss-cave (plain static files)
n64 serve moss-cave                                   # http://127.0.0.1:8065/
n64 ui                                                # web UI with previews at http://127.0.0.1:8064
n64 model --kind hero --theme verdant --seed 3 --out out/   # low-poly GLB + OBJ + turntable (kinds: hero npc creature boss tree rock building prop weapon item, or all)
n64 texture --kind all --size 32 --colors 16 --out out/     # tileable 32/64 px textures, Bayer dither, CI4/CI8 + TLUT
n64 sprite --what all --title "Moss Cave" --out out/        # icons, billboards, HUD, bitmap font, logo, portraits
n64 music --mood all --out out/  ·  n64 sfx --kind all --out out/
n64 quest | lore | personality | dialogue | items | enemies | names | world | skybox | palette --theme X --seed N --out out/
n64 wisps | torches | lanterns | daynight | butterflies | nightlights --out out/    # glow kit pieces + demos (lights/)
n64 assemble --theme mossgnome --seed 64 --lights --shots   # full coherent project -> /workspace/n64-projects/<id>-64
n64 shots /workspace/n64-projects/mossgnome-64              # headless screenshots -> preview/shots/shots_sheet.png
```
Dropping generated assets into a starter game: copy `models/*.glb`, `textures/*.png`, `audio/*.wav` into the game folder, load
GLBs with `load(url)` from `common.js` (it clones, sets DoubleSide + fog, converts to lit materials when `LIGHT.lit`), and use
`tex(url)` for textures. `n64 assemble` **replaces the output folder**: never point it at a folder with a `.git` you care about.
Assemble into a scratch folder, then copy the files over.

---

## 8. Why builds fail (real bugs and their fixes)

1. **Invisible NPCs: they were never added to the scene.** The models were built, placed, animated and even collided with, but
   `scene.add()` was missing. *Fix:* add every NPC, and test with `npc.parent === scene` and real screenshot pixels.
2. **Lit meshes render black or vanish: missing normals.** Generated geometry (paths, ribbons, some glTF) had no `normal`
   attribute, so Lambert shading was undefined. *Fix:* `if (!geo.attributes.normal) geo.computeVertexNormals()` for every lit mesh.
3. **Skinned characters vanish when torch shadows are on.** Skinned meshes in the point-light cube-shadow pass stopped drawing on
   some GPUs (SwiftShader, about half of page loads). *Fix:* `castShadow = false` for skinned NPCs; only the player and static props cast.
4. **Too many lights: phones stall or shaders recompile.** *Fix:* a fixed LightPool (3/4/8) with at most 0/1/2 shadow lights;
   halos and ground glows fake the rest.
5. **Night is pitch black.** *Fix:* an ambient floor (`ambientGain` 1.55 desktop / 1.9 phone), glowing goals with `day` levels,
   inner glows in hideouts, and a luminance test (average 20-75, under 25% near-black).
6. **Assemble wiped `.git`.** The generator replaces its output folder. *Fix:* generate into scratch and copy over.
7. **Local test server suddenly returns 404 for everything:** `/tmp` was cleaned overnight. *Fix:* serve from a folder under
   `/workspace/scratch/...`, not `/tmp`.
8. **HUD under the notch / home bar, or buttons too small.** *Fix:* use display.js's `--sat/--sar/--sab/--sal` vars in every
   edge-anchored element, min 44-48 px targets, and test with `?safearea=0,44,21,44`.
9. **Input blocked or doubled.** Keys are swallowed until `loaded()` is called (the loading gate). HUD buttons must
   `stopPropagation()` or they also start a joystick or camera drag. Set `input.menu = true` while menus are open, or the stick
   walks the player behind the menu.
10. **Fullscreen does nothing.** `requestFullscreen` only works inside a user gesture, so call it from the click or keydown
    handler, never from the game loop. iPhone Safari has no element fullscreen; show Add to Home Screen steps instead.
11. **Walking goes backwards.** With the camera at `player + (sin yaw, cos yaw) * dist`, forward is `-(sin yaw, cos yaw)`.
    Mixing conventions inverts W/S or the stick.
12. **"Failed to load module script … MIME type text/plain".** You imported from raw.githubusercontent.com. Import from
    `https://unclebill-spec.github.io/mossgnome/...` (Pages, correct MIME and CORS), or paste the code in.
13. **Two copies of three.js** ("multiple instances" warning, broken `instanceof`, materials not updating). Map `"three"` once in
    the import map to the same file the kit uses.
14. **Washed-out or too-dark colours.** Mixed colour management. *Fix:* `THREE.ColorManagement.enabled = false`,
    `renderer.outputColorSpace = LinearSRGBColorSpace`, `texture.colorSpace = NoColorSpace`.
15. **Blurry modern look.** Antialiasing on, pixel ratio 2-3, or smooth shading. *Fix:* `antialias: false`, `setPixelRatio(1)`,
    `flatShading: true`, and let the display presets choose the render size.
16. **Camera inside a tree or hill.** Clamp the camera above `heightAt + 0.5`, keep trees off the path, and pick screenshot
    angles that are not blocked by trunks.
17. **Timing-sensitive tests flake in software GL.** Headless SwiftShader may run at 5-15 fps. Poll state with generous
    windows (0.5-1 s), and don't assert exact frame timings.

---

## 9. Verification checklist

Run these before you call a build done (all are headless Chromium via Playwright, and need the box):

| test | covers |
|---|---|
| `tests/input/t_starter.py [URL]` | the starter: friend in scene, triangle budgets, WASD/jump/mouse, talk→quest→chevron→spring, lock-on, camera modes, portal, settings (Install app, Retro 320x240), day vs night luminance, glow pool, gamepad stick/buttons/menu, phone touch joystick + A button, 44 px targets, safe area, no overlaps, portrait overlay, no console errors |
| `t_npcs.py` | every NPC is in the scene and visible in real screenshot pixels, at night with torch shadows on |
| `t_hud.py` | bottom row, clock, fullscreen at the left edge, minimap top-right, Install app; phones, desktop, TV presets, Retro, controller |
| `t_mapcam.py` | minimap heading/goal, follow / free / lock-on cameras, look-up |
| `t_display.py` | resolution presets, aspect, scale, fullscreen (button, ` key, Start+Select), rotate overlay, iPhone tip |
| `t_night.py` | day/night cycle, ambient floors (desktop and phone), palette weighting (Bill's neons ≥ 60%), springs glow on every level, quality caps and the Auto guard |
| `/workspace/scratch/mobiletest.py` | phone flows: joystick, jump while holding the stick, buttons |
| `/workspace/scratch/sec/scan.py` | secret scan over the files and the full git history |

**Screenshot sheet:** capture day, night, the goal at night, a portal, a phone with touch controls, and Retro, then tile them into
one PNG (`n64 shots DIR` for assembled projects; `t_starter.py` writes its shots to `/workspace/scratch/starter-shots/`). Look at
every image: no black areas, no trunks filling the frame, the HUD clear of the notch.

Without the box (chat builders): open the game with `?hour=12&cycle=0` and with `?hour=22&cycle=0`, try a phone-sized window with
touch emulation, plug in a controller, and confirm every item in section 6 by hand. Keep the console free of errors.

---

## 10. Recommended build order (small milestones, each one playable)

1. **Page + renderer:** the HTML skeleton, import map, `makeRenderer()`, a camera, fog, a flat ground, `loop()`, `loaded()`. *Check:* a green plane in fog, 30 fps.
2. **Terrain + props:** heightfield with vertex colours and a 32 px texture, a path, trees, rocks, colliders. *Check:* under 5k tris.
3. **Player:** the procedural gnome, WASD movement, jump, 15 fps stepped walk. *Check:* 300-700 tris; W walks away from the camera.
4. **Camera rig:** follow + free + lock-on, mouse drag, ground clamp, look-up.
5. **Input everywhere:** `createInput` (gamepad), floating touch joystick, A/B buttons, `data-input`-driven HUD.
6. **Display + HUD:** `createDisplay`, the bottom row + clock, fullscreen button, Settings (presets, Install app), safe areas, 44 px.
7. **NPC + dialogue + quest:** add the friend **to the scene**, talk prompt, dialogue box, a quest step.
8. **Minimap:** `bakeMap` + `createMinimap`, friend mark, quest chevron and goal dot.
9. **Day/night:** `DayNight` with fog ranges and ambient floors, the Time of day setting.
10. **Gloom and glow:** LightPool (quality setting), cold-fire torches, violet/red lanterns, the glowing goal, wisps. *Check:* night luminance 20-75.
11. **Portals:** vortex texture, arch, teleport with a fade.
12. **Polish + hygiene:** sounds, toasts, hint button, `CHANGELOG.md`, `AGENTS.md`, screenshot sheet, secret scan, then push and check the live site.

After the starter works, grow it one level or system at a time, and re-run the checks after each step.

---

## 11. File reference

Read (raw, for copying): `https://raw.githubusercontent.com/unclebill-spec/mossgnome/main/<path>`.
Import (Pages, ES modules with CORS): `https://unclebill-spec.github.io/mossgnome/<path>`.

| path | what |
|---|---|
| `starter/index.html`, `starter/starter.js`, `starter/sw.js`, `starter/app.webmanifest` | the minimal complete game (start here) |
| `common.js` `input.js` `camrig.js` `display.js` `minimap.js` | shared runtime |
| `lights/glowkit.js` `lights/daynight.js` `lights/wisps.js` | procedural glow + day/night (no model files needed) |
| `lights/torches.js` `lights/lanterns.js` `lights/butterflies.js` + `lights/models/*.glb` `lights/sprites/*.png` | GLB-based glow props |
| `grove.js` `grovelights.js` `grove.css` `index.html` | the full Mossgnome game (big; reference for HUD, levels, night layer) |
| `vendor/three.module.js` (r160), `vendor/addons/*` | three.js |
| `docs/N64_GRAPHICS_GUIDE.md`, `docs/GROK_BUILD_PROMPT.md` | this guide and the paste-in prompt |

In the n64-suite (box only): the guide is `/workspace/n64-suite/docs/N64_GRAPHICS_GUIDE.md`, the starter source is
`n64/web/starter/`, the runtime is `n64/web/rpg/` and `n64/web/lights/`, and `n64 new` is in `n64/starter.py`.
