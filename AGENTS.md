# AGENTS.md: Mossgnome (published build)

Handoff notes for the next agent. Cursor reads this file automatically. Keep it current, along with `CHANGELOG.md`, before every push.

- **Repo:** https://github.com/unclebill-spec/mossgnome (branch `main`; GitHub Pages serves `main` /, with `.nojekyll`)
- **Live:** https://unclebill-spec.github.io/mossgnome/
- **Local:** `/workspace/mossgnome-publish`

## Current state (2026-10-01)
- Playable and deployed. The latest features are the corner minimap with a faint quest-heading chevron, and a higher look-up camera. Before that came `b7680db` (fullscreen, sideways-phone layout, display presets). See `CHANGELOG.md`.
- **Inputs:** phone touch, gamepad and keyboard/mouse all work.
- **Cameras:** Follow (default) and Free, plus Target Lock.
- **Settings:** Display / Aspect / Render scale, Minimap, Quest hint arrow (both On by default).
- **Last verification:** on the live site, 393 checks passed and 1 flaky check failed (see Known issues).

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
| `common.js` | shared stage/HUD helpers (`place`/`placeCircle` in cqh units with safe-area vars) |
| `input.js` | input layer: gamepad / keyboard+mouse / touch, `I.last` device, Start+Select → Fullscreen |
| `camrig.js` | Follow / Free camera, Target Lock, pitch limits (`PITCH`) and the look-up helper `lookUp()` (sinks, slides in and tilts up; ground and line-of-sight safe) |
| `minimap.js` | corner minimap (`createMinimap`), terrain bake from level data (`bakeMap`), and the quest heading (`questHeading`: in-level target or the portal/exit toward it) |
| `display.js` | stage sizing, resolution presets, aspect, render scale, fullscreen, rotate overlay, iPhone tip |
| `rpg.js`, `rpg.css`, `springfx.js`, `vfx.js`, `vfx.html` | shared RPG runtime, spring effects, spell VFX (`vfx.html` is the debug page) |
| `app.webmanifest`, `icons/` | web app manifest (fullscreen, landscape) and home-screen icons |
| `manifest.json` | the **game** manifest from the suite (not the PWA manifest) |
| `systems/game.json` | quests (each with a `target` list for the minimap chevron), dialogue, hints, items, ending |
| `models/` `textures/` `sprites/` `skybox/` `music/` `sfx/` `fonts/` `ui/` `world/` `systems/` | generated assets (GLB, PNG, WAV, level JSON, spells/springs data) |
| `vendor/` | three.js r160 + addons |
| `preview/` | model sheets and `shots/` screenshots (used in the README) |

Useful URL flags: `?debug=1` (dev bar), `?scene=title|hub|spring|battle|boss_battle|map|pause|ending…&autostart=1`, `&noenc=1`, `?safearea=t,r,b,l` (simulate a notch).

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
- **Against this repo locally:** `python3 /tmp/runpub.py t_display.py`. `t_mapcam.py` covers the minimap, quest chevron, settings, presets and the camera look-up on desktop and three phones; its screenshots go to `/workspace/scratch/mm/shots`. It serves `/tmp/pagesroot`; `t_pad.py`, `t_pad2.py`, `t_kbm.py` and `t_touch.py` work the same way.
- **Against the live site:** pass the URL, e.g. `python3 t_pad.py https://unclebill-spec.github.io/mossgnome/`.
- **Full run:** `bash /workspace/scratch/disp/runall.sh https://unclebill-spec.github.io/mossgnome/ live` (about 15 min). Results go to `/workspace/scratch/disp/all_live.log`. Expect `FAILS: []` in each section.
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
- iPhone Safari can't make a page fullscreen, so true fullscreen there needs Share → Add to Home Screen.
- `t_pad2.py` "X swings a hat bonk" is flaky right after a spell cast (it failed once live and passed twice on rerun).
- Keep-playing-upright mode uses the original 4:3 proportions without the 44px touch-target floor.
- Already-open tabs need a reload after a deploy.
- **Minimap chevron:** it points straight at the in-level target (smoothed), not along paths, so around cliffs or water you may need to find the way. Only the current quest step is used.
- **Full look-up:** the gnome's feet drop below the bottom of the frame; this is intentional, to see the canopy. The camera can still poke into tree trunks or houses, as before.

## Next steps (suggested)
1. Have Bill test on his real phone (touch and Bluetooth controller) and on Add to Home Screen. Fix whatever differs from emulation.
2. De-flake the hat-bonk test (wait out the cast cooldown before pressing X).
3. Add a small sync script (suite → project → this repo) so the copy step isn't manual.
4. Optional: an offline service worker for the home-screen app, and a performance pass for low-end phones (the Render scale default).
5. Minimap ideas, if Bill wants them: a zoom toggle, or a rotate-with-camera option. Keep the chevron vague.
