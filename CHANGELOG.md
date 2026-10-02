# Changelog

Mossgnome and the Hidden Springs (published build). Newest first. Times are US Eastern (UTC-4).
Every entry is one commit on `main`; to roll back, `git checkout <hash>` (look) or `git revert <hash>` (undo on main).
Live: https://unclebill-spec.github.io/mossgnome/

## 2026-10-02 07:51: Day and night: a time-of-day cycle with glowing torches, lanterns, wisps and butterflies ("gloom and glow")
- **Time of day:** the world now has a day/night cycle, about 20 minutes per full day, with nights a bit longer than days. Dusk is short: about 6 to 7 PM in-game, roughly 50 seconds of real time.
  - The HUD clock shows the time of day (for example 10:30 PM). Play time is still in the pause menu and the credits.
  - **Settings > Time of day:** Cycle (default), Always day or Always night. The choice is remembered.
  - **Pause > Rest until nightfall / Rest until morning:** in the village only, in Cycle mode, and not during the chase.
  - A new game starts in the late afternoon. Continue restores the saved hour. The ending is always a bright morning.
- **Lights at night:** torches with real shadows, glow-fish lanterns along the paths, wisps and fireflies that fade in at dusk, and glowing butterflies at the springs. Characters, the dwarf and friends glow faintly at night, so they stay easy to see.
- **"Gloom and glow" (Bill's favourite look):** the night is dark blue-violet, so the glowing things carry the scene. Lanterns, wisps and butterflies lean on Bill's signature neons:
  - neon blue cold fire first, then violet neon, then red neon (cyan rides along with the cold fire)
  - Some torches burn **blue cold fire**: the village brazier, every other house torch, the cavern gate, one torch at each cave mouth, and the Cold Forge braziers. The rest stay warm orange for contrast.
- **Every spring glows at night:** each one has its own lantern (in its colour), butterflies, a halo above it, a pool of light around it and its own light. Walk-through hideouts (root tunnels, hollow logs) also glow inside.
- **Never too dark:** nights have an ambient floor (brighter on phones), plus moonlight. The Cold Forge's dark stone gets a little extra. The HUD, minimap, red quest arrow and orange goal dot look the same at night.
- **Settings > Lighting:** Auto (default), Low, Medium or High. Auto picks per device: High on desktop, Medium on phones. The quality caps the real lights and shadows (Low 3 lights / 0 shadows, Medium 4 / 1, High 8 / 2) and the density of lanterns and swarms.
  - **Auto guard:** if the game runs below about 21 fps for two 6-second stretches, Auto steps down one level (High to Medium to Low).
- **Fix found on the way: friends could vanish with shadows on.** On Medium and High, a friend that went through the torch shadow pass sometimes stopped drawing at all (about half of page loads, in testing). Skinned characters other than the gnome no longer cast torch shadows. Lit meshes that arrive without normals get computed ones.
- **Files:** `grovelights.js` (the night layer: cycle, palette, placement, fades, culling, quality and guard), plus the `lights/` folder (glow kit runtime, torch / lantern / butterfly models, sprites, presets; 1.8 MB, loaded at start). `common.js` gains lit materials (`LIGHT`, `litMaterial`, `ensureNormals`, `castsShadow`).
- **URL and debug:** `?hour=22.5`, `?tod=night`, `?cycle=1` (scenes otherwise start at noon with the clock stopped), `?lightq=low|medium|high`, `?nolights=1` (the classic unlit look) and `&guard=1`. `__debug` gains `setHour`, `setTod`, `setLightQ`, `runClock`, `lag` and `npcShow`, and `__debug()` now includes `tod`, `clock` and `lit`.
- **Tests:** the new `t_night.py` covers the cycle, settings, Rest, light levels, readability at night on desktop, Pixel 7 and Retro, the HUD at night, the palette weighting, every spring at night, the Auto guard and the `?nolights=1` fallback. `t_npcs.py` now also runs at 10:30 PM.
- **Caveats:**
  - Performance was measured only in software GL (SwiftShader) and on emulated phones, so real devices should do better. The Auto guard is the safety net.
  - Already-open tabs need a reload to get the update (the service worker is network-first).
  - The two path ends at the far village edge put the camera inside a giant tree trunk, by day as well as at night (the old camera issue).

## 2026-10-01 23:36: Fix: villagers were invisible (Grandpa Femble and every other friend); orange goal dot on the minimap
- **Bug (reported by Bill on his Android phone):** "Talk to Grandpa Femble" showed up on the village green, but nobody was there.
  - **Cause:** the code that loads friends (NPCs) built each model, its "!" mark and its name tag, but never added them to the 3D scene. So all 9 friends (4 in the village, 2 in Toadstool Wood, 2 in the Caverns, 1 in the Marsh) were invisible on every device since the first build. Their talk spots and colliders still worked.
  - **Fix:** friends are now added to the level.
  - **Safety net:** if a friend's model ever fails to load or comes back empty, a simple stand-in gnome (robe, face, beard, red pointy hat) is shown instead, and a warning is logged. They stay findable and talkable.
  - Master Timble was placed half inside the root house. Any friend standing inside a house, trunk or hideout collider now steps out to its edge when the level loads.
  - Checked the other lists too: critters, chests, pickups, the fox and the dwarf were already in the scene.
- **Minimap goal dot:** when you reach the current quest goal (the point where the red chevron hides), an orange dot now marks the goal itself on the minimap. It pulses gently and has a dark ring. Walk away and the chevron comes back.
- **Tests:** the new `t_npcs.py` runs on Pixel 7 landscape (all levels) and desktop.
  - For every friend it checks that they are not inside a house or tree collider.
  - It walks up to them and faces them, then checks: in the scene, every parent visible, non-zero bounds, inside the camera view, and drawing them really changes pixels (the frame is rendered with and without them). The talk prompt must name them.
  - It also checks that critters, chests and pickups are in the scene.
  - Goal dot: far from the goal there is a chevron and no dot; near Grandpa Femble the chevron hides and the orange dot shows; walking away brings the chevron back.

## 2026-10-01 22:55: HUD layout: bottom button row, smaller HP/MP, minimap top-right, red quest arrow, Install app
- **Bottom row:** the round Pause, Hint, Map and Camera buttons used to sit in a column on the left. They are now one row along the very bottom of the screen, with the clock right beside them.
  - On phones the row sits centred between the joystick and the action buttons, clear of both and above the home-bar safe area.
  - Each touch target is at least 44px (48px on the phones tested).
  - The row only shows in the field and in battle. In battle the spell list sits above it.
- **HP/MP plaque:** about half its old size. It sits at the top-left, just right of the fullscreen icon.
- **Fullscreen button:** moved to the left edge.
- **Minimap:** moved to the top-right corner. The pearl counter and quest text sit to its left.
- **Quest arrow:** the chevron on the minimap rim is now red so it's easier to see. It is still vague, with no distance or exact marker.
- **Settings > Install app:**
  - On Android/Chrome it opens the browser's install prompt (`beforeinstallprompt`) when the browser offers one. Otherwise it shows the steps (⋮ menu > Install app / Add to Home screen).
  - On iPhone/iPad it shows the Share > Add to Home Screen steps.
  - On desktop it shows the steps for the address-bar install icon.
  - It reads "Installed" when the game is running as an installed app.
- **New `sw.js`:** a tiny network-first service worker. Chrome needs one before it will offer the install prompt. It always fetches fresh files when online and keeps a copy of the small page and script files for offline use. It is registered on https only.
- Works in the sideways phone layout (including the iPhone notch), on desktop, with a controller, and in the 720p/1080p TV and Retro 320x240 presets.
- Tests: the new `t_hud.py` (phones, desktop, TV, Retro: row geometry, 44px targets, clearances, corners, red chevron, Install app per platform, stubbed prompt). `t_mapcam.py` now expects the minimap top-right.

## 2026-10-01 21:41: Minimap with a quest-heading chevron; higher look-up camera
- **Minimap** (new `minimap.js`):
  - a small round parchment disc in a wooden rim, north up (gold tick), showing the local area: paths, big houses and trees, friends, gates/exits and found springs
  - a red arrow shows which way you face
  - it is drawn from the level data, so hidden springs and chests are never revealed
  - placement: bottom-right with keyboard/mouse or a controller; on touch it tucks under the HP/MP plaque, clear of the left buttons and thumbstick (it ignores touches, so the floating stick still works under it)
  - hidden in menus, the map, dialogue, battles and the title
  - scales with Display: bigger on 1080p TV, a chunky 56px pixelated disc on Retro 320x240
- **Quest hint arrow:** a faint, gently pulsing chevron on the minimap rim points the general way to the current quest step. There is no distance, beam or exact marker, and it fades once you're there. If the step is in another region it points to the gate or exit that leads there.
- **Quest targets:** `systems/game.json` quests now carry a `target` list (level + npc / springs / fox / boss / exit).
- **Settings:** new **Minimap** and **Quest hint arrow** rows, both On by default and saved.
- **Camera look-up:** you can look much higher into the trees, with the same limits in Follow, Free and Target Lock, via touch drag, mouse or the right stick.
  - the upward pitch limit went from 0.05 to -0.62 rad; the top of the view now reaches about 51° above the horizon (was about 24°)
  - below the old limit the camera sinks to just above the grass, slides in and tilts up, so it never digs into the ground and keeps a clear line to the gnome
  - in Follow mode the look-up now holds while you stand still and eases back once you walk on

## 2026-10-01 18:11: Project docs
- Added `CHANGELOG.md` (this file) and `AGENTS.md` (handoff notes for the next agent / Cursor). No game changes.

## 2026-10-01 17:01: `b7680db` Fullscreen, sideways-phone layout, display presets
- Fullscreen from the title screen, Settings, a HUD corner icon, the ` (backtick) key, or Start+Select on a controller. Android also locks to landscape.
- iPhone: web app manifest + home-screen icons (`app.webmanifest`, `icons/`), so Share → Add to Home Screen opens fullscreen and sideways. A one-time tip explains this.
- Sideways-phone HUD: respects notch / home-bar safe areas, 44px minimum touch targets, a 2-column menu, and dialogue choices in a row. Held upright, a "turn your phone" overlay appears with "Keep playing anyway".
- New `display.js` and Settings → Display: Auto / Phone (landscape) / 720p TV/PC / 1080p TV/PC / Retro 320x240, plus Aspect (Fit / 16:9 / 4:3) and Render scale 50-100%. Saved per device and applied instantly. The TV presets get a bigger HUD and controller-first prompts.
- Boss name tag moved below the top HUD row (it overlapped the HP/MP bars).
- Auto on desktop now renders at window resolution. Pick Retro for the old 320x240 look.

## 2026-10-01 15:18: `8a6032d` Controllers, keyboard/mouse, cameras, Target Lock
- New `input.js` input layer: Bluetooth/USB gamepads (Xbox / PlayStation / Switch Pro / standard mapping) with a radial dead zone, keyboard + mouse (WASD, drag orbit, wheel zoom, pointer-lock mouse look), and touch. On-screen prompts follow the last-used device.
- New `camrig.js`: Follow camera (default; swings in behind you and eases back after a nudge) and Free camera, toggled with C / R3 / the camera button.
- Zelda-64-style Target Lock: auto or manual (T / middle-click / LT), face and circle-strafe the target, letterbox bars, cycle or release.
- Pause menu Controls page (all three schemes) and Settings page (camera mode, sensitivity, invert Y, mouse look, auto lock), saved to localStorage.

## 2026-10-01 14:07: `6751fdf` Mobile fixes
- Floating thumbstick that appears where the thumb lands and follows the finger.
- No page scroll, pinch zoom or double-tap zoom while playing.
- The loading screen blocks input until the game is ready. Audio starts on the first tap (fixes the buzzing on mobile).
- No title-screen flash on load.

## 2026-10-01 13:46: `f90d410` Hide debug bar, fix page title
- The developer bar (scene picker, filter toggle, spell VFX link) only shows with `?debug=1`.
- Static page title.

## 2026-10-01 13:39: `345fcbb` Initial release
- First playable build generated by n64-suite (`n64 assemble --theme mushroom --seed 64`): the hub Mossunder, Toadstool Wood, Fizzwater Caverns, Mistcap Marsh and the Cold Forge, 8 hidden springs + the Mother Spring, Tansy the fox, the Krogbold Anvilbeard chase and boss fight, ring battles, spells, quests, map, save/continue and an ending.
- Third-party licenses (`THIRD_PARTY_LICENSES.md`, `LICENSES/`), `.nojekyll` for GitHub Pages.
