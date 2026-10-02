# Paste-in prompt: build an N64-style 3D browser game

> Copy everything below the line into Grok build mode. Change the one line under "The game" to your idea, or leave it as is to
> get the starter adventure.

---

You are building a complete, playable **3D browser game with Nintendo 64-style graphics** in three.js. Follow these rules
exactly. Work in the small steps listed under "Build order". Each step must run before you start the next one.

## The game

**Idea:** A cozy gnome adventure. One forest clearing with two huts, a friendly gnome to talk to, a quest to find a glowing
spring, and a pair of swirling portals, all in a day/night cycle where the night is dark and full of glowing lights.

Keep the first version that small. Make it complete, polished and bug-free before adding anything.

## Working reference code (use it)

A tested game with every feature below already exists. Read it before you write code, and copy or import from it:

- Starter game (about 450 lines, every required feature): https://raw.githubusercontent.com/unclebill-spec/mossgnome/main/starter/starter.js
  and https://raw.githubusercontent.com/unclebill-spec/mossgnome/main/starter/index.html. Live version: https://unclebill-spec.github.io/mossgnome/starter/
- Full guide with numbers and code: https://raw.githubusercontent.com/unclebill-spec/mossgnome/main/docs/N64_GRAPHICS_GUIDE.md
- Shared runtime modules. Read them on raw.githubusercontent.com; import them from GitHub Pages:
  `common.js`, `input.js`, `camrig.js`, `display.js`, `minimap.js`, `lights/glowkit.js`, `lights/daynight.js`, `lights/wisps.js`
  under `https://unclebill-spec.github.io/mossgnome/`
- Full game for deeper reference: https://raw.githubusercontent.com/unclebill-spec/mossgnome/main/grove.js and `grovelights.js`

**How to import.** Use exactly one copy of three.js (r160), the same one the modules use:
```html
<script type="importmap">{"imports":{
  "three":"https://unclebill-spec.github.io/mossgnome/vendor/three.module.js",
  "kit/":"https://unclebill-spec.github.io/mossgnome/"}}</script>
<script type="module" src="game.js"></script>
```
Then `import { createInput } from 'kit/input.js'` and so on. **Never import from raw.githubusercontent.com.** It serves
`text/plain` and the browser refuses to run it as a module. If your environment cannot load remote modules, copy the code of the
files you need into your project and keep their APIs unchanged.

The page must contain `<div id="wrap"><div id="stage"><canvas id="view"></canvas><div id="hud">…</div></div></div>` (the display
layer sizes `#stage`; the renderer draws into `#view`). Call `loaded()` from `common.js` once everything is built, because keys
are ignored until then.

## The N64 look, in numbers

- **Triangles:** player 300-700, NPCs 200-400, creatures 150-450, bosses 600-1200, props 10-120 each, **4k-12k per frame** in total.
- **Models:** build them procedurally from three.js primitives with low segment counts (cylinders with 5-8 sides, 7-sided cones,
  8x6 spheres, icosahedrons with detail 0, boxes). Jitter vertices slightly for a hand-made look. No model files are needed.
- **Rigid skinning:** every limb is its own mesh hung on a pivot `Group` (shoulder, hip, neck); animate by rotating pivots.
- **Animation:** snap time to **15 fps** steps (`Math.floor(t * 15) / 15`); walk stride pair 0.4-0.8 s; jump = arms up, legs tucked.
- **Textures:** **32x32** canvases (64x64 max), 8-16 colours, soft speckle noise, tiling every 4 world units, **bilinear**
  (`LinearFilter` + mipmaps). `NearestFilter` is only for an optional crisp mode and pixel-art portals.
- **Colour:** vertex colours and material colours carry the hue; textures stay light and low-contrast. One palette of 16-32 colours.
- **Materials:** `MeshLambertMaterial({ flatShading: true })` for everything lit. `MeshBasicMaterial` with additive blending,
  `depthWrite: false` and `fog: false` for glows, flames, lantern glass and portal swirls. No Standard/Physical materials, normal
  maps or env maps.
- **Renderer:** `antialias: false`, `setPixelRatio(1)`, `THREE.ColorManagement.enabled = false`,
  `outputColorSpace = LinearSRGBColorSpace`, texture `colorSpace = NoColorSpace`, `shadowMap.type = BasicShadowMap`.
- **Resolution:** a Retro preset of **320x240**; phones render at most 480 px tall; window, 720p and 1080p presets for TVs.
- **Frame rate:** cap the game loop at **30 fps**.
- **Fog:** always on, linear. Day near 18 / far 70; night near 9 / far 46. Fog colour follows the sky horizon. Camera far plane 220.
- **Camera:** FOV 55, third person 7 units back, pitch 0.32 rad, never below the ground.
- **Terrain:** a 33x33 heightfield over 96x96 units (about 2,000 tris) with baked vertex colours, dirt paths painted into the
  vertex colours, and a low ring of hills at the edge that fades into fog.

## Bill's look: gloom and glow

Bill's favourite look is dark environments full of glowing objects. His signature colours are **neon blue cold fire `#3d9bff`**
(top favourite), **violet neon `#a24dff`** and **red neon `#ff2a48`**, with cyan `#19f6ff` alongside the cold fire.
- Most torches burn **blue cold fire**; keep one or two warm orange torches for contrast.
- Lanterns are mostly violet and red, with some cold-fire blue. Wisps and fireflies use only these colours.
- Every goal (the spring, the portals, quest items) glows, even a little by day.
- Use a **fixed pool of real point lights**, `LightPool` from `lights/glowkit.js`: 3 on low quality, 4 on medium, 8 on high, with
  0/1/2 shadow lights. Each glowing object also gets a halo sprite and a ground-glow disc, so it glows without a real light.
  Never add a PointLight per torch.
- **Readable at night:** use `DayNight` from `lights/daynight.js` with `ambientGain` 1.55 on desktop and 1.9 on phones. The night
  view should average roughly 20-75 out of 255 in brightness with under 25% near-black pixels. No area may be too dark to play.

## Required features (all of them, in the first version)

1. **Controls on every device**
   - Touch: a **floating joystick** that appears under the left thumb (left third of the screen), with smooth analog output;
     drag on the right side to turn the camera; round **A** (jump) and **B** (talk) buttons bottom-right.
   - Gamepad (`createInput` in `input.js`): left stick moves, right stick turns the camera, A jumps, X talks, B backs out of menus,
     Start opens Settings, and the d-pad and stick navigate menus (set `input.menu = true` while a menu is open).
   - Keyboard and mouse: WASD/arrows walk, Space jumps, E talks, Q locks on, C toggles the camera mode, Z/X turn the camera, mouse
     drag looks, M toggles the map, H gives a hint, P opens Settings, ` toggles fullscreen.
   - Show touch controls only when `<html data-input="touch">`, which `input.js` sets from the last device used.
2. **Cameras** (`camrig.js`): follow (eases behind the player; manual input wins for 1.5 s), free orbit, and **lock-on** that
   frames the player and the target (`lockFrame`, `pickTarget` within 14 units, released past 18). Looking up under the trees
   uses `lookUp`. Clamp the camera at least 0.5 above the ground.
3. **Display** (`display.js`): a fullscreen button at the top-left edge plus the ` key. Call `display.toggleFS()` directly
   inside the click or keydown handler. Settings has Resolution (Auto / Phone / 720p / 1080p / Retro 320x240), Aspect
   (Fit / 16:9 / 4:3), Render scale, Camera, Time of day (Cycle / Day / Night), Lights (Auto / Low / Medium / High), Minimap,
   Fullscreen and **Install app** (`display.install()`, labelled with `display.installLabel()`). Portrait phones show the
   "turn your phone sideways" overlay (built in).
4. **Installable app:** `app.webmanifest` (`display: fullscreen`, `orientation: landscape`, 192 and 512 px icons drawn on a
   canvas or as simple PNGs), a network-first `sw.js`, and in `<head>`:
   `addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__bip = e; })`.
5. **Minimap** top-right (`bakeMap` + `createMinimap` from `minimap.js`): facing arrow, a mark for the friend, a red chevron
   pointing toward the current quest goal, and an orange dot when you arrive (within 7 units). M hides it.
6. **Bottom HUD row:** pause, hint, map and camera buttons plus a clock, in one centred row at the bottom between the joystick and
   the action buttons. Every touch target is at least 44 px (use 48). Every edge-anchored element adds the safe-area variables
   that `display.js` sets on `#stage` (`--sat`, `--sar`, `--sab`, `--sal`). Nothing overlaps.
7. **Day/night cycle** (240 s per day, 60% of it night) driving the sky, stars, moon, fog, ambient and all glow levels
   (`dn.lightsOn`, `dn.night`).
8. **Portals in the Gravewake style:** a stone arch holding a **spiral vortex** with stepped colour rings (light rim to dark eye,
   slightly ragged rim; violet `#fff6ff #d8a8ff #a24dff #5a2aa0 #1a0a30`). Draw it on a 64 px canvas and spin it. Walking in
   fades the screen violet and brings you out of the paired portal (1.2 s cooldown).
9. **NPC, dialogue and quest:** a friend gnome (different coat and hat colours) who turns to face you, a "Talk" prompt within
   2.8 units, and a dialogue box (A, Space or E to advance) that starts the quest "find the glowing spring". Reaching the spring
   completes it with a toast.
10. **Repo hygiene:** a `README.md` (how to run and the controls), a `CHANGELOG.md` with a dated entry for every change, and an
    `AGENTS.md` describing the current state, the file layout and the gotchas below. Never put keys, tokens or passwords in
    any file.

## Build order (small steps; each one must run)

1. **Page and renderer:** the HTML skeleton, import map, renderer settings above, camera, fog, a flat ground plane, the 30 fps
   `loop()` from `common.js`, and `loaded()`. You should see a green plane fading into fog.
2. **Terrain and props:** heightfield with vertex colours and a 32 px grass texture, a dirt path, about 26 trees, 10 rocks,
   mushrooms, two huts, and circle colliders. Check the frame stays under 5k triangles.
3. **Player:** the procedural gnome (body, head, nose, eyes, beard, pointed hat, arms and legs on pivots; about 330 triangles),
   camera-relative walking at 5.2 units/s, jumping (velocity 8.5, gravity 22) and the 15 fps walk cycle.
4. **Cameras:** follow, free and lock-on, with mouse drag and the ground clamp.
5. **All inputs:** `createInput`, the floating touch joystick, the A/B buttons, and touch controls that hide on other devices.
6. **Display and HUD:** `createDisplay`, the bottom row and clock, the fullscreen button, the Settings menu (with gamepad
   navigation) and Install app.
7. **NPC and quest:** the friend (**call `scene.add(friend)`**), the talk prompt, dialogue and quest step.
8. **Minimap** with the friend mark, quest chevron and goal dot.
9. **Day/night** with the fog ranges and ambient floors, and the Time of day setting.
10. **Gloom and glow:** LightPool with the quality setting, 5 torches (4 cold fire), 4 lanterns (violet, red, cold fire,
    violet), the glowing spring (cyan water with caustics, a ring of stones, wisps), and fireflies over the clearing.
11. **Portals:** two linked vortex portals at opposite edges.
12. **Polish:** toasts, a hint button, README / CHANGELOG / AGENTS. Then run the self-check below.

## Why builds fail (avoid every one of these)

- **Invisible NPCs:** the NPC was built but never passed to `scene.add()`. Check `npc.parent === scene`.
- **Black or vanishing lit meshes:** the geometry has no normals. Call `geometry.computeVertexNormals()` on every lit mesh.
- **Vanishing skinned characters** (if you ever load glTF): skinned meshes must not cast point-light shadows. Only the player
  and static props cast shadows.
- **Phones freezing:** too many point lights or shadow maps. Use the fixed LightPool and its quality caps.
- **Pitch-black night:** raise the ambient floor, make goals glow by day too, and add inner glows in caves and tunnels.
- **Walking backwards:** the camera sits at `player + (sin yaw, cos yaw) * dist`, so forward is `-(sin yaw, cos yaw)` and right is
  `(cos yaw, -sin yaw)`. Movement is `mx = cos(yaw)*ix + sin(yaw)*iz`, `mz = -sin(yaw)*ix + cos(yaw)*iz`, where `iz` is
  negative for "up" or W.
- **NaN positions:** `keys.KeyW` is `undefined` until first pressed. Use `(keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0)` and never
  subtract raw values.
- **Keys ignored:** `loaded()` was never called.
- **HUD buttons also move the camera or joystick:** handle buttons on `pointerdown` with `preventDefault()` and
  `stopPropagation()`.
- **The player walks while a menu is open:** set `input.menu = true` and skip movement while menus or dialogue are open.
- **Fullscreen does nothing:** it was requested outside a user gesture (for example, from the game loop). iPhone Safari has no
  element fullscreen, and `display.js` shows Add to Home Screen steps instead.
- **"Failed to load module script… MIME type text/plain":** you imported from raw.githubusercontent.com. Use the GitHub Pages
  URL, or paste the code in.
- **"Multiple instances of three.js":** the import map must map `three` exactly once, to the kit's `vendor/three.module.js`.
- **Washed-out colours:** colour management was left on. Use the renderer settings above.
- **Modern, smooth look:** antialiasing, a high pixel ratio, smooth shading or too many triangles. Use the numbers above.
- **HUD under the notch or home bar:** the safe-area variables are missing. Test with `?safearea=0,44,21,44` in the URL.
- **Camera inside trees:** keep trees off paths and clamp the camera above the ground.

## Self-check before you say it's done

Open the game, check every item, and fix anything that fails:
- No console errors. The loading screen disappears, and you can walk, jump, talk, lock on, switch cameras and open Settings.
- The player is 300-700 triangles and the frame is under 12k (log `renderer.info.render.triangles`).
- `?hour=12&cycle=0` is bright and colourful. `?hour=22&cycle=0` is dark but readable, with blue cold fire, violet and red glows.
- In a phone-sized landscape window with touch, the joystick walks, A jumps, every button is at least 44 px, and nothing overlaps
  or sits under the notch. In portrait, the rotate overlay shows.
- A gamepad moves the player and camera, Start opens Settings, the d-pad moves the menu cursor, A activates, B closes.
- The minimap chevron points to the friend, then to the spring; the orange dot shows on arrival.
- The portals teleport you both ways. Retro 320x240 looks chunky and pixelated. Fullscreen and Install app respond.
- README, CHANGELOG and AGENTS describe what you built.

Report what you built, the controls, any known issues, and anything you could not do.
