# AGENTS.md: Mossgnome (published build)

Handoff notes for the next agent. Cursor reads this file automatically. Keep it current, along with `CHANGELOG.md`, before every push.

- **Repo:** https://github.com/unclebill-spec/mossgnome (branch `main`; GitHub Pages serves `main` /, with `.nojekyll`)
- **Live:** https://unclebill-spec.github.io/mossgnome/
- **Local:** `/workspace/mossgnome-publish`

## Current state (2026-10-02)
- **2026-10-02 16:45:** added `starter/` (a minimal complete game on the shared runtime), `docs/N64_GRAPHICS_GUIDE.md` and `docs/GROK_BUILD_PROMPT.md`. The game itself is unchanged. The starter's source of truth is the suite (`n64/web/starter/`, `n64 new`). Re-publish it with `__KIT__` set to `../` and `__ICONS__` set to `../icons/` (see `n64/starter.py::render`).
- **The root runtime files are a public API now.** Outside builds (Grok build mode, other sites) import `common.js`, `input.js`, `camrig.js`, `display.js`, `minimap.js` and `lights/{glowkit,daynight,wisps}.js` from GitHub Pages. Keep their exports backward compatible, keep `vendor/three.module.js` at r160, and update the guide if an API changes.
- Playable and deployed. The latest change is **day and night** (`grovelights.js` + `lights/`): a time-of-day cycle with torches, glow-fish lanterns, wisps, fireflies and butterflies in Bill's "gloom and glow" palette (neon blue cold fire, violet, red), a glow at every spring, Settings > Time of day and Lighting, Pause > Rest, and an Auto quality guard. Before that came a fix for invisible friends: NPC models were never added to the scene, and now they are, with a stand-in gnome if a model fails to load. It also adds an orange goal dot on the minimap once you reach the quest goal. Before that came the HUD layout: a bottom button row with the clock, a half-size HP/MP plaque, fullscreen at the left edge, the minimap top-right with a red quest chevron, and Settings > Install app. Before that came the minimap and the higher look-up camera (`109829c`), and before that `b7680db` (fullscreen, sideways-phone layout, display presets). See `CHANGELOG.md`.
- **Inputs:** phone touch, gamepad and keyboard/mouse all work.
- **Cameras:** Follow (default) and Free, plus Target Lock.
- **Settings:** Display / Aspect / Render scale, Minimap, Quest hint arrow (both On by default), Time of day (Cycle / Always day / Always night), Lighting (Auto / Low / Medium / High), Install app (`display.install()`: the stashed `beforeinstallprompt` event, or step-by-step instructions for iOS, Android or desktop).
- **HUD layout** (the `#hud.mg` block at the end of `grove.css`):
  - `.mg-row` holds pause / hint / map / camera plus `.mg-timer`, along the bottom. On touch it sits between the stick zone (left 33.5cqh) and the action cluster, above `--sab`.
  - The buttons are `--rd`, at least 44px (`--tmin`). The row shows only when `#hud[data-mode]` is field or battle.
  - The fullscreen icon is at the left edge, with the vitals plaque after it (`--fsr`).
  - `.n64-mini` sits top-right (`--mmD` / `--mmR`), with the pearls and quest text to its left.
- **Night layer** (`grovelights.js`, `createNightLayer`, created before any model loads; `LIGHT.lit` is only set if it loaded):
  - `TOD` sets the cycle (1200 s per day, `nightShare` 0.55; new game 16.6, title 20.3, Rest 20.6 / 7.0). `NIGHT` sets the floors (k 0.40 desktop, 0.50 phones, `lift.BOSS` +0.06), the tint, the fog and the moon.
  - `GLOOM` / `PALETTE` hold Bill's neons; `LANTERN_MIX`, `SWARM_COLS` and `BF_COLS` do the weighting. `coldFire(torch)` swaps the flame sprites red and blue; `tintLantern` makes the cold-fire and red lanterns from the blue and magenta kit models.
  - `DENS[quality]` sets density and cull radius, with the glowkit `QUALITY` caps for lights and shadows. The Auto guard steps down after two slow 6 s windows, outside `?scene=` (or with `&guard=1`).
  - Springs get `springGlow` (halo, ground pool, pool light at priority 2.2, an inner glow for root tunnels and hollow logs). `state().level.springs` audits lantern, butterflies and glow per spring.
  - Skinned meshes don't cast torch shadows, except the gnome (`castsShadow`). Leave it that way: friends vanished after the cube shadow pass.
- **Last verification (2026-10-02, local, SwiftShader):** t_night 45/45 (its new springs-at-night check was added afterwards; the same per-spring audit passed for all 8 springs); t_npcs at noon and 10:30 PM all pass; t_hud 88/88; t_mapcam 59/60; mobiletest 80/80 unlit and 78/80 lit; t_display 94/95. All the misses are time-window checks that miss frames when lit rendering is slower in software GL: the jump sample at 120 ms passes 80/80 at 450 ms, the camera ease-back runs in a 3 s window, and the backtick fullscreen check (0.8 s) passes in 0.35 s alone. Before that, the live site passed 393 checks with 1 flaky failure.

## Where the code comes from
This repo is a **curated copy** of a generated project. Don't treat it as the source of truth for code.
1. **Suite** `/workspace/n64-suite`: generators, plus the shared web runtime in `n64/web/rpg/` (`common.js`, `input.js`, `camrig.js`, `display.js`, `grove.js`, `grove.css`, `rpg.js`, `rpg.css`, `springfx.js`, `vfx.js`, `index.html`). Edit code **there first**.
2. **Generated project** `/workspace/n64-projects/mossgnome-64`, built by `n64 assemble --theme mushroom --seed 64` (seed-deterministic). It includes extras that are not published: the asset browser, the classic demo, `text/`, `.mid`, `.obj`, CI4 textures, heightmaps.
3. **This repo:** the runtime subset of the project, plus `LICENSES/`, `THIRD_PARTY_LICENSES.md`, `.nojekyll`, and a player-facing `README.md`. `index.html` is the assembled one with the "Asset browser" link removed from the debug bar.

To ship a code change, copy the changed files from `n64-suite/n64/web/rpg/` into both the project and this repo. Asset changes need a fresh `n64 assemble` followed by a copy of the affected runtime files. Don't copy `browser.*`, `classic.html`, `game.js`/`field.js`/`fp.js`/`trek.js`, `text/`, `*.mid`, `*.obj`/`*.mtl`, `*.ci4`/`*.tlut` or heightmaps.

## File layout
| path | what |
|---|---|
| `index.html` | entry page: import map for three.js, loading screen, touch/zoom guards, PWA meta tags |
| `grove.js`, `grove.css` | the Mossgnome game: world, HUD, menus, title, quests, battles, springs, ending |
| `common.js` | shared stage/HUD helpers (`place`/`placeCircle` in cqh units with safe-area vars); lit-mode materials (`LIGHT`, `litMaterial`, `setAmbient`, `ensureNormals`, `castsShadow`) |
| `grovelights.js` | day/night cycle + glow lights for the game (palette, placement per level, fades, culling, quality, Auto guard) |
| `lights/` | glow kit runtime (`glowkit.js`, `torches.js`, `lanterns.js`, `wisps.js`, `butterflies.js`, `daynight.js`), models, sprites, presets (from the suite's `glowlights.pack(..., demo=False)`) |
| `input.js` | input layer: gamepad / keyboard+mouse / touch, `I.last` device, Start+Select → Fullscreen |
| `camrig.js` | Follow / Free camera, Target Lock, pitch limits (`PITCH`) and the look-up helper `lookUp()` (sinks, slides in and tilts up; ground and line-of-sight safe) |
| `minimap.js` | corner minimap (`createMinimap`, default top-right, red chevron via `arrowColor`; orange goal dot via `goalColor` once you are within `near` of the goal, `M.goal`), terrain bake from level data (`bakeMap`), and the quest heading (`questHeading`: in-level target or the portal/exit toward it) |
| `display.js` | stage sizing, resolution presets, aspect, render scale, fullscreen, rotate overlay, iPhone tip, Install app (`installState` / `install` / `installSteps`) |
| `sw.js` | tiny network-first service worker (offline copy of the small text files; needed for Chrome's install prompt); registered from `index.html` on https only |
| `rpg.js`, `rpg.css`, `springfx.js`, `vfx.js`, `vfx.html` | shared RPG runtime, spring effects, spell VFX (`vfx.html` is the debug page) |
| `app.webmanifest`, `icons/` | web app manifest (fullscreen, landscape) and home-screen icons |
| `manifest.json` | the **game** manifest from the suite (not the PWA manifest) |
| `systems/game.json` | quests (each with a `target` list for the minimap chevron), dialogue, hints, items, ending |
| `models/` `textures/` `sprites/` `skybox/` `music/` `sfx/` `fonts/` `ui/` `world/` `systems/` | generated assets (GLB, PNG, WAV, level JSON, spells/springs data) |
| `vendor/` | three.js r160 + addons |
| `starter/` | minimal complete game (`index.html`, `starter.js`, `sw.js`, `app.webmanifest`); imports the runtime via the `kit/` import map (`../`) |
| `docs/` | `N64_GRAPHICS_GUIDE.md` (the guide) and `GROK_BUILD_PROMPT.md` (paste-in prompt); masters live in the suite's `docs/` |
| `preview/` | model sheets and `shots/` screenshots (used in the README) |

Useful URL flags: `?debug=1` (dev bar), `?hour=22.5` / `?tod=night` / `?cycle=1` (scenes otherwise start at noon, clock stopped), `?lightq=low|medium|high`, `?nolights=1`, `&guard=1`, `?scene=title|hub|spring|battle|boss_battle|map|pause|ending…&autostart=1`, `&noenc=1`, `?safearea=t,r,b,l` (simulate a notch).

## Run locally
```bash
mkdir -p /tmp/pagesroot && ln -sfn /workspace/mossgnome-publish /tmp/pagesroot/mossgnome
python3 -m http.server 8091 -d /tmp/pagesroot      # http://127.0.0.1:8091/mossgnome/  (same /mossgnome/ path as Pages)
```

## Deploy (GitHub Pages)
1. `git pull --ff-only origin main`
2. Update `CHANGELOG.md` and this file.
3. `git add -A && python3 /workspace/scratch/sec/scan.py staged`
4. Commit with a descriptive message, as `unclebill-spec` / `unclebill-spec@users.noreply.github.com`:
   `git -c user.name=unclebill-spec -c user.email=unclebill-spec@users.noreply.github.com commit -m "…"`
5. `python3 /workspace/scratch/sec/scan.py commit HEAD`. Abort on any hit.
6. `git push origin main`, once and only with Bill's approval. Auth comes from the `gh` credential helper; never put a token in the URL or config.
7. Watch the build: `gh api repos/unclebill-spec/mossgnome/pages/builds/latest --jq '.commit[0:7]+" "+.status'` until it says `built` (about 1 min).
8. Check that the CDN serves the new files: `curl -s "https://unclebill-spec.github.io/mossgnome/grove.js?cb=$RANDOM" | sha1sum` should equal `sha1sum grove.js`.

## Tests
All tests are headless Playwright (Chromium + SwiftShader) and live in the suite: `/workspace/n64-suite/tests/input/` (see its README).
- **Against this repo locally:** `python3 /tmp/runpub.py t_display.py`. `t_night.py` covers day/night (settings, light levels, readability, palette, every spring at night, Auto guard, fallback). `t_npcs.py` checks (at noon and at 10:30 PM) that every friend is really on screen (in every level, using `__debug.npcCheck(id)`, which renders the frame with and without them) and the minimap goal dot. `t_hud.py` covers the HUD layout (bottom row, corners, Install app) on phones, desktop, TV and Retro, with screenshots in `/workspace/scratch/hud2/shots`. `t_mapcam.py` covers the minimap, quest chevron, settings, presets and the camera look-up on desktop and three phones; its screenshots go to `/workspace/scratch/mm/shots`. It serves `/tmp/pagesroot`; `t_pad.py`, `t_pad2.py`, `t_kbm.py` and `t_touch.py` work the same way.
- **Against the live site:** pass the URL, e.g. `python3 t_pad.py https://unclebill-spec.github.io/mossgnome/`.
- **Full run:** `bash /workspace/scratch/disp/runall.sh https://unclebill-spec.github.io/mossgnome/ live` (about 15 min). Results go to `/workspace/scratch/disp/all_live.log`. Expect `FAILS: []` in each section.
- **Starter:** `python3 /workspace/n64-suite/tests/input/t_starter.py http://127.0.0.1:PORT/mossgnome/starter/` (or the live URL). Expect `0 failure(s)`. Screenshots go to `/workspace/scratch/starter-shots/`.
- **Scratch tests:** `/workspace/scratch/mobiletest.py`, `pubtest.py` and `pubtest2.py` (smoke tests of every scene).
- **Screenshot sheets** from the display tests: `/workspace/scratch/disp/sheets/`.

## Bill's standing preferences
**Working rules (every project Bill owns)**
- Keep `CHANGELOG.md` (dated entries) and `AGENTS.md` (this file) current before every commit or push. Write clear, descriptive commit messages so any revision can be rolled back.
- When resuming work, pull first (`git pull --ff-only`) if the repo has a remote. Read this file before changing anything.
- **Secret scan before any push:** scan the staged files and the full commit for GitHub tokens (`gh*_`, `github_pat_`), API keys, private keys, passwords, `.env`, gh `hosts.yml`, credentials, `.npmrc` and `.netrc`. If anything turns up, abort and report it. Never put a token in a remote URL or git config. The scanner is `python3 /workspace/scratch/sec/scan.py staged | commit HEAD | history | tree`, run from the repo root.
- Get explicit approval for each push. Keep replies brief.
- Don't touch other bots' projects (e.g. `/workspace/gravewake`). Copy what you need into `n64/vendor/`.

**Game direction (Mossgnome)**
- Storybook tone like *David the Gnome*, with red-cap toadstools, mushrooms, gnomes and hidden bubbly springs.
- No eye patch and no soccer ball on anyone.
- The big red-bearded figure is the **dwarf Krogbold Anvilbeard**, not a lumberjack.
- Portals and rifts take their look from Bill's refs in `/workspace/gravewake/style/rift_refs`. These are for study only: read them, never modify them, and never ship them.
- **"Gloom and glow" is Bill's favourite look:** dark environments full of glowing objects. His signature glow colours, in order: **neon blue cold fire** (top favourite), **violet neon**, **red neon**. Keep it playable and readable on phones.
- Original content only: no Nintendo or other games' names, assets, text or melodies. The suite's originality test enforces this.

**How Bill plays (all must keep working)**
- **Phone touch:** a floating joystick that appears under the thumb and follows the finger; no page scroll or zoom; input blocked while loading.
- **Phone + Bluetooth controller.**
- **PC:** WASD + mouse.
- **Cameras:** Follow camera by default, plus a Free camera and Zelda-64-style Target Lock.
- **Display:** fullscreen; a sideways-phone layout with a rotate prompt when held upright; display presets Auto / Phone / 720p / 1080p / Retro 320x240; aspect options Fit / 16:9 / 4:3.

## Known issues
- Phones were only tested **emulated** (headless Chromium device profiles; safe areas simulated via `?safearea`). Real iOS Safari and Android Chrome haven't been checked.
- Some browsers block fullscreen when it starts from a gamepad button (Start+Select). The game shows a toast saying to use the corner button instead.
- iPhone Safari can't make a page fullscreen, so true fullscreen there needs Share → Add to Home Screen. Settings > Install app shows those steps.
- **Install prompt:** Chrome only fires `beforeinstallprompt` once its engagement checks pass (and never in Firefox or Safari). Until then the Install app row shows the steps instead. iOS has no prompt API, so it always shows steps.
- **Service worker:** `sw.js` is network-first, so a deploy shows up on the next load when online. If something seems stale, a hard reload or clearing site data resets it.
- `t_pad2.py` "X swings a hat bonk" is flaky right after a spell cast (it failed once live and passed twice on rerun).
- Keep-playing-upright mode uses the original 4:3 proportions without the 44px touch-target floor.
- Already-open tabs need a reload after a deploy.
- **Minimap chevron:** it points straight at the in-level target (smoothed), not along paths, so around cliffs or water you may need to find the way. Only the current quest step is used.
- **Full look-up:** the gnome's feet drop below the bottom of the frame; this is intentional, to see the canopy. The camera can still poke into tree trunks or houses, as before.

- **Night lighting** performance was only measured in software GL (SwiftShader) and on emulated phones. The Auto guard steps quality down if a real device is slow.
- At the two far path ends of the village (x ±27.5, z -12) the camera ends up inside a giant tree trunk, by day too.
- t_kbm "left click bonks" is a sampling race like the hat-bonk one; it passes on rerun.

## Next steps (suggested)
1. Have Bill test on his real phone (touch and Bluetooth controller) and on Add to Home Screen. Fix whatever differs from emulation.
2. De-flake the hat-bonk test (wait out the cast cooldown before pressing X).
3. Add a small sync script (suite → project → this repo) so the copy step isn't manual.
4. Optional: an offline service worker for the home-screen app, and a performance pass for low-end phones (the Render scale default).
5. Minimap ideas, if Bill wants them: a zoom toggle, or a rotate-with-camera option. Keep the chevron vague.
