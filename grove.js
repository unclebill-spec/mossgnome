// "mossgnome" demo: a cozy gnome grove. Hub village (treehouses, rope bridges, rainbow cap + rope swing, root-arch portals, spore ring),
// three regions + the dwarf's cold forge, HIDDEN BUBBLY SPRINGS (waterfall / cave / root tunnel / hollow log), ride-able fox,
// multi-line dialogue trees with choices, ring-arena battles vs mushroom critters, the dwarf chase + boss + reconciliation, save/load.
import { THREE, Q, $, J, clamp, lerp, rng, makeRenderer, tex, load, animate, mixers, setAmbient, terrain, pathStrip, sfx, Music, place, placeCircle, div,
  floatText, keys, takePressed, loop, canvasTex, puffTex, bubbleTex, reg, font, loaded } from './common.js';
import { makeVFX } from './vfx.js';
import { makeSpringPool } from './springfx.js';
import { createInput } from './input.js';
import { createDisplay, RES, ASPECTS } from './display.js';
import { followYaw, lockFrame, strafe, pickTarget, wrapA, PITCH, clampPitch, upAmount, lookUp } from './camrig.js';
import { createMinimap, questHeading, bakeMap } from './minimap.js';

const P3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const SOLID = { toadstool_red: 0.55, toadstool_blue: 0.5, toadstool_purple: 0.5, rainbow_cap: 0.9, giant_trunk: 1.7, treehouse: 1.9, mushroom_house: 2.2, root_house: 2.4,
  mossy_stone: 0.9, wet_rock: 1.0, shelf_stump: 0.8, glowcap: 0.25, crystal_cap: 0.45, anvil_stump: 0.8, forge: 1.9, dead_snag: 0.45, lantern_cap: 0.3, puffball: 0.5 };
const FAM_COL = { mushroom: '#d6322a', spore: '#e8d070', water: '#3fb8e8', glow: '#ffe060' };
const FAM_SFX = { mushroom: 'hit_mushroom', spore: 'hit_spore', water: 'hit_water', glow: 'hit_glow' };
const F0 = ['has_map', 'spring1', 'met_fox', 'rode_fox'];
const F1 = [...F0, 'met_forager', 'spring2', 'spring3', 'forest_done'];
const F2 = [...F1, 'spring4', 'spring5', 'met_lamp', 'caverns_done'];
const F3 = [...F2, 'spring7', 'chase_escaped', 'elder_ring'];
const SCENE_FLAGS = { hub: [], dialogue: [], swing: ['has_map'], ride: ['has_map', 'met_fox'], portal: [...F2, 'chase_escaped', 'elder_ring'],
  forest: F0, map: [...F0, 'met_forager'], spring: [...F0, 'met_forager'], battle: [...F0, 'met_forager'], pause: [...F0, 'met_forager'],
  caverns: F1, marsh: F2, chase: [...F2, 'spring7'], boss: F3, boss_battle: F3, ending: [...F3, 'boss_beaten', 'reconciled'] };
const SCENE_LEVEL = { hub: 'HUB', dialogue: 'HUB', swing: 'HUB', portal: 'HUB', ride: 'HUB', forest: 'L1', map: 'L1', spring: 'L1', battle: 'L1', pause: 'L1',
  caverns: 'L2', marsh: 'L3', chase: 'L3', boss: 'BOSS', boss_battle: 'BOSS', ending: 'BOSS', title: 'HUB' };
let G = null;

export async function start(man) {
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'grove.css'; document.head.appendChild(link);
  $('title').classList.add('hide'); document.title = man.game.title;
  await Promise.all([font('Lilita', 'LilitaOne-Regular.ttf'), font('Luckiest', 'LuckiestGuy-Regular.ttf')]);
  const [game, springs, spells, layout, portalsS] = await Promise.all([J('systems/game.json'), J('systems/springs.json'), J('systems/spells.json'), J(man.hud.layout), J('sprites/portals/portals_sprites.json')]);
  const levelsMeta = man.world.levels;
  const LV = {};
  await Promise.all(levelsMeta.map(async (l) => { LV[l.id] = await J(l.level_json); }));
  const spellById = Object.fromEntries(spells.spells.map((s) => [s.id, s]));
  const springById = Object.fromEntries(springs.springs.map((s) => [s.id, s]));
  const SAVE_KEY = game.title.save_key;
  $('help').textContent = 'WASD/arrows or drag the joystick: waddle · Space jump · E talk / use · R ride the fox · H hint · M map · P pause · Z/C or mouse-drag: camera · battle: 1-6 spells, F/Space hat bonk, leave the ring to run away';
  for (const l of levelsMeta) { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; $('sceneSel').appendChild(o); }
  for (const s of ['title', 'spring', 'battle', 'dialogue', 'chase', 'swing', 'ride', 'portal', 'map', 'pause', 'boss_battle', 'ending']) { const o = document.createElement('option'); o.value = 'scene:' + s; o.textContent = `[${s}]`; $('sceneSel').appendChild(o); }
  $('sceneSel').onchange = (e) => { const v = e.target.value; const sc = v.startsWith('scene:') ? v.slice(6) : ({ HUB: 'hub', L1: 'forest', L2: 'caverns', L3: 'marsh', BOSS: 'boss' }[v]); location.search = `?scene=${sc}&autostart=1`; };

  // ---------- renderer / scene
  const renderer = makeRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 4 / 3, 0.2, 400);
  // shared display layer: resolution preset, aspect, render scale, fullscreen, safe areas; applies instantly (resize / setting change)
  const display = createDisplay({ renderer, cameras: () => [camera], storageKey: `${SAVE_KEY}.display`, title: man.game.title, onChange: () => { if (G && G.mode === 'menu') drawMenu(); if (G) refreshGlyphs(); }, onToast: (m) => toast(m, 2600) });
  const skyT = tex(man.skybox.panorama, false); skyT.mapping = THREE.EquirectangularReflectionMapping;
  let world = new THREE.Group(); scene.add(world);
  const R = rng(man.game.seed * 13 + 5);

  // ---------- canvas-drawn sprite textures
  const glowT = canvasTex(32, 32, (g) => { const gr = g.createRadialGradient(16, 16, 1, 16, 16, 15); gr.addColorStop(0, 'rgba(255,255,220,1)'); gr.addColorStop(0.3, 'rgba(255,240,140,0.8)'); gr.addColorStop(1, 'rgba(255,220,80,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); });
  const sporeT = canvasTex(16, 16, (g) => { const gr = g.createRadialGradient(8, 8, 0, 8, 8, 7); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 16, 16); });
  const sparkT = canvasTex(32, 32, (g) => { g.fillStyle = '#fff'; g.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 ? 4 : 15; g.lineTo(16 + Math.cos(a) * rr, 16 + Math.sin(a) * rr); } g.fill(); });
  const steamT = puffTex(), bubT = bubbleTex(), puffT = puffTex();
  const markT = (ch, col) => canvasTex(32, 32, (g) => { g.fillStyle = col; g.beginPath(); g.arc(16, 16, 13, 0, 7); g.fill(); g.strokeStyle = '#4a2a14'; g.lineWidth = 3; g.stroke(); g.fillStyle = '#4a2a14'; g.font = 'bold 20px Lilita, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 16, 17); });
  const bangT = markT('!', '#ffe060'), askT = markT('?', '#bff4ff');
  const labelT = (text) => canvasTex(256, 48, (c) => { c.font = '28px Lilita, sans-serif'; c.textAlign = 'center'; c.lineWidth = 6; c.strokeStyle = '#4a2a14'; c.strokeText(text, 128, 34); c.fillStyle = '#fff8e8'; c.fillText(text, 128, 34); });
  function stripTex(name) { const st = portalsS.strips[name]; const t = tex(st.file, false).clone(); t.needsUpdate = true; t.repeat.set(1 / portalsS.frames, 1); t.wrapS = THREE.RepeatWrapping; return t; }

  // ---------- persistent actors (survive level changes)
  const player = await load('models/player.glb'); const pA = animate(player); scene.add(player);
  const fox = await load('models/fox.glb'); const fA = animate(fox); fox.scale.setScalar(1.15); scene.add(fox);
  const dwarf = await load('models/boss.glb'); const dA = animate(dwarf); dwarf.scale.setScalar(1.35); dwarf.visible = false; scene.add(dwarf);
  const keepMixers = [pA, fA, dA].filter(Boolean).map((a) => a.mixer);

  // ---------- state + save (localStorage)
  const fresh = () => ({ flags: {}, springs: {}, revealed: {}, spells: [...game.spellbook.start], items: [], hp: game.start_stats.hp, maxHp: game.start_stats.hp,
    mp: game.start_stats.mp, maxMp: game.start_stats.mp, xp: 0, lv: 1, level: 'HUB', pos: null, time: 0, talked: {}, chests: {} });
  let S = fresh();
  const hasSave = () => { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } };
  function save(quiet) { S.pos = [player.position.x, player.position.y, player.position.z]; try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* private mode */ } if (!quiet) { sfx('save_chime', 0.5); toast('Saved!'); } }
  function loadSave() { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); if (d) { S = { ...fresh(), ...d }; return true; } } catch (e) { /* bad save */ } return false; }
  const nSprings = () => Object.keys(S.springs).length;

  // ---------- HUD (mossy_round skin; rects/circles from layout.json)
  const hud = $('hud'); hud.classList.add('mg');
  const U = 'ui/mossy_round/';
  const injected = [];
  const press = (code) => injected.push(code);
  const COL = (i) => (i === undefined ? '0px' : `calc(var(--col0, 30px) + ${i} * var(--colgap, 54px))`);  // left column (pause / hint / map / camera): min spacing for 48px targets
  const btn = (nm, c, onClick, col) => { const b = placeCircle(div('mg-btn', hud, `<img src="${U}btn_${nm}.png"><i>${layout.buttons[nm]}</i>`), c, COL(col)); b.dataset.nm = nm; b.onpointerdown = (e) => { e.stopPropagation(); onClick(); }; return b; };
  const vit = place(div('mg-vitals', hud, `<img class="ic" src="${U}ic_mushroom.png"><div class="bar hp"><i></i></div><b class="hpn"></b><img class="ic" src="${U}ic_bubble.png"><div class="bar mp"><i></i></div><b class="mpn"></b>`), layout.rects.vitals);
  layout.rects.timer = [0.695, 0.025, 0.88, 0.105]; layout.rects.pearls = [0.705, 0.115, 0.88, 0.185];  // room for the fullscreen corner icon
  const timerEl = place(div('mg-timer', hud, `<img src="${U}ic_clock.png"><span>00:00</span>`), layout.rects.timer);
  const pearlEl = place(div('mg-pearls', hud, `<img src="${U}ic_pearl.png"><span></span>`), layout.rects.pearls);
  { const f = layout.rects.foe; layout.rects.foe = [f[0], 0.15, f[2], 0.15 + f[3] - f[1]]; }  // foe tag sits under the top HUD row (no overlap with vitals / timer)
  const foeEl = place(div('mg-foe hide', hud), layout.rects.foe);
  const spellBar = place(div('mg-spells hide', hud), layout.rects.spells);
  const toastEl = place(div('mg-toast hide', hud), layout.rects.toast);
  const questEl = div('mg-quest', hud);
  const promptEl = div('mg-prompt hide', hud);
  const joy = placeCircle(div('mg-joy', hud, `<img src="${U}joy_ring.png"><img class="knob" src="${U}joy_knob.png">`), layout.circles.joy);
  const fieldBtns = [btn('act', layout.circles.act, () => press('KeyE')), btn('jump', layout.circles.jump, () => press('Space')), btn('ride', layout.circles.ride, () => press('KeyR')),
    btn('cast', layout.circles.cast, () => press('CastSel')), btn('bonk', layout.circles.bonk, () => press('KeyF'))];
  btn('pause', layout.circles.pause, () => press('KeyP'), 0); btn('hint', layout.circles.hint, () => press('KeyH'), 1); btn('map', layout.circles.map, () => press('KeyM'), 2);
  const dlgEl = place(div('mg-dialog hide', hud, '<img class="por"><div class="who"></div><div class="txt"></div><div class="opts"></div><div class="more">&#9660;</div>'), layout.rects.dialogue);
  const menuEl = place(div('mg-menu hide', hud), layout.rects.menu);
  const mapEl = div('mg-map hide', hud, '<div class="ttl"></div><canvas width="256" height="256"></canvas><div class="leg"></div>');
  const titleEl = div('mg-title hide', hud);
  const endEl = div('mg-ending hide', hud);
  const fadeEl = div('mg-fade', hud);
  // Target Lock + camera-mode buttons (touch), letterbox bars and the bouncing lock reticle
  const tbtn = (nm, svg, c, code, col) => { const b = placeCircle(div('mg-btn mg-tb', hud, `<span>${svg}</span><i></i>`), c, COL(col)); b.dataset.nm = nm; b.onpointerdown = (e) => { e.stopPropagation(); press(code); }; return b; };
  fieldBtns.push(tbtn('lock', '<svg viewBox="-12 -12 24 24"><circle r="7.5"/><path d="M0 -11v6M0 11v-6M-11 0h6M11 0h-6"/><circle r="1.6" class="f"/></svg>', [0.915, 0.475, 0.044], 'LockOn'),
    tbtn('cam', '<svg viewBox="-12 -12 24 24"><rect x="-9" y="-5.5" width="14" height="11" rx="2.5"/><path d="M5 -2.5l5 -3v11l-5 -3z" class="f"/></svg>', [0.06, 0.41, 0.042], 'CamToggle', 3));
  for (const b of fieldBtns) b.classList.add('touch-only');
  const FS_ICO = '<svg class="ico" viewBox="-12 -12 24 24"><path d="M-9 -3v-6h6M3 -9h6v6M9 3v6h-6M-3 9h-6v-6"/></svg>';
  const fsBtn = placeCircle(div('mg-btn mg-tb mg-fs', hud, `<span>${'<svg viewBox="-12 -12 24 24" class="fs-in"><path d="M-9 -3v-6h6M3 -9h6v6M9 3v6h-6M-3 9h-6v-6"/></svg><svg viewBox="-12 -12 24 24" class="fs-out"><path d="M-9 -3h6v-6M3 -9v6h6M9 3h-6v6M-3 9v-6h-6"/></svg>'}</span><i></i>`), [0.03, 0.068, 0.032]); fsBtn.dataset.nm = 'fs';  // left edge, top
  // one row across the bottom (pause / hint / map / camera + the clock), centred between the thumbstick and the action buttons (grove.css .mg-row)
  const rowEl = div('mg-row', hud);
  for (const nm of ['pause', 'hint', 'map', 'cam']) { const b = hud.querySelector(`.mg-btn[data-nm=${nm}]`); if (b) rowEl.appendChild(b); }
  rowEl.appendChild(timerEl);
  // fullscreen needs a click (a user gesture on touch too), armed by a pointerdown on the same element so a tap that just opened / closed a panel can't fall through
  const armClick = (el, fn) => { el.onpointerdown = (e) => { e.stopPropagation(); el.armed = true; }; el.onclick = (e) => { e.stopPropagation(); if (!el.armed) return; el.armed = false; fn(); }; };
  armClick(fsBtn, () => display.toggleFS());
  const lbTop = div('mg-lb top'), lbBot = div('mg-lb bot'); hud.prepend(lbBot); hud.prepend(lbTop);
  const reticle = div('mg-reticle hide', hud, '<svg viewBox="-16 -16 32 40"><path d="M-9 2 L0 16 L9 2 L0 7 Z"/><path d="M-12 -6 L0 -14 L12 -6" class="o"/></svg>');
  // shared input layer (controllers + keyboard/mouse + touch); prompts and badges follow whichever device was used last
  const input = createInput({ storageKey: `${SAVE_KEY}.settings`, stickKeys: false, canvas: $('view'), binds: { LT: 'LockOn', R3: 'CamToggle', UP: 'PadUp', DOWN: 'PadDown', LEFT: 'PadLeft', RIGHT: 'PadRight' }, onToast: (m) => toast(m, 2000), onScheme: () => refreshGlyphs() });
  const GL = { use: ['E', 'Y'], jump: ['Space', 'A'], back: ['Esc', 'B'], attack: ['F', 'X'], ride: ['R', 'D-pad down'], lock: ['T', 'LT'], camera: ['C', 'R3'], map: ['M', 'SELECT'], pause: ['Esc', 'START'], confirm: ['Enter', 'A'],
    cast: ['Enter', 'RT'], prev: ['Q', 'LB'], next: ['R', 'RB'], hint: ['H', 'D-pad up'], move: ['WASD', 'LS'], cam: ['Mouse', 'RS'], walk: ['Shift', 'L3'] };
  const BTN_ACT = { act: 'use', jump: 'jump', ride: 'ride', cast: 'cast', bonk: 'attack', pause: 'pause', hint: 'hint', map: 'map', lock: 'lock', cam: 'camera' };
  const padFirst = () => input.scheme === 'pad' || (display.tv && input.last !== 'key' && input.last !== 'touch');  // TV presets: controller-first prompts
  const gk = (a) => (padFirst() ? input.glyph(GL[a][1]) : GL[a][0]);
  const gl = (a) => (input.scheme === 'touch' && !padFirst() ? '' : `<b class="gl ${padFirst() ? 'pad' : input.scheme}">${gk(a)}</b>`);
  const tapOr = (a) => (input.scheme === 'touch' ? 'tap' : gk(a));
  function refreshGlyphs() {
    for (const b of hud.querySelectorAll('.mg-btn')) { const a = BTN_ACT[b.dataset.nm], i = b.querySelector('i'); if (a && i) i.textContent = gk(a); }
    if (!G) return; if (G.mode === 'title') drawTitleFoot(); if (G.mode === 'battle' && B) buildSpellBar(); if (G.mode === 'menu') drawMenu();
    if (G.mode === 'intro' || G.mode === 'ending') { const f = endEl.querySelector('.foot'); if (f) f.innerHTML = f.innerHTML.replace(/^&#9660;.*|^▼.*/, `&#9660; ${tapOr('confirm')}`); }
    if (G.mode === 'dialog') drawOpt();
  }
  refreshGlyphs();
  // floating thumbstick: a touch anywhere in the left third of the screen (or on the ring) re-centres the stick under the finger.
  // Tracked by pointerId, so it keeps steering when the finger slides off the ring and works alongside button / camera fingers.
  let joyV = null, joyT = null, joyId = null, joyC = null;
  const knob = joy.querySelector('.knob'), joyHome = { left: joy.style.left, top: joy.style.top }, JOY_DEAD = 0.08;
  function joyStart(e, float) {
    joyId = e.pointerId; const st = $('stage').getBoundingClientRect(), r = joy.getBoundingClientRect();
    if (float) { joy.style.left = `${(e.clientX - st.left) / st.width * 100}%`; joy.style.top = `${(e.clientY - st.top) / st.height * 100}%`; joyC = { x: e.clientX, y: e.clientY }; }  // left/top = ring centre
    else joyC = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    joy.classList.add('on'); try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ }
    joyMove(e);
  }
  function joyMove(e) {
    const R = joy.getBoundingClientRect().width * 0.6;  // full throw (px), a bit beyond the ring
    let x = (e.clientX - joyC.x) / R, y = (e.clientY - joyC.y) / R; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    const m = Math.min(1, l), k = m < JOY_DEAD ? 0 : (m - JOY_DEAD) / (1 - JOY_DEAD) / m;  // dead zone, then a linear ramp to full speed
    joyT = { x: x * k, y: y * k }; knob.style.transform = `translate(${x * 80}%, ${y * 80}%)`;
  }
  function joyEnd() { joyId = null; joyT = null; knob.style.transform = ''; joy.classList.remove('on'); joy.style.left = joyHome.left; joy.style.top = joyHome.top; }
  function joySmooth(dt) {  // smooth analog output (eases toward the finger, glides to rest on release)
    if (!joyV) { if (!joyT) return; joyV = { x: 0, y: 0 }; }
    const tx = joyT ? joyT.x : 0, ty = joyT ? joyT.y : 0, f = 1 - Math.exp(-dt * 20); joyV.x += (tx - joyV.x) * f; joyV.y += (ty - joyV.y) * f;
    if (!joyT && Math.hypot(joyV.x, joyV.y) < 0.03) joyV = null;
  }
  joy.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); if (joyId === null) joyStart(e, e.pointerType !== 'mouse'); });
  addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
  for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, (e) => { if (e.pointerId === joyId) joyEnd(); });
  function hudUpdate() {
    vit.querySelector('.hp i').style.width = `${100 * S.hp / S.maxHp}%`; vit.querySelector('.hpn').textContent = `${S.hp}`;
    vit.querySelector('.mp i').style.width = `${100 * S.mp / S.maxMp}%`; vit.querySelector('.mpn').textContent = `${S.mp}`;
    pearlEl.querySelector('span').textContent = `Springs ${nSprings()}/${springs.springs.length}`;
    const q = currentQuest(); questEl.innerHTML = q ? `<b>${q.title}</b><br>${q.goal}` : '<b>The End</b><br>Thank you for playing!';
  }
  let toastT = null;
  function toast(text, ms = 2200) { toastEl.innerHTML = text; toastEl.classList.remove('hide'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.add('hide'), ms); }

  // ---------- conditions / quest chain
  function cond(c) {
    if (!c || !Object.keys(c).length) return true;
    if (c.flag) return !!S.flags[c.flag];
    if (c.not) return !S.flags[c.not];
    if (c.springs_gte !== undefined) return nSprings() >= c.springs_gte;
    if (c.all) return c.all.every(cond);
    return true;
  }
  const currentQuest = () => game.quests.find((q) => !cond(q.done));
  let lastQuest = null;
  function progress() {
    for (const id in S.springs) S.flags[id] = true;
    if (S.springs.spring2 && S.springs.spring3) S.flags.forest_done = true;
    if (S.springs.spring4 && S.springs.spring5 && S.flags.met_lamp) S.flags.caverns_done = true;
    const q = currentQuest();
    if (q && lastQuest && q.id !== lastQuest) { toast(`<small>New quest</small><br>${q.title}`, 2600); sfx('select', 0.5); }
    lastQuest = q ? q.id : 'end';
    hudUpdate();
  }

  // ---------- level construction
  let W = null;   // current level runtime
  const skyMat = new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), skyMat); scene.add(sky);
  const sprite = (map, color, size, additive = true, opacity = 1) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })); s.scale.setScalar(size); return s; };
  const local = (o, lx, lz) => { const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0); return [o.pos[0] + lx * c + lz * s, o.pos[2] - lx * s + lz * c]; };
  function addCol(x, z, r, tag) { W.cols.push({ x, z, r, tag }); }
  function particles(n, spread, y0, y1, map, color, size, additive = true, center = [0, 0]) {
    const out = [];
    for (let i = 0; i < n; i++) { const s = sprite(map, color, size * (0.6 + R() * 0.8), additive, 0.9); const x = center[0] + (R() - 0.5) * spread, z = center[1] + (R() - 0.5) * spread;
      s.userData = { x, z, y: W.h(x, z) + y0 + R() * (y1 - y0), ph: R() * 6.28, sp: 0.3 + R() * 0.7 }; s.position.set(x, s.userData.y, z); W.g.add(s); out.push(s); }
    return out;
  }
  async function buildLevel(id) {
    if (W) { scene.remove(W.g); W.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    mixers.splice(0, mixers.length, ...keepMixers);
    const L = LV[id];
    W = { id, L, g: new THREE.Group(), cols: [], springs: [], falls: [], portals: [], npcs: [], critters: [], pick: [], chests: [], amb: {}, anims: [], lid: null, swing: null, exit: null, h: null };
    scene.add(W.g);
    const T = terrain(L, `textures/${L.ground_texture}_32.png`); W.g.add(T.mesh); W.h = T.heightAt;
    const a = L.ambience || {};
    scene.fog = new THREE.Fog(new THREE.Color(a.fog || '#cfe0c8'), a.near || 30, a.far || 140);
    sky.visible = id !== 'L2';
    W.light = a.light || 1;
    if (L.water_level > -40) { const wt = tex('textures/water_32.png').clone(); wt.needsUpdate = true; wt.repeat.set(L.size / 4, L.size / 4);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(L.size * 3, L.size * 3), reg(new THREE.MeshBasicMaterial({ map: wt, transparent: true, opacity: id === 'L3' ? 0.62 : 0.8, depthWrite: false })));
      w.rotation.x = -Math.PI / 2; w.position.y = L.water_level; W.g.add(w); W.water = wt; }
    for (const p of (L.paths || [])) W.g.add(pathStrip(p, 1.3, W.h, id === 'BOSS' ? 'textures/cobble_32.png' : 'textures/dirt_32.png'));
    const jobs = [];
    const put = (model, o, extra) => jobs.push(load(`models/${model}.glb`).then((m) => { m.position.copy(P3(o.pos)); m.rotation.y = o.rot || 0;
      if (Array.isArray(o.scale)) m.scale.set(...o.scale); else m.scale.setScalar(o.scale || 1); W.g.add(m); if (extra) extra(m); return m; }));
    for (const p of L.props) { put(p.model, p); if (SOLID[p.model]) addCol(p.pos[0], p.pos[2], SOLID[p.model] * (p.scale || 1)); }
    for (const b of (L.bridges || [])) put(b.model, b);
    for (const p of (L.set_pieces || [])) { put(p.model, p, (m) => { if (p.id === 'mother_lid') W.lid = m; }); if (p.model === 'forge') addCol(p.pos[0], p.pos[2], 2.4); if (p.model === 'anvil_stump') addCol(p.pos[0], p.pos[2], 1); }
    // hideouts: shells with colliders, open towards the entrance
    for (const hd of (L.hideouts || [])) {
      put(hd.model, hd);
      if (hd.model === 'cave_mound') for (let k = 0; k < 18; k++) { const an = k / 18 * Math.PI * 2; if (Math.abs(Math.atan2(Math.sin(an), Math.cos(an))) < 0.55) continue; const [x, z] = local(hd, Math.sin(an) * 4, Math.cos(an) * 4); addCol(x, z, 0.8, 'shell'); }
      if (hd.model === 'root_tunnel') for (let zz = 0; zz >= -8; zz -= 1.2) for (const sx of [-1.7, 1.7]) { const [x, z] = local(hd, sx, zz); addCol(x, z, 0.55, 'shell'); }
      if (hd.model === 'hollow_log') for (const sx of [-1.25, 1.25]) for (const zz of [-1.6, 0, 1.6]) { const [x, z] = local(hd, sx, zz); addCol(x, z, 0.45, 'shell'); }
      if (hd.model === 'hollow_log') { const gl = sprite(glowT, '#ffc860', 2.6, true, 0.3); gl.position.set(hd.pos[0], hd.pos[1] + 0.9, hd.pos[2]); W.g.add(gl); W.anims.push((t) => { gl.material.opacity = G.closeup ? 0.08 : 0.26 + 0.08 * Math.sin(t * 2.3); }); }
    }
    for (const s of (L.springs || [])) buildSpring(s, springById[s.id]);
    if (L.mother_spring) { const ms = { id: 'mother', pos: L.mother_spring.pos || [0, W.h(0, -18), -18], radius: 2.2 }; W.mother = buildSpring(ms, { ...springs.mother, steam: true }, true); }
    for (const f of (L.waterfalls || [])) buildFall(f);
    for (const c of (L.chests || [])) put('chest', c, (m) => { W.chests.push({ ...c, obj: m }); addCol(c.pos[0], c.pos[2], 0.5); });
    if (L.swing) jobs.push(load('models/rope_swing.glb').then((m) => { const sw = L.swing; const piv = new THREE.Group(); piv.position.copy(P3(sw.pivot)); piv.rotation.y = sw.rot;
      m.position.set(0, -sw.seat_drop, 0); piv.add(m); W.g.add(piv); W.swing = { ...sw, obj: piv, ang: 0, vel: 0, on: false }; }));
    if (L.fox) { fox.position.copy(P3(L.fox.pos)); fox.rotation.y = L.fox.rot; fox.visible = true; } else fox.visible = !!S.flags.met_fox;
    for (const [i, n] of L.npcs.entries()) jobs.push(load(`models/${n.id}.glb`).then((m) => { m.position.copy(P3(n.pos)); m.position.y = W.h(n.pos[0], n.pos[2]); m.rotation.y = Math.PI;
      const an = animate(m); if (an) { an.play('idle', 0); an.cur.time = i * 0.6; }
      const mk = sprite(bangT, '#ffffff', 0.55, false); mk.position.y = 1.9; m.add(mk);
      const lb = sprite(labelT(n.name.split(' ').slice(-1)[0]), '#ffffff', 1.6, false); lb.scale.set(2.2, 0.42, 1); lb.position.y = 2.35; m.add(lb);
      W.npcs.push({ ...n, obj: m, anim: an, mark: mk, home: m.position.clone() }); addCol(n.pos[0], n.pos[2], 0.45, 'npc'); }));
    for (const [i, e] of L.enemies.entries()) {
      if (e.rank === 'boss') { dwarf.visible = true; dwarf.position.copy(P3(e.pos)); dwarf.position.y = W.h(e.pos[0], e.pos[2]); dwarf.rotation.y = 0; continue; }
      jobs.push(load(`models/${e.id}.glb`).then((m) => { m.position.copy(P3(e.pos)); const an = animate(m); if (an) { an.play(an.has('move') ? 'move' : 'idle', 0); an.cur.time = i * 0.37; }
        W.critters.push({ ...e, obj: m, anim: an, home: m.position.clone(), ph: i * 1.7, calm: 0, key: `${id}:${i}` }); W.g.add(m); }));
    }
    if (id !== 'BOSS') dwarf.visible = false;
    for (const c of (L.collectibles || [])) jobs.push(load(`models/${c.type === 'health' ? 'heart' : 'spring_pearl'}.glb`).then((m) => { m.position.copy(P3(c.pos)); m.position.y += 0.6; W.g.add(m); W.pick.push({ ...c, obj: m, base: m.position.y, got: !!S.chests[`${id}:${c.pos.join(',')}`] }); m.visible = !W.pick[W.pick.length - 1].got; }));
    for (const p of (L.portals || [])) buildPortal(p);
    if (L.exit) buildExit(L.exit);
    // ambience
    W.amb.ff = particles(Math.min(60, a.fireflies || 0), L.size * 0.7, 0.6, 3.5, glowT, '#ffe470', 0.45);
    W.amb.sp = particles(Math.min(70, a.spores || 0), L.size * 0.6, 0.3, 5, sporeT, id === 'L3' ? '#e8d8ff' : '#fff2c8', 0.18);
    W.amb.sb = [];
    for (let k = 0; k < (a.sunbeams || 0); k++) { const x = (R() - 0.5) * L.size * 0.6, z = (R() - 0.5) * L.size * 0.6;
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 16), new THREE.MeshBasicMaterial({ color: '#fff4c0', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
      beam.position.set(x, W.h(x, z) + 7, z); beam.rotation.z = 0.35; beam.rotation.y = R() * 3; beam.userData.ph = R() * 6; W.g.add(beam); W.amb.sb.push(beam); }
    W.amb.mist = a.mist ? particles(26, L.size * 0.7, 0.2, 1.2, puffT, '#e0ece4', 7, false) : [];
    W.amb.mist.forEach((m) => { m.material.opacity = 0.35; });
    W.amb.em = a.embers ? particles(40, 40, 0.2, 4, sparkT, '#ff9a40', 0.22, true, [10, -26]) : [];
    await Promise.all([...jobs, ...(W.springJobs || [])]);
    setAmbient(W.light);
    return W;
  }
  function buildSpring(s, info, isMother = false) {
    const y = s.pos[1] + 0.04, r = s.radius || 1.0;
    const g = new THREE.Group(); g.position.set(s.pos[0], y, s.pos[2]); g.rotation.y = s.rot || 0; W.g.add(g);

    let hintRift = null;
    if (!isMother) { hintRift = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.2), new THREE.MeshBasicMaterial({ map: stripTex('rift_spring'), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      hintRift.position.set(0, 1.6, 0); g.add(hintRift); W.portals.push({ fill: hintRift, spin: false }); }
    const fizz = new Audio('sfx/fizz.wav'); fizz.loop = true; fizz.volume = 0; fizz.playbackRate = info.fizz_pitch || 1;
    const hd = (W.L.hideouts || []).find((h) => h.spring === s.id);
    let cam = hd ? (hd.model === 'root_tunnel' ? [hd.pos[0] - s.pos[0], hd.pos[2] - s.pos[2]] : [s.pos[0] - hd.pos[0], s.pos[2] - hd.pos[2]]) : [0, 1];
    if (hd && (hd.model === 'cave_mound' || Math.hypot(cam[0], cam[1]) < 0.2)) cam = [Math.sin(hd.rot), Math.cos(hd.rot)];  // caves: from the mouth, looking in
    const camA = Math.atan2(cam[0], cam[1]), tightHide = hd && (hd.model === 'hollow_log' || hd.model === 'root_tunnel');
    const pool = makeSpringPool(s.id, info, r, { avoid: camA + (hd && hd.model === 'root_tunnel' ? 0.5 : 0) - (s.rot || 0), tight: tightHide }); g.add(pool.group);
    const sp = { ...s, info, g, pool, hintRift, fizz, r, isMother, found: !!S.springs[s.id], camA, hide: hd ? hd.model : 'open' };
    W.springs.push(sp); W.springJobs = (W.springJobs || []).concat([pool.ready]); return sp;
  }
  function buildFall(f) {
    const wt = tex('textures/water_32.png').clone(); wt.needsUpdate = true; wt.wrapS = wt.wrapT = THREE.RepeatWrapping; wt.repeat.set(f.width / 2, f.height / 3);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(f.width, f.height, 4, 8), new THREE.MeshBasicMaterial({ map: wt, color: '#d8f4ff', transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(f.pos[0], f.pos[1] + f.height / 2 - 0.4, f.pos[2]); m.rotation.y = f.rot; W.g.add(m);
    const foam = []; for (let i = 0; i < 12; i++) { const p = sprite(puffT, '#ffffff', 1.2, false, 0.6); p.userData = { x: (R() - 0.5) * f.width, t: R() }; W.g.add(p); foam.push(p); }
    const roar = new Audio('sfx/fizz.wav'); roar.loop = true; roar.volume = 0; roar.playbackRate = 0.55;
    W.falls.push({ ...f, m, wt, foam, roar });
  }
  function buildPortal(p) {
    const ring = p.type === 'spore_ring';
    load(`models/${p.model}.glb`).then((m) => { m.position.copy(P3(p.pos)); m.rotation.y = p.rot; W.g.add(m); });
    const fill = new THREE.Mesh(ring ? new THREE.CircleGeometry(2.6, 24) : new THREE.PlaneGeometry(3.0, 3.6),
      new THREE.MeshBasicMaterial({ map: stripTex(p.strip), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    if (ring) { fill.rotation.x = -Math.PI / 2; fill.position.set(p.pos[0], p.pos[1] + 0.12, p.pos[2]); } else { fill.position.set(p.pos[0], p.pos[1] + 1.9, p.pos[2]); fill.rotation.y = p.rot; }
    W.g.add(fill);
    const lb = sprite(labelT(p.name), '#ffffff', 1, false); lb.scale.set(5, 0.95, 1); lb.position.set(p.pos[0], p.pos[1] + 4.6, p.pos[2]); W.g.add(lb);
    W.portals.push({ ...p, fill, lb, spin: ring, gate: true });
  }
  function buildExit(e) {
    const fill = new THREE.Mesh(new THREE.CircleGeometry(e.radius, 24), new THREE.MeshBasicMaterial({ map: stripTex(e.strip), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const y = W.h(e.pos[0], e.pos[2] - 1.5);
    fill.position.set(e.pos[0], y + e.radius + 0.1, e.pos[2] - 1.5); fill.rotation.y = e.rot; W.g.add(fill);
    const lb = sprite(labelT('Home to Mossunder'), '#ffffff', 1, false); lb.scale.set(5, 0.95, 1); lb.position.set(e.pos[0], y + e.radius * 2 + 0.9, e.pos[2] - 1.5); W.g.add(lb);
    W.exit = { ...e, fill, x: e.pos[0], z: e.pos[2] - 1.5 }; W.portals.push({ fill, spin: true });
  }

  // ---------- rewards / gifts
  function learn(spellId) { if (!spellId || S.spells.includes(spellId)) return; S.spells.push(spellId); const s = spellById[spellId]; toast(`<small>New spell</small><br>${s ? s.name : spellId}`, 2600); sfx('cast_sparkle', 0.6); buildSpellBar(); }
  function healFull() { S.hp = S.maxHp; S.mp = S.maxMp; sfx('inn_rest', 0.5); hudUpdate(); }
  function give(gv) {
    if (!gv) return;
    if (gv.item && !S.items.includes(gv.item)) { S.items.push(gv.item); toast(`<small>You got</small><br>${gv.item}`); sfx('chest_open', 0.5); }
    if (gv.spell) learn(gv.spell);
    if (gv.heal) healFull();
    if (gv.ride) { S.flags.met_fox = true; fox.visible = true; toast(`${input.scheme === 'touch' ? 'Tap the paw button' : `Press ${gk('ride')}`} next to ${game.fox.name} to ride!`, 2600); sfx('fox_yip', 0.6); }
  }
  function setFlags(list) {
    for (const f of (list || [])) {
      S.flags[f] = true;
      if (f === 'elder_ring') { toast('The spore ring is awake!<br><small>Find it on the west edge of Mossunder</small>', 3000); sfx('portal_whoosh', 0.6); }
      if (f === 'reconciled') toast('Stand by the great lid and press E.<br><small>Lift it together!</small>', 3200);
    }
  }

  // ---------- dialogue trees (typewriter, gnome babble voices, choices 1-4)
  const D = { tree: null, node: null, line: 0, typing: false, full: '', onEnd: null, who: null };
  const VOICE = Object.fromEntries((man.voices || []).map((v) => [v.npc, v.wav]));
  function talk(treeId, onEnd) {
    const tr = game.trees[treeId]; if (!tr) return;
    const br = tr.branches.find((b) => cond(b.when)) || {};
    D.tree = treeId; D.onEnd = onEnd || null; D.who = treeId; S.talked[treeId] = true;
    setMode('dialog'); dlgEl.classList.remove('hide');
    const por = dlgEl.querySelector('.por'); por.src = treeId === 'boss' ? 'models/boss_thumb.png' : `models/${treeId}_thumb.png`;
    showNode(br.start || 'start');
  }
  function showNode(id) { D.node = game.trees[D.tree].nodes[id]; D.line = 0; if (!D.node) return endTalk(); showLine(); }
  function showLine() {
    const n = D.node; dlgEl.querySelector('.who').textContent = n.speaker; dlgEl.querySelector('.opts').innerHTML = ''; dlgEl.querySelector('.more').classList.add('hide');
    const text = n.lines[D.line] || ''; D.full = text; D.typing = true;
    const v = VOICE[D.tree === 'boss' ? 'boss' : D.tree]; if (v) { const a = sfx(v.replace(/^sfx\/|\.wav$/g, ''), 0.45); setTimeout(() => a.pause(), Math.min(2600, 140 + text.length * 30)); }
    const el = dlgEl.querySelector('.txt'); let i = 0; el.textContent = ''; clearInterval(D.tw);
    D.tw = setInterval(() => { i += 1; el.textContent = text.slice(0, i); if (i >= text.length) finishLine(); }, 1000 / 45);
  }
  function finishLine() {
    clearInterval(D.tw); D.typing = false; dlgEl.querySelector('.txt').textContent = D.full;
    const n = D.node, last = D.line >= n.lines.length - 1;
    if (!last || !n.options) { dlgEl.querySelector('.more').classList.remove('hide'); return; }
    const box = dlgEl.querySelector('.opts'); box.innerHTML = '';
    D.opt = 0; n.options.forEach((o, k) => { const b = div('opt', box, `<b>${k + 1}</b> ${o.text}`); b.onpointerdown = (e) => { e.stopPropagation(); choose(k); }; b.onpointerenter = (e) => { if (e.pointerType === 'mouse') { D.opt = k; drawOpt(); } }; });
    drawOpt();
  }
  function drawOpt() { dlgEl.querySelectorAll('.opt').forEach((el, k) => el.classList.toggle('sel', k === D.opt && input.scheme !== 'touch')); }
  function advance() {
    if (D.typing) return finishLine();
    const n = D.node;
    if (D.line < n.lines.length - 1) { D.line++; sfx('blip', 0.3); return showLine(); }
    if (n.options) return;
    if (n.next) return showNode(n.next);
    endTalk();
  }
  function choose(k) {
    const o = D.node && D.node.options && D.node.options[k]; if (!o || D.typing) return;
    sfx('select', 0.5); setFlags(o.set); give(o.give); progress();
    if (o.next) showNode(o.next); else endTalk();
  }
  function endTalk() {
    clearInterval(D.tw); dlgEl.classList.add('hide'); const cb = D.onEnd; D.tree = null; D.node = null; setMode('field'); progress();
    if (S.flags.boss_fight && !S.flags.boss_beaten && W.id === 'BOSS') { S.flags.boss_fight = false; startBossBattle(); }
    if (cb) cb();
  }

  // ---------- parchment map (M)
  const mapImg = {}; for (const l of levelsMeta) { const im = new Image(); im.src = l.map; mapImg[l.id] = im; }
  function drawMap() {
    const cv = mapEl.querySelector('canvas'), g = cv.getContext('2d'), L = W.L, S2 = L.size;
    const meta = levelsMeta.find((l) => l.id === W.id);
    mapEl.querySelector('.ttl').textContent = meta.name;
    g.fillStyle = '#f2e2b8'; g.fillRect(0, 0, 256, 256);
    if (mapImg[W.id].complete) { g.globalAlpha = 0.85; g.drawImage(mapImg[W.id], 8, 8, 240, 240); g.globalAlpha = 1; }
    const P = (x, z) => [128 + x / S2 * 240, 128 + z / S2 * 240];
    const dot = (x, z, col, r, ring) => { const [u, v] = P(x, z); g.fillStyle = col; g.beginPath(); g.arc(u, v, r, 0, 7); g.fill(); if (ring) { g.strokeStyle = '#4a2a14'; g.lineWidth = 1.5; g.stroke(); } };
    const rev = !!S.revealed[W.id];
    for (const s of W.springs) { if (s.isMother) continue; if (s.found) dot(s.pos[0], s.pos[2], s.info.water, 5, true); else if (rev) { const [u, v] = P(s.pos[0], s.pos[2]); g.fillStyle = '#4a2a14'; g.font = 'bold 14px Lilita, sans-serif'; g.fillText('?', u - 4, v + 5); } }
    for (const p of W.portals.filter((q) => q.gate)) { dot(p.pos[0], p.pos[2], '#9a6ad0', 4, true); }
    if (W.exit) dot(W.exit.x, W.exit.z, '#5aa832', 4, true);
    for (const n of W.npcs) dot(n.pos[0], n.pos[2], '#d6322a', 3);
    for (const c of W.chests) if (rev || S.chests[c.id]) dot(c.pos[0], c.pos[2], '#e8b040', 3, true);
    const [u, v] = P(player.position.x, player.position.z); g.save(); g.translate(u, v); g.rotate(-player.rotation.y + Math.PI); g.fillStyle = '#d6322a'; g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.fill(); g.strokeStyle = '#fff'; g.stroke(); g.restore();
    const found = W.springs.filter((s) => !s.isMother && s.found).length, tot = W.springs.filter((s) => !s.isMother).length;
    mapEl.querySelector('.leg').innerHTML = `<span style="color:#d6322a">&#9650;</span> you &nbsp; <span style="color:#3fb8e8">&#9679;</span> springs ${found}/${tot}${rev ? ' &nbsp; ? = secrets' : ''} &nbsp; <span style="color:#9a6ad0">&#9679;</span> gates`;
  }
  // ---------- corner minimap (local area, facing arrow) + a faint rim chevron toward the current quest step
  function questNav() {
    const q = currentQuest(), st = q && q.target; if (!st) return null;
    const links = W.portals.filter((p) => p.gate).map((p) => ({ to: p.level, x: p.pos[0], z: p.pos[2] }));
    if (W.exit) links.push({ to: W.exit.to || 'HUB', x: W.exit.x, z: W.exit.z });
    const at = (o) => ({ x: o.position.x, z: o.position.z });
    return questHeading(st, { level: W.id, hub: 'HUB', flag: (k) => !!S.flags[k], found: (id) => !!S.springs[id], links, from: player.position,
      where: (step, id) => {
        if (id) { const sp = W.springs.find((o) => o.id === id); return sp ? { x: sp.pos[0], z: sp.pos[2] } : null; }
        if (step.npc) { const n = W.npcs.find((o) => o.id === step.npc); return n ? at(n.obj) : null; }
        if (step.fox) return fox.visible ? at(fox) : null;
        if (step.boss) return dwarf.visible ? at(dwarf) : null;
        if (step.exit) return W.exit ? { x: W.exit.x, z: W.exit.z } : null;
        return null; } });
  }
  function miniView() {
    if (!W || G.mode !== 'field' || G.closeup || input.settings.minimap === false) return null;
    const marks = [];
    for (const p of W.portals) if (p.gate) marks.push({ x: p.pos[0], z: p.pos[2], c: '#9a6ad0', r: 3.6, ring: true });
    if (W.exit) marks.push({ x: W.exit.x, z: W.exit.z, c: '#5aa832', r: 3.6, ring: true });
    for (const n of W.npcs) marks.push({ x: n.obj.position.x, z: n.obj.position.z, c: '#d6322a', r: 2.6 });
    for (const sp of W.springs) if (sp.found && !sp.isMother) marks.push({ x: sp.pos[0], z: sp.pos[2], c: sp.info.water, r: 3.4, ring: true });
    if (!W.mini) W.mini = miniMap(W.L);
    return { img: W.mini, size: W.L.size, x: player.position.x, z: player.position.z, facing: player.rotation.y, marks,
      heading: input.settings.questArrow === false ? null : questNav() };
  }
  const MINI_BIG = ['treehouse', 'giant_trunk', 'mushroom_house', 'root_house', 'rainbow_cap', 'shelf_stump', 'toadstool_red', 'lantern_cap'];
  const miniMap = (L) => bakeMap({ size: L.size, h: W.h, water: L.water_level, paths: L.paths, props: L.props, big: MINI_BIG });
  const mini = createMinimap({ parent: hud, view: miniView, cls: 'mg-mini' });
  function openMap() { if (!S.flags.has_map) { toast('You have no map yet.<br><small>Grandpa Femble has one.</small>'); return; } sfx('map_unfold', 0.6); drawMap(); mapEl.classList.remove('hide'); setMode('map'); }
  function closeMap() { mapEl.classList.add('hide'); setMode('field'); }

  // ---------- pause menu (P)
  const MENU = ['Resume', 'Save', 'Quest log', 'Spells', 'Controls', 'Settings', 'Title screen'];
  let setSel = 0;
  const SC = [0.5, 0.7, 0.85, 1];
  const SET_ROWS = [
    { name: 'Display', val: () => display.label('res'), adj: (d) => display.cycle('res', d) },
    { name: 'Aspect', val: () => display.label('aspect'), adj: (d) => display.cycle('aspect', d) },
    { name: 'Render scale', val: () => display.label('scale'), step: true, adj: (d) => display.set('scale', SC[clamp(SC.indexOf(+display.settings.scale) + d, 0, SC.length - 1)]) },
    { name: 'Fullscreen', fs: true, val: () => (display.canFS() ? (display.isFS() ? 'On' : 'Off') : 'Tips'), adj: () => { display.toggleFS().then(() => setTimeout(() => G.mode === 'menu' && drawMenu(), 200)); } },
    { name: 'Camera', val: () => (input.settings.camMode === 'free' ? 'Free' : 'Follow'), adj: () => toggleCam(true) },
    { name: 'Camera sensitivity', val: () => `${input.settings.sens.toFixed(2)}x`, step: true, adj: (d) => { input.settings.sens = clamp(Math.round((input.settings.sens + d * 0.25) * 4) / 4, 0.25, 3); } },
    { name: 'Invert camera Y', val: () => (input.settings.invertY ? 'On' : 'Off'), adj: () => { input.settings.invertY = !input.settings.invertY; } },
    { name: 'Mouse look', val: () => (input.settings.mouseLock ? 'Click to lock' : 'Click-drag'), adj: () => { input.settings.mouseLock = !input.settings.mouseLock; if (!input.settings.mouseLock) input.unlock(); } },
    { name: 'Auto Target Lock', val: () => (input.settings.autoLock === false ? 'Off' : 'On'), adj: () => { input.settings.autoLock = input.settings.autoLock === false; } },
    { name: 'Minimap', val: () => (input.settings.minimap === false ? 'Off' : 'On'), adj: () => { input.settings.minimap = input.settings.minimap === false; } },
    { name: 'Quest hint arrow', val: () => (input.settings.questArrow === false ? 'Off' : 'On'), adj: () => { input.settings.questArrow = input.settings.questArrow === false; } },
    { name: 'Install app', install: true, val: () => display.installLabel(), adj: () => { display.install().then(() => setTimeout(() => G.mode === 'menu' && drawMenu(), 300)); } },
    { name: 'Back', back: true }];
  function settingsKey(k) {
    const r = SET_ROWS[setSel];
    if (k === 'ArrowUp' || k === 'KeyW') setSel = (setSel + SET_ROWS.length - 1) % SET_ROWS.length;
    else if (k === 'ArrowDown' || k === 'KeyS') setSel = (setSel + 1) % SET_ROWS.length;
    else if ((k === 'ArrowLeft' || k === 'KeyA') && r.adj) r.adj(-1);
    else if ((k === 'ArrowRight' || k === 'KeyD') && r.adj) r.adj(1);
    else if (['Enter', 'Space', 'KeyE'].includes(k)) { if (r.back) { menuBack(); return; } r.adj(1); }
    else if (['Escape', 'Backspace', 'KeyP'].includes(k)) { input.save(); menuBack(); return; }
    else return;
    input.save(); sfx('menu_tick', 0.3); drawMenu();
  }
  let menuSel = 0, menuPage = 'main';
  let menuFrom = null;
  function openMenu(page = 'main', from = null) { menuPage = page; menuFrom = from; if (from === 'title') titleEl.classList.add('hide'); menuEl.classList.remove('hide'); setMode('menu'); sfx('menu_tick', 0.5); drawMenu(); }
  function closeMenu() { menuEl.classList.add('hide'); if (menuFrom === 'title') { menuFrom = null; titleEl.classList.remove('hide'); setMode('title'); drawTitleSel(); drawTitleFoot(); return; } setMode('field'); }
  function menuBack() { if (menuFrom === 'title') closeMenu(); else { menuPage = 'main'; drawMenu(); } }
  function drawMenu() {
    let h = '';
    if (menuPage === 'main') h = `<h2>Paused</h2><div class="sub">${levelsMeta.find((l) => l.id === W.id).name} &middot; ${fmtTime(S.time)}</div>` + MENU.map((m, i) => `<div class="mi${i === menuSel ? ' sel' : ''}" data-i="${i}">${m}</div>`).join('');
    if (menuPage === 'quests') h = '<h2>Quest log</h2>' + game.quests.map((q) => { const d = cond(q.done), cur = q === currentQuest(); return (d || cur) ? `<div class="q${d ? ' done' : ''}"><b>${d ? '&#10003;' : '&#10148;'} ${q.title}</b>${cur ? `<br><small>${q.goal}</small>` : ''}</div>` : ''; }).join('') + '<div class="mi back">Back</div>';
    if (menuPage === 'spells') h = '<h2>Spellbook</h2>' + S.spells.map((id, i) => { const s = spellById[id]; return `<div class="q"><b style="color:${FAM_COL[s.family]}">${i + 1}. ${s.name}</b> <small>${s.family} &middot; ${s.mp_cost_at_min} MP</small></div>`; }).join('') + `<div class="q"><small>Items: ${S.items.join(', ') || 'none'}</small></div><div class="mi back">Back</div>`;
    if (menuPage === 'controls') h = controlsPage();
    if (menuPage === 'settings') h = '<h2>Settings</h2><div class="sgrid">' + SET_ROWS.map((r, i) => `<div class="mi set${i === setSel ? ' sel' : ''}" data-s="${i}">${r.name}${r.back ? '' : ` <span class="val">${r.step ? '<u data-d="-1">-</u>' : ''}${r.val()}${r.step ? '<u data-d="1">+</u>' : ''}</span>`}</div>`).join('') + `</div><div class="q"><small>Saved on this device &middot; rendering ${display.rw}&times;${display.rh}</small></div>`;
    menuEl.innerHTML = h; menuEl.classList.add('n64-scroll'); menuEl.classList.toggle('wide', menuPage === 'settings' || menuPage === 'controls'); menuEl.dataset.page = menuPage;
    menuEl.querySelectorAll('.mi').forEach((el) => { el.onpointerdown = (e) => { e.stopPropagation();
      if (el.dataset.s !== undefined) { setSel = +el.dataset.s; const r = SET_ROWS[setSel]; if (r.fs || r.install) return; if (r.back) { menuBack(); return; } r.adj(+(e.target.dataset.d || 1)); input.save(); sfx('menu_tick', 0.3); drawMenu(); return; }
      if (el.classList.contains('back')) menuBack(); else { menuSel = +el.dataset.i; menuPick(); } }; });
    const fsRow = menuEl.querySelector(`.mi[data-s="${SET_ROWS.findIndex((r) => r.fs)}"]`);  // fullscreen needs a real click / tap (user gesture)
    if (fsRow) armClick(fsRow, () => { setSel = +fsRow.dataset.s; SET_ROWS[setSel].adj(1); });
    const inRow = menuEl.querySelector(`.mi[data-s="${SET_ROWS.findIndex((r) => r.install)}"]`);  // the install prompt also needs a real click / tap
    if (inRow) armClick(inRow, () => { setSel = +inRow.dataset.s; SET_ROWS[setSel].adj(1); });
    const sel = menuEl.querySelector('.mi.sel');  // keep the focused row in view in a scrolled panel (without scrolling the page)
    if (sel) { const t = sel.offsetTop, b = t + sel.offsetHeight; if (t < menuEl.scrollTop) menuEl.scrollTop = t - 8; else if (b > menuEl.scrollTop + menuEl.clientHeight) menuEl.scrollTop = b - menuEl.clientHeight + 8; }
  }
  function controlsPage() {
    const P = (b) => input.glyph(b), fox = game.fox.name;
    const kb = [['WASD / arrows', 'waddle'], ['Shift', 'walk / run'], ['Space', 'jump'], ['E / right-click', 'talk / use'], ['F / left-click', 'hat bonk'], ['T / middle-click', 'Target Lock'], ['1-6', 'cast a spell'],
      ['Q R / wheel', 'pick a spell (ring)'], ['Enter', 'confirm / cast picked'], ['R', `ride ${fox}`], ['C', 'camera: follow / free'], ['M / Tab', 'map'], ['H', 'hint'], ['Esc', 'pause / back'], ['Mouse', 'drag or lock: look'], ['Wheel', 'zoom (field)'], ['` (backtick)', 'fullscreen']];
    const pad = [[P('LS'), `waddle (${P('L3')}: walk)`], [P('RS'), `look (${P('R3')}: follow / free)`], [P('A'), 'jump / confirm'], [P('B'), 'back'], [P('X'), 'hat bonk'], [P('Y'), 'talk / use'],
      [P('LT'), 'Target Lock'], [P('RT'), 'cast picked / use'], [`${P('LB')} ${P('RB')}`, 'pick a spell'], [`${P('DPAD')}`, 'menus; field: up hint, down ride'], [P('START'), 'pause'], [P('SELECT'), 'map'], [`${P('START')}+${P('SELECT')}`, 'fullscreen']];
    const tc = [['Left third', 'slide: waddle'], ['Right side', 'drag: look'], ['Hand', 'talk / use'], ['Arrow', 'jump'], ['Reticle', 'Target Lock'], ['Camera', 'follow / free'], ['Paw', `ride ${fox}`],
      ['Sparkle', 'cast picked spell'], ['Hat', 'hat bonk'], ['Spell tiles', 'cast in the ring'], [`Corner ${FS_ICO}`, 'fullscreen'], ['Tap', 'menus &amp; choices']];
    const col = (t, rows, on) => `<div class="cc${on ? ' on' : ''}"><h3>${t}</h3>${rows.map(([k, v]) => `<div><b>${k}</b> ${v}</div>`).join('')}</div>`;
    return '<h2>Controls</h2><div class="ctl3">' + col('Keyboard &amp; mouse', kb, input.scheme === 'kbm') + col('Controller', pad, input.scheme === 'pad') + col('Touch', tc, input.scheme === 'touch') +
      '</div><div class="q"><small>Target Lock: face a critter, circle it with the stick / WASD; press again to switch or let go. Leave the ring to run away.</small></div><div class="mi back">Back</div>';
  }
  function menuPick() {
    sfx('select', 0.5);
    const m = MENU[menuSel];
    if (m === 'Resume') closeMenu();
    else if (m === 'Save') { save(); }
    else if (m === 'Quest log') { menuPage = 'quests'; drawMenu(); }
    else if (m === 'Spells') { menuPage = 'spells'; drawMenu(); }
    else if (m === 'Controls') { menuPage = 'controls'; drawMenu(); }
    else if (m === 'Settings') { menuPage = 'settings'; setSel = 0; drawMenu(); }
    else if (m === 'Title screen') { save(true); closeMenu(); showTitle(); }
  }
  const fmtTime = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  // ---------- title screen / intro / ending
  function showTitle() {
    setMode('title'); music.play('title');
    titleEl.innerHTML = `<div class="logo">${game.title.title}</div><div class="sub">${game.title.subtitle}</div>` +
      `<div class="tmenu"><div class="mi" data-k="new">${game.title.menu[0]}</div><div class="mi${hasSave() ? '' : ' off'}" data-k="cont">${game.title.menu[1]}</div>` +
      '<div class="mi" data-k="set">Settings</div><div class="mi" data-k="fs"></div></div><div class="foot"></div>';
    titleEl.classList.remove('hide'); hud.classList.add('titling'); titleSel = hasSave() ? 1 : 0; drawTitleSel(); drawTitleFoot();
    titleEl.querySelectorAll('.mi').forEach((el, i) => { el.onpointerdown = (e) => { e.stopPropagation(); if (el.dataset.k === 'fs') return; titleSel = i; titlePick(); }; });
    armClick(titleEl.querySelector('[data-k=fs]'), () => { titleSel = 3; drawTitleSel(); display.toggleFS(); });  // real click / tap = user gesture
    if (!G.tipped) { G.tipped = true; setTimeout(() => display.tip(), 700); }  // iPhone: one-time 'Add to Home Screen' tip
  }
  let titleSel = 0;
  function drawTitleFoot() {
    const fe = titleEl.querySelector('[data-k=fs]'); if (fe) fe.innerHTML = FS_ICO + (display.canFS() ? (display.isFS() ? 'Exit fullscreen' : 'Fullscreen') : 'Fullscreen tips');
    const f = titleEl.querySelector('.foot'); if (!f) return; const P = (b) => input.glyph(b);
    f.innerHTML = padFirst() ? `${P('DPAD')} choose &middot; ${P('A')} start<br>${P('LS')} waddle &middot; ${P('RS')} camera &middot; ${P('A')} jump &middot; ${P('Y')} talk &middot; ${P('LT')} lock &middot; ${P('START')} pause`
      : input.scheme === 'touch' ? 'Tap to choose<br>Slide on the left to waddle &middot; drag on the right to look &middot; round buttons to act'
      : 'Enter / click &middot; arrows to choose<br>WASD waddle &middot; Space jump &middot; E talk &middot; F bonk &middot; T lock &middot; C camera &middot; M map &middot; Esc pause &middot; ` fullscreen';
  }
  function drawTitleSel() { titleEl.querySelectorAll('.mi').forEach((el, i) => el.classList.toggle('sel', i === titleSel)); }
  async function titlePick() {
    const tk = (titleEl.querySelectorAll('.mi')[titleSel] || {}).dataset?.k;
    if (tk === 'set') { sfx('select', 0.6); openMenu('settings', 'title'); setSel = 0; drawMenu(); return; }
    if (tk === 'fs') { sfx('select', 0.6); display.toggleFS(); return; }
    if (titleSel === 1 && !hasSave()) { sfx('menu_tick', 0.3); return; }
    sfx('select', 0.6); titleEl.classList.add('hide'); hud.classList.remove('titling');
    if (titleSel === 1) { loadSave(); await goLevel(S.level, S.pos); toast('Welcome back!'); setMode('field'); }
    else { S = fresh(); await goLevel('HUB'); showIntro(); }
  }
  function showIntro() {
    setMode('intro'); let i = 0;
    const page = () => { endEl.innerHTML = `<div class="page">${game.title.intro[i]}</div><div class="foot">&#9660; ${tapOr('confirm')}</div>`; };
    endEl.classList.remove('hide'); endEl.classList.add('intro'); page();
    G.introNext = () => { i++; sfx('blip', 0.3); if (i >= game.title.intro.length) { endEl.classList.add('hide'); endEl.classList.remove('intro'); setMode('field'); progress(); toast(currentQuest().title); } else page(); };
  }
  function showEnding() {
    setMode('ending'); music.play('ending'); let i = 0; setAmbient(1.15); scene.fog.color.set('#c8d8b0'); scene.fog.far = 160;
    const pages = [...game.ending.pages];
    const page = () => { endEl.innerHTML = i < pages.length ? `<div class="page">${pages[i]}</div><div class="foot">&#9660; ${tapOr('confirm')}</div>` :
      `<div class="page credits"><b>${game.title.title}</b><br><br>${game.ending.credits.join('<br>')}<br><br>Time ${fmtTime(S.time)} &middot; Springs ${nSprings()}/${springs.springs.length}</div><div class="foot">${tapOr('confirm')}: back to title</div>`; };
    endEl.classList.remove('hide'); page();
    G.introNext = () => { i++; sfx('blip', 0.3); if (i > pages.length) { endEl.classList.add('hide'); showTitle(); } else page(); };
  }

  // ---------- ring-arena battles (real time inside a toadstool ring; leave the ring to run away)
  const music = new Music(man);
  let B = null;
  const fxList = [];
  function ringMesh(r, col) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r + 0.25, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    m.rotation.x = -Math.PI / 2; g.add(m);
    const caps = Math.round(r * 2.2);
    for (let k = 0; k < caps; k++) load(`models/${k % 3 ? 'toadstool_red' : 'toadstool_blue'}.glb`).then((t) => { const a = k / caps * Math.PI * 2; t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); t.scale.setScalar(0.35); g.add(t); });
    return g;
  }
  let selSpell = 0;  // picked spell (LB/RB, Q/R, wheel, d-pad) cast with RT / Enter / right-click / the sparkle button
  function buildSpellBar() {
    const n = Math.min(6, S.spells.length); selSpell = clamp(selSpell, 0, Math.max(0, n - 1)); const pad = input.scheme === 'pad';
    spellBar.innerHTML = S.spells.slice(0, 6).map((id, i) => { const s = spellById[id]; return `<div class="sp${i === selSpell ? ' sel' : ''}" data-i="${i}" style="border-color:${FAM_COL[s.family]}"><b>${pad ? '&nbsp;' : i + 1}</b>${s.name}<small>${s.mp_cost_at_min}</small></div>`; }).join('') +
      (input.scheme === 'touch' ? '' : `<i class="cyc l">${gk('prev')}</i><i class="cyc r">${gk('next')} &middot; ${gk('cast')}</i>`);
    spellBar.querySelectorAll('.sp').forEach((el) => { el.onpointerdown = (e) => { e.stopPropagation(); press(`Digit${+el.dataset.i + 1}`); }; });
  }
  function cycleSpell(d) {
    const n = Math.min(6, S.spells.length); if (!n) return; selSpell = (selSpell + d + n) % n; sfx('menu_tick', 0.3);
    if (B) buildSpellBar(); else toast(`Picked spell: ${spellById[S.spells[selSpell]].name}`, 900);
  }
  const battleHint = () => (input.scheme === 'pad' ? `${gk('prev')} ${gk('next')} pick &middot; ${gk('cast')} cast &middot; ${gk('attack')} bonk &middot; ${input.glyph('LT')} lock`
    : input.scheme === 'touch' ? 'tap a spell &middot; hat to bonk &middot; reticle to lock' : '1-6 or Q/R + Enter spells &middot; F bonk &middot; T lock');
  function startBattle(first) {
    const c = first.obj.position.clone().add(player.position).multiplyScalar(0.5);
    const foes = W.critters.filter((k) => k.calm <= 0 && !k.gone && k.obj.position.distanceTo(c) < 7).slice(0, 3);
    if (!foes.includes(first)) foes.unshift(first);
    for (const f of foes) { const info = (game.critters[W.id] || []).find((q) => q.id === f.id) || { hp: 5, atk: 2, xp: 8, element: 'mushroom' }; f.hp = f.maxHp = info.hp; f.atk = info.atk; f.xp = info.xp; f.element = info.element; f.cd = 1 + R(); }
    const ring = ringMesh(5.5, '#ffe080'); ring.position.set(c.x, W.h(c.x, c.z) + 0.05, c.z); W.g.add(ring);
    B = { c, r: 5.5, foes, ring, boss: false, t: 0, shield: 0 };
    setMode('battle'); sfx('arena_open', 0.6); music.play('battle'); buildSpellBar(); spellBar.classList.remove('hide'); foeEl.classList.remove('hide'); drawFoe();
    toast(`${first.name}${foes.length > 1 ? ` and ${foes.length - 1} more` : ''} ${foes.length > 1 ? 'are' : 'is'} cross!<br><small>${battleHint()} &middot; leave the ring to run</small>`, 2600);
  }
  function startBossBattle() {
    const bs = game.boss, c = dwarf.position.clone();
    const ring = ringMesh(8, '#ff9a50'); ring.position.set(c.x, W.h(c.x, c.z) + 0.05, c.z); W.g.add(ring);
    const foe = { name: bs.short, obj: dwarf, anim: dA, hp: bs.hp, maxHp: bs.hp, atk: bs.atk, element: bs.element, xp: 120, cd: 2.2, boss: true, phase: 1, move: null, vuln: 0 };
    B = { c, r: 8, foes: [foe], ring, boss: true, t: 0, shield: 0, shots: [], waves: [] };
    player.position.set(c.x, W.h(c.x, c.z + 5.5), c.z + 5.5);
    setMode('battle'); sfx('dwarf_grumble', 0.8); music.play('boss'); buildSpellBar(); spellBar.classList.remove('hide'); foeEl.classList.remove('hide'); drawFoe();
    toast(`${bs.name}<br><small>${bs.phases[0].name}</small>`, 2400);
  }
  function drawFoe() { const alive = B.foes.filter((f) => f.hp > 0); foeEl.innerHTML = alive.map((f) => `<div class="fn">${f.name}${f.boss ? ` <small>${game.boss.phases[f.phase - 1].name}</small>` : ''}</div><div class="bar"><i style="width:${100 * f.hp / f.maxHp}%"></i></div>`).slice(0, 2).join(''); }
  function hurtPlayer(dmg, src) {
    if (B && B.shield > 0) dmg = Math.ceil(dmg / 2);
    S.hp = Math.max(0, S.hp - dmg); sfx('hurt', 0.5); floatText(camera, player.position.clone().add(new THREE.Vector3(0, 1.6, 0)), `-${dmg}`, 'float mg-dmg');
    pA && pA.play('hit', 0.05, true); G.flash = 0.25; hudUpdate();
    if (S.hp <= 0) faint(src);
  }
  function hitFoe(f, dmg, fam) {
    let mult = 1; const ow = spells.opposite[f.element];
    if (fam && ow === fam) mult = 1.25; if (fam && fam === f.element) mult = 0.5;
    if (f.boss) { if (fam === game.boss.weak) mult = 1.5; if (f.vuln > 0) mult *= 1.5; }
    const d = Math.max(1, Math.round(dmg * mult));
    f.hp = Math.max(0, f.hp - d); sfx(fam ? FAM_SFX[fam] : 'hat_bonk', 0.6);
    floatText(camera, f.obj.position.clone().add(new THREE.Vector3(0, f.boss ? 2.6 : 1.2, 0)), `${d}${mult > 1 ? '!' : ''}`, 'float mg-hit');
    f.anim && f.anim.play('hit', 0.05, true);
    if (f.boss && f.phase === 1 && f.hp <= f.maxHp / 2) { f.phase = 2; f.cd = 1.5; toast(`${game.boss.phases[1].name}!<br><small>${game.boss.phases[1].tell}</small>`, 2200); sfx('dwarf_grumble', 0.8); }
    if (f.hp <= 0) { S.xp += f.xp; f.anim && !f.boss && f.anim.play('death', 0.1, true); if (!f.boss) sfx('squish', 0.5); }
    drawFoe();
    if (B.foes.every((q) => q.hp <= 0)) winBattle();
  }
  function cast(i) {
    const id = S.spells[i]; const s = id && spellById[id]; if (!s) return;
    const cost = s.mp_cost_at_min; if (S.mp < cost) { toast('Not enough fizz (MP)!', 1200); sfx('miss', 0.5); return; }
    const tgt = B.foes.filter((f) => f.hp > 0).sort((a, b) => a.obj.position.distanceTo(player.position) - b.obj.position.distanceTo(player.position))[0];
    S.mp -= cost; pA && pA.play('cast', 0.05, true); sfx('cast_sparkle', 0.5);
    const from = player.position.clone().add(new THREE.Vector3(0, 1, 0));
    const self = s.target === 'self';
    const to = self || !tgt ? player.position.clone() : tgt.obj.position.clone().add(new THREE.Vector3(0, 0.6, 0));
    const fx = makeVFX(s.vfx, from, to); scene.add(fx.group); fxList.push(fx);
    const pw = Math.round(s.power_at_min * (1 + (S.lv - 1) * 0.08));
    if (s.vfx.template === 'heal_motes') { S.hp = Math.min(S.maxHp, S.hp + pw * 2); toast(`${s.name}: +${pw * 2} HP`, 1200); }
    else if (s.vfx.template === 'barrier_dome') { B.shield = 7; toast(`${s.name}: you feel well guarded`, 1200); }
    else setTimeout(() => { if (!B) return; if (s.target === 'area') B.foes.filter((f) => f.hp > 0).forEach((f) => hitFoe(f, pw, s.family)); else if (tgt && tgt.hp > 0) hitFoe(tgt, pw, s.family); }, 450);
    hudUpdate();
  }
  function bonk() {
    pA && pA.play('attack', 0.05, true);
    const tgt = B.foes.filter((f) => f.hp > 0 && f.obj.position.distanceTo(player.position) < (f.boss ? 2.6 : 1.9))[0];
    if (!tgt) { sfx('miss', 0.4); return; }
    hitFoe(tgt, game.start_stats.atk + S.lv, null); S.mp = Math.min(S.maxMp, S.mp + 1);
  }
  function endBattle() { W.g.remove(B.ring); for (const s of (B.shots || [])) W.g.remove(s.obj); for (const w of (B.waves || [])) W.g.remove(w.obj); B = null; spellBar.classList.add('hide'); foeEl.classList.add('hide'); setMode('field'); music.play(W.L.music || 'overworld'); }
  function winBattle() {
    const boss = B.boss;
    if (boss) { toast(game.boss.defeat, 3200); S.flags.boss_beaten = true; dA && dA.play('idle', 0.3); endBattle(); music.play('victory', { loop: false }); setTimeout(() => talk('boss'), 1600); progress(); return; }
    for (const f of B.foes) { f.calm = 9999; f.gone = true; setTimeout(() => { f.obj.visible = false; }, 900); }
    const xp = B.foes.reduce((a, f) => a + f.xp, 0); sfx('coin', 0.5); toast(`The critters calm down and hop home.<br><small>+${xp} XP</small>`, 2000);
    while (S.xp >= S.lv * 40) { S.xp -= S.lv * 40; S.lv++; S.maxHp += 4; S.maxMp += 2; S.hp = S.maxHp; S.mp = S.maxMp; setTimeout(() => toast(`Level ${S.lv}! You feel sprightlier.`), 2100); }
    endBattle(); progress();
  }
  function flee() { sfx('escape', 0.6); for (const f of B.foes) f.calm = 6; toast('You waddled away!', 1200); endBattle(); }
  function faint() {
    toast(`${game.hero} feels woozy...<br><small>Granny Pawick's clover tea puts you right.</small>`, 3000);
    if (B) { for (const f of B.foes) if (!f.boss) f.calm = 8; endBattle(); }
    for (const k of W.critters) k.calm = Math.max(k.calm, 8);
    S.hp = S.maxHp; S.mp = S.maxMp; const sp = W.L.spawn; player.position.set(sp[0], W.h(sp[0], sp[2]), sp[2]); hudUpdate();
  }
  function battleStep(dt) {
    B.t += dt; B.shield = Math.max(0, B.shield - dt);
    B.ring.children[0].material.opacity = 0.4 + 0.2 * Math.sin(B.t * 4);
    if (Math.hypot(player.position.x - B.c.x, player.position.z - B.c.z) > B.r + 0.3) { if (B.boss) { const d = new THREE.Vector3(B.c.x - player.position.x, 0, B.c.z - player.position.z).normalize(); player.position.addScaledVector(d, 0.6); toast('Krogbold blocks the way! "No running off now!"', 1200); } else return flee(); }
    for (const f of B.foes) {
      if (f.hp <= 0) continue;
      const to = new THREE.Vector3().subVectors(player.position, f.obj.position); to.y = 0; const d = to.length();
      f.obj.rotation.y = Math.atan2(to.x, to.z);
      f.cd -= dt; f.vuln = Math.max(0, (f.vuln || 0) - dt);
      if (f.boss) { bossStep(f, dt, d, to); continue; }
      if (d > 1.3) { f.obj.position.addScaledVector(to.normalize(), Math.min(d - 1.3, 2.2 * dt)); f.obj.position.y = W.h(f.obj.position.x, f.obj.position.z); f.anim && f.anim.name !== 'hit' && f.anim.play('move', 0.15); }
      else if (f.cd <= 0) { f.cd = 1.6 + R(); f.anim && f.anim.play('attack', 0.05, true); setTimeout(() => { if (B && f.hp > 0 && f.obj.position.distanceTo(player.position) < 1.9) hurtPlayer(f.atk + Math.floor(R() * 2), f); }, 350); }
    }
    for (const s of B.shots || []) { s.t += dt; const u = Math.min(1, s.t / s.T); s.obj.position.lerpVectors(s.a, s.b, u); s.obj.position.y += Math.sin(u * Math.PI) * 3; s.obj.rotation.y += dt * 12;
      if (u >= 1 && !s.done) { s.done = true; sfx('lid_clank', 0.6); if (s.obj.position.distanceTo(player.position) < 1.5) hurtPlayer(s.dmg, 'lid'); setTimeout(() => W.g.remove(s.obj), 400); } }
    for (const w of B.waves || []) { w.t += dt; const rr = w.t * 7; w.obj.scale.setScalar(Math.max(0.01, rr)); w.obj.material.opacity = Math.max(0, 0.8 - w.t * 0.5);
      const pd = Math.hypot(player.position.x - w.x, player.position.z - w.z); if (!w.hit && Math.abs(pd - rr) < 0.7 && G.py < 0.3) { w.hit = true; hurtPlayer(w.dmg, 'stomp'); } }
  }
  function bossStep(f, dt, d, to) {
    const bs = game.boss, ph = bs.phases[f.phase - 1], fast = f.phase === 2 ? 0.7 : 1;
    if (!f.move) {
      if (d > 3.2) { f.obj.position.addScaledVector(to.normalize(), Math.min(d - 3, 2.4 * dt / fast)); f.obj.position.y = W.h(f.obj.position.x, f.obj.position.z); dA && dA.play('walk', 0.2); }
      else dA && dA.play('idle', 0.2);
      if (f.cd <= 0) { const opts = ['toss', 'stomp', f.phase === 2 ? 'huff' : 'toss']; f.move = { k: opts[Math.floor(R() * opts.length)], t: 0 }; toast(`<small>Krogbold ${ph.tell}...</small>`, 900); if (R() < 0.4) floatText(camera, dwarf.position.clone().add(new THREE.Vector3(0, 3, 0)), bs.taunts[Math.floor(R() * bs.taunts.length)], 'float mg-shout'); }
      return;
    }
    const mv = f.move; mv.t += dt;
    if (mv.t < 0.9 * fast) { dA && dA.play('cast', 0.1); return; }
    if (!mv.fired) {
      mv.fired = true; const m0 = bs.moves[mv.k === 'toss' ? 0 : mv.k === 'huff' ? 1 : 2]; const dmg = m0.dmg[0] + Math.floor(R() * (m0.dmg[1] - m0.dmg[0] + 1));
      dA && dA.play('attack', 0.05, true);
      if (mv.k === 'toss') { const n = f.phase === 2 ? 2 : 1; for (let k = 0; k < n; k++) load('models/spring_lid.glb').then((m) => { m.scale.setScalar(0.7); W.g.add(m); const b = player.position.clone(); b.x += (k - (n - 1) / 2) * 1.6; B && B.shots.push({ obj: m, a: dwarf.position.clone().add(new THREE.Vector3(0, 1.6, 0)), b, t: 0, T: 1.1, dmg }); }); toast('<small>Lid Toss! Dodge!</small>', 900); }
      if (mv.k === 'stomp') { const w = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color: '#ffd080', transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false })); w.rotation.x = -Math.PI / 2; w.position.set(dwarf.position.x, W.h(dwarf.position.x, dwarf.position.z) + 0.15, dwarf.position.z); W.g.add(w); B.waves.push({ obj: w, t: 0, x: w.position.x, z: w.position.z, dmg }); sfx('hat_bonk', 0.8); f.vuln = 2.5; toast('<small>Anvil Stomp! Jump (Space) over the wave! Then hit him while he wobbles.</small>', 1600); }
      if (mv.k === 'huff') { sfx('spore_puff', 0.8); const fx = makeVFX({ template: 'spore_cloud', color: '#d8d0c8', color2: '#ffffff', count: 14, life: 1.2, radius: 2.2, height: 1.5, seed: 9 }, dwarf.position.clone().add(new THREE.Vector3(0, 1.2, 0)), player.position.clone()); scene.add(fx.group); fxList.push(fx); setTimeout(() => { if (B && d < 5.5) hurtPlayer(dmg, 'huff'); }, 500); }
    }
    if (mv.t > 1.8 * fast) { f.move = null; f.cd = (2.2 + R()) * fast; }
  }

  // ---------- the dwarf chase (marsh)
  let C = null;
  function startChase() {
    if (C || S.flags.chase_escaped || W.id !== 'L3') return;
    const p = player.position, back = new THREE.Vector3(Math.sin(G.cy), 0, Math.cos(G.cy)).multiplyScalar(-16);
    dwarf.visible = true; dwarf.position.set(p.x - back.x * -1, 0, p.z - back.z * -1); dwarf.position.add(new THREE.Vector3(0, 0, 0));
    dwarf.position.set(clamp(p.x + back.x, -50, 50), 0, clamp(p.z + back.z, -50, 50)); dwarf.position.y = W.h(dwarf.position.x, dwarf.position.z);
    C = { t: 0, shout: 1.2, k: 0 }; music.play('chase'); sfx('dwarf_grumble', 0.9);
    toast(`${game.hints.chase}`, 3600);
  }
  function chaseStep(dt) {
    C.t += dt; C.shout -= dt;
    const to = new THREE.Vector3().subVectors(player.position, dwarf.position); to.y = 0; const d = to.length();
    const sp = game.boss.chase.speed * (C.t < 2 ? 0.5 : 1);
    dwarf.position.addScaledVector(to.normalize(), Math.min(d, sp * dt)); dwarf.position.y = Math.max(W.h(dwarf.position.x, dwarf.position.z), W.L.water_level - 0.4);
    dwarf.rotation.y = Math.atan2(to.x, to.z); dA && dA.play('run', 0.2);
    if (C.shout <= 0) { C.shout = 3.6; const sh = game.boss.chase.shouts; floatText(camera, dwarf.position.clone().add(new THREE.Vector3(0, 3, 0)), sh[C.k++ % sh.length], 'float mg-shout'); sfx('dwarf_grumble', 0.6); }
    if (d < game.boss.chase.catch_radius) {
      sfx('lid_clank', 0.6); toast('Krogbold scoops you up... and plonks you back down by the reeds. "And STAY out!"<br><small>Try again: run for the rift behind where you arrived!</small>', 3400);
      S.hp = Math.max(1, S.hp - 4); hudUpdate();
      const s7 = W.springs.find((s) => s.found) || W.springs[0]; player.position.set(s7.pos[0] + 2, 0, s7.pos[2] + 2); player.position.y = W.h(player.position.x, player.position.z);
      dwarf.position.set(player.position.x - 14, 0, player.position.z - 10); C.t = 0;
    }
  }
  function endChase() { C = null; dwarf.visible = false; }

  // ---------- spring discovery
  function discover(sp) {
    sp.found = true; S.springs[sp.id] = true; const rw = sp.info.reward || {};
    setMode('spring'); G.closeup = sp; player.visible = false; music.play('spring', { loop: false }); sfx('spring_chime', 0.8); setTimeout(() => sfx('bubble_pop', 0.6), 500);
    if (rw.type === 'spell') learn(rw.spell_id);
    if (rw.type === 'map') S.revealed[rw.region] = true;
    if (rw.type === 'max_hp') S.maxHp += rw.amount;
    if (rw.type === 'max_mp') S.maxMp += rw.amount;
    S.hp = S.maxHp; S.mp = S.maxMp;
    progress();
    if (S.springs.spring2 && S.springs.spring3 && !S.spells.includes(springs.spellbook.water)) setTimeout(() => learn(springs.spellbook.water), 200);
    G.dlgLines = { speaker: sp.info.name, lines: sp.info.found_lines };
    D.tree = '__spring'; game.trees.__spring = { branches: [{}], nodes: { start: { speaker: sp.info.name, lines: sp.info.found_lines, end: true } } };
    dlgEl.classList.remove('hide'); dlgEl.querySelector('.por').src = U + 'ic_bubble.png'; D.onEnd = () => { G.closeup = null; player.visible = true; music.play(W.L.music || 'overworld'); save(true); toast(`Saved! &nbsp; Springs ${nSprings()}/${springs.springs.length}`); if (W.id === 'L3' && !S.flags.chase_escaped) setTimeout(startChase, 600); };
    showNode('start'); G.mode = 'dialog';
  }

  // ---------- travel
  async function goLevel(id, pos, fromExitOf) {
    fadeEl.classList.add('on'); G.mode = 'fade';
    if (C) endChase();
    await new Promise((r) => setTimeout(r, Q.get('scene') ? 0 : 350));
    for (const s of (W ? W.springs : [])) s.fizz.pause(); for (const f of (W ? W.falls : [])) f.roar.pause();
    await buildLevel(id); S.level = id;
    const L = W.L; let p = pos ? P3(pos) : P3(L.spawn);
    if (fromExitOf) { const gp = L.portals.find((q) => q.level === fromExitOf); if (gp) { const dir = new THREE.Vector3(-gp.pos[0], 0, -gp.pos[2]).normalize(); p = P3(gp.pos).addScaledVector(dir, 4.5); } }
    player.position.copy(p); player.position.y = W.h(p.x, p.z); G.py = 0; G.vy = 0;
    G.cy = id === 'HUB' && !fromExitOf ? 0 : Math.atan2(-player.position.x, -player.position.z) + Math.PI;
    if (id !== 'HUB' && !fromExitOf) G.cy = 0;
    if (S.flags.met_fox && !L.fox) { fox.position.copy(player.position).add(new THREE.Vector3(2.2, 0, -0.6)); fox.visible = true; }
    if (G.riding) { fox.visible = true; }
    music.play(L.music || 'overworld'); setMode('field'); progress();
    fadeEl.classList.remove('on');
    if (id === 'L3' && !S.flags.chase_escaped && ['spring6', 'spring7', 'spring8'].some((k) => S.springs[k])) setTimeout(startChase, 1500);
  }

  // ---------- mode + field
  G = { mode: 'boot', lock: null, lockNo: null, camIdle: 9, moveT: 0, zoom: 1, walk: false, cy: 0, cp: 0.32, py: 0, vy: 0, riding: false, swinging: false, flash: 0, closeup: null, introNext: null, noenc: !!Q.get('noenc'), bathCd: 0, stepT: 0 };
  function setMode(m) {
    G.mode = m; G.modeAt = performance.now(); hud.dataset.mode = m; const field = m === 'field' || m === 'battle'; input.menu = !field; fsBtn.classList.toggle('hide', !field);
    for (const b of fieldBtns) b.classList.toggle('hide', !field);
    joy.classList.toggle('hide', !field); if (!field) { if (joyId !== null) joyEnd(); joyT = null; joyV = null; } if (m !== 'field') promptEl.classList.add('hide'); questEl.classList.toggle('hide', m !== 'field'); vit.classList.toggle('hide', m === 'title' || m === 'ending' || m === 'intro');
  }
  const near = (o, r) => Math.hypot(o.x - player.position.x, o.z - player.position.z) < r;
  function interactTarget() {
    if (W.swing && !G.riding) { const sw = W.swing; const sx = sw.pivot[0] + Math.sin(sw.rot) * 0, sz = sw.pivot[2]; if (Math.hypot(sx - player.position.x, sz - player.position.z) < 2.4) return { k: 'swing', label: 'Swing on the rope' }; }
    for (const n of W.npcs) if (near(n.obj.position, 2.3)) return { k: 'npc', n, label: `Talk to ${n.name}` };
    for (const c of W.chests) if (!S.chests[c.id] && near(c.obj.position, 2)) return { k: 'chest', c, label: 'Open the chest' };
    if (W.id === 'BOSS' && dwarf.visible && S.flags.boss_beaten && near(dwarf.position, 3.4)) return { k: 'boss', label: 'Talk to Krogbold' };
    if (W.id === 'BOSS' && W.lid && S.flags.reconciled && near(W.lid.position, 4)) return { k: 'lid', label: 'Lift the great lid together!' };
    if (S.flags.met_fox && !S.flags.rode_fox && fox.visible && !G.riding && near(fox.position, 2.4)) return { k: 'fox', label: `Ride ${game.fox.name}` };
    return null;
  }
  function interact(t) {
    if (!t) return;
    if (t.k === 'npc') { t.n.anim && t.n.anim.play('talk', 0.2); t.n.obj.lookAt(player.position.x, t.n.obj.position.y, player.position.z); talk(t.n.id, () => t.n.anim && t.n.anim.play('idle', 0.3)); }
    if (t.k === 'chest') { S.chests[t.c.id] = true; sfx('chest_open', 0.7); t.c.obj.rotation.z = 0.2; give({ item: t.c.item }); S.mp = S.maxMp; hudUpdate(); }
    if (t.k === 'boss') { dwarf.lookAt(player.position.x, dwarf.position.y, player.position.z); talk('boss'); }
    if (t.k === 'lid') liftLid();
    if (t.k === 'swing') mountSwing();
    if (t.k === 'fox') toggleRide();
  }
  function toggleRide() {
    if (G.swinging) return;
    if (G.riding) { G.riding = false; player.position.x += 1.0; player.position.y = W.h(player.position.x, player.position.z); sfx('fox_yip', 0.4); pA && pA.play('idle', 0.2); return; }
    if (!S.flags.met_fox) { toast(`Maybe Little Toffle can introduce you to ${game.fox.name}.`); return; }
    if (!near(fox.position, 2.6)) { toast(`Stand next to ${game.fox.name} to hop on.`, 1400); return; }
    G.riding = true; S.flags.rode_fox = true; sfx('fox_yip', 0.7); pA && pA.play('ride', 0.2); progress();
  }
  function mountSwing() { const sw = W.swing; G.swinging = true; sw.on = true; sw.ang = 0.25; sw.vel = 0; sfx('swing_creak', 0.6); toast(input.scheme === 'pad' ? `${gk('move')} left / right to pump &middot; ${gk('jump')} to let go` : input.scheme === 'touch' ? 'Slide left / right to pump &middot; jump to let go' : 'A/D or left/right to pump &middot; Space / E to let go', 2200); pA && pA.play('swing', 0.2); }
  function swingStep(dt) {
    const sw = W.swing, ax = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + (joyV ? joyV.x : 0) + input.move.x;
    sw.vel += (-9.8 / sw.seat_drop * Math.sin(sw.ang) + ax * 1.6 * Math.sign(Math.cos(sw.ang) * (sw.vel || 1))) * dt; sw.vel *= 0.995; sw.ang = clamp(sw.ang + sw.vel * dt, -1.25, 1.25);
    if (Math.abs(sw.vel) > 1.2 && Math.abs(sw.ang) < 0.08) sfx('swing_creak', 0.35);
    sw.obj.rotation.set(sw.ang, sw.rot, 0, 'YXZ');
    const off = new THREE.Vector3(0, -sw.seat_drop * Math.cos(sw.ang), -sw.seat_drop * Math.sin(sw.ang)).applyAxisAngle(new THREE.Vector3(0, 1, 0), sw.rot);
    player.position.copy(P3(sw.pivot)).add(off); player.position.y += 0.02; player.rotation.y = sw.rot;
  }
  function leaveSwing() {
    const sw = W.swing; G.swinging = false; sw.on = false;
    const dir = new THREE.Vector3(0, 0, -Math.sign(sw.vel) || 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), sw.rot);
    G.launch = dir.multiplyScalar(Math.min(9, Math.abs(sw.vel) * sw.seat_drop * 0.9)); G.vy = 4 + Math.abs(sw.vel); G.py = player.position.y - W.h(player.position.x, player.position.z);
    S.flags.swung = true; sfx('gnome_giggle', 0.6); sw.obj.rotation.set(0, sw.rot, 0, 'YXZ'); pA && pA.play('jump', 0.1, true);
  }
  function liftLid() {
    setMode('cutscene'); sfx('lid_clank', 0.8); dwarf.position.set(W.lid.position.x - 2.2, W.h(W.lid.position.x - 2.2, W.lid.position.z), W.lid.position.z); dwarf.lookAt(W.lid.position);
    let t = 0; const y0 = W.lid.position.y; W.mother.g.visible = true;
    G.cut = (dt) => { t += dt; W.lid.position.y = y0 + Math.min(2.5, t * 1.4); W.lid.position.x = Math.max(-4, -t * 1.6 + (t > 1.6 ? -(t - 1.6) * 1.5 : 0)); W.lid.rotation.z = Math.min(1.2, t * 0.6);
      if (t > 1.5 && !G.cutChime) { G.cutChime = true; sfx('spring_chime', 0.9); sfx('bubble_pop', 0.6); }
      if (t > 4.2) { G.cut = null; S.flags.ending = true; save(true); showEnding(); } };
  }
  function moveField(dt) {
    let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0), iz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    if (joyV) { ix += joyV.x; iz += joyV.y; }
    ix += input.move.x; iz += input.move.y;
    const l = Math.hypot(ix, iz); if (l > 1) { ix /= l; iz /= l; }
    const fwd = new THREE.Vector3(-Math.sin(G.cy), 0, -Math.cos(G.cy)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const mv = new THREE.Vector3().addScaledVector(right, ix).addScaledVector(fwd, -iz);
    const lockT = G.lock && !G.riding && !G.launch ? G.lock.e.obj.position : null;
    const speed = (G.walk ? 0.45 : 1) * (G.riding ? 5.2 * game.fox.speed : 5.0) * (W.id === 'L3' && W.h(player.position.x, player.position.z) < W.L.water_level && !G.riding ? 0.75 : 1);
    if (G.launch) { mv.copy(G.launch).multiplyScalar(1 / speed); G.launch.multiplyScalar(0.985); }
    const moving = mv.lengthSq() > 0.01;
    if (moving) {
      const step = mv.clone().multiplyScalar(speed * dt); let nx = player.position.x + step.x, nz = player.position.z + step.z;
      if (lockT) { const q = strafe(player.position, lockT, ix, iz, speed * dt, B ? 1.4 : 1.6); nx = q.x; nz = q.z; }  // circle the locked target
      const lim = W.L.size * 0.44; nx = clamp(nx, -lim, lim); nz = clamp(nz, -lim, lim);
      const wet = W.id !== 'L3' && W.L.water_level > -40 && W.h(nx, nz) < W.L.water_level - 0.35;
      if (!wet) { for (const c of W.cols) { const dx = nx - c.x, dz = nz - c.z, d = Math.hypot(dx, dz), rr = c.r + 0.35; if (d < rr && d > 1e-4) { nx = c.x + dx / d * rr; nz = c.z + dz / d * rr; } } player.position.x = nx; player.position.z = nz; }
      if (!G.launch && !lockT) player.rotation.y = Math.atan2(mv.x, mv.z);
      G.stepT -= dt; if (G.stepT <= 0) { G.stepT = G.riding ? 0.22 : 0.34; sfx(G.riding ? 'footstep_moss' : 'waddle_step', 0.18); }
    }
    G.moveT = moving ? G.moveT + dt : 0;
    if (lockT) player.rotation.y = Math.atan2(lockT.x - player.position.x, lockT.z - player.position.z);  // always face the target
    G.vy -= 18 * dt; G.py = Math.max(0, G.py + G.vy * dt); if (G.py <= 0) { G.vy = 0; if (G.launch) G.launch = null; }
    const gy = Math.max(W.h(player.position.x, player.position.z), W.id === 'L3' ? W.L.water_level - 0.45 : -99);
    player.position.y = gy + G.py + (G.riding ? 0.62 : 0);
    if (pA && !['hit', 'attack', 'cast', 'jump'].includes(pA.name) || (pA && pA.cur && !pA.cur.isRunning())) pA && pA.play(G.riding ? 'ride' : moving ? 'waddle' : 'idle', 0.18);
    // fox follows (or carries)
    if (fox.visible) {
      if (G.riding) { fox.position.set(player.position.x, gy, player.position.z); fox.rotation.y = player.rotation.y; fA && fA.play(moving ? 'move' : 'idle', 0.15); if (fA && fA.cur) fA.cur.timeScale = moving ? 1.6 : 1; }
      else if (S.flags.met_fox) { const side = new THREE.Vector3(Math.cos(G.cy), 0, -Math.sin(G.cy)).multiplyScalar(2.2).add(new THREE.Vector3(-Math.sin(G.cy), 0, -Math.cos(G.cy)).multiplyScalar(0.6));
        const goal = player.position.clone().add(side); const to = new THREE.Vector3().subVectors(goal, fox.position); to.y = 0; const d = to.length();
        if (d > 0.6) { fox.position.addScaledVector(to.normalize(), Math.min(d, (d > 4 ? 8 : 5.5) * dt)); fox.rotation.y = Math.atan2(to.x, to.z); fA && fA.play('move', 0.2); } else fA && fA.play('idle', 0.3);
        fox.position.y = Math.max(W.h(fox.position.x, fox.position.z), W.id === 'L3' ? W.L.water_level - 0.45 : -99); }
    }
  }
  function fieldChecks(dt) {
    // portals
    for (const p of W.portals) if (p.gate && near({ x: p.pos[0], z: p.pos[2] }, p.type === 'spore_ring' ? 2.4 : 1.8)) {
      const ok = (!p.requires_flag || S.flags[p.requires_flag]) && nSprings() >= (p.requires_springs || 0);
      if (!ok) { if (!G.lockT || G.lockT < 0) { G.lockT = 2.5; sfx('miss', 0.4); toast(`${p.name}: the ${p.type === 'spore_ring' ? 'spore ring' : 'root arch'} is sleeping.<br><small>${p.requires_springs ? `Wake ${p.requires_springs} springs, then ask Grandpa Femble.` : (currentQuest() || {}).goal || ''}</small>`, 2600); } continue; }
      sfx('portal_whoosh', 0.7); G.riding = G.riding && true; goLevel(p.level); return;
    }
    G.lockT = (G.lockT || 0) - dt;
    if (W.exit && near({ x: W.exit.x, z: W.exit.z }, 2.2)) { sfx('portal_whoosh', 0.7); const from = W.id; if (C) { S.flags.chase_escaped = true; toast('You got away! Krogbold stomps off, grumbling.', 3000); sfx('escape', 0.7); } goLevel('HUB', null, from); return; }
    // springs: fizz volume by distance, discovery, bathing
    G.bathCd -= dt;
    for (const s of W.springs) {
      if (s.isMother) continue;
      const d = Math.hypot(s.pos[0] - player.position.x, s.pos[2] - player.position.z);
      s.fizz.volume = clamp(Math.pow(clamp(1 - d / 24, 0, 1), 2) * (s.found ? 0.35 : 0.7), 0, 1);
      if (s.fizz.volume > 0.01 && s.fizz.paused) s.fizz.play().catch(() => {}); else if (s.fizz.volume <= 0.01 && !s.fizz.paused) s.fizz.pause();
      if (d < s.r + 0.6 && Math.abs(player.position.y - s.pos[1]) < 2) { if (!s.found) return discover(s); if (G.bathCd <= 0 && (S.hp < S.maxHp || S.mp < S.maxMp)) { G.bathCd = 4; healFull(); toast('The spring fizzes you back to full!', 1600); } }
    }
    for (const f of W.falls) { const d = Math.hypot(f.pos[0] - player.position.x, f.pos[2] - player.position.z); f.roar.volume = clamp(1 - d / 26, 0, 1) * 0.35; if (f.roar.volume > 0.01 && f.roar.paused) f.roar.play().catch(() => {}); }
    // pickups
    for (const c of W.pick) if (!c.got && near(c.obj.position, 1.2)) { c.got = true; c.obj.visible = false; S.chests[`${W.id}:${c.pos.join(',')}`] = true; if (c.type === 'health') { S.hp = Math.min(S.maxHp, S.hp + 10); sfx('inn_rest', 0.4); toast('+10 HP'); } else { S.xp += 5; S.mp = Math.min(S.maxMp, S.mp + 4); sfx('coin', 0.5); toast(`${c.name} &middot; +4 MP`); } hudUpdate(); }
    // critters wander; touching a cross one opens the ring
    for (const k of W.critters) {
      if (k.gone) continue; k.calm -= dt; k.ph += dt;
      const toP = Math.hypot(k.obj.position.x - player.position.x, k.obj.position.z - player.position.z);
      const chase = toP < 7 && k.calm <= 0 && !G.noenc && !C;
      const tx = chase ? player.position.x : k.home.x + Math.cos(k.ph * 0.4) * (k.patrol_radius || 4) * 0.6, tz = chase ? player.position.z : k.home.z + Math.sin(k.ph * 0.4) * (k.patrol_radius || 4) * 0.6;
      const d = Math.hypot(tx - k.obj.position.x, tz - k.obj.position.z);
      if (d > 0.3) { const sp = (chase ? 2.4 : 1.2) * dt; k.obj.position.x += (tx - k.obj.position.x) / d * Math.min(d, sp); k.obj.position.z += (tz - k.obj.position.z) / d * Math.min(d, sp); k.obj.rotation.y = Math.atan2(tx - k.obj.position.x, tz - k.obj.position.z); }
      k.obj.position.y = Math.max(W.h(k.obj.position.x, k.obj.position.z), W.id === 'L3' ? W.L.water_level - 0.3 : -99) + (k.behaviour === 'flyer' ? 1.2 + Math.sin(k.ph * 2) * 0.3 : 0);
      if (chase && toP < 1.3) return startBattle(k);
    }
    // boss forge: walk up to the dwarf to talk (first time)
    if (W.id === 'BOSS' && dwarf.visible && !S.flags.boss_beaten && near(dwarf.position, 7)) { dwarf.lookAt(player.position.x, dwarf.position.y, player.position.z); sfx('dwarf_grumble', 0.8); return talk('boss'); }
    const it = interactTarget();
    promptEl.classList.toggle('hide', !it); if (it) { const h = `${gl(it.k === 'fox' ? 'ride' : 'use')} ${it.label}`; if (promptEl._h !== h) { promptEl._h = h; promptEl.innerHTML = h; } }
  }
  function animateWorld(dt, t) {
    for (const p of W.portals) { if (!p.fill) continue; const fr = Math.floor(t * portalsS.fps) % portalsS.frames; p.fill.material.map.offset.x = fr / portalsS.frames; if (p.spin) p.fill.rotation.z += dt * 0.4; if (p.gate) { const ok = (!p.requires_flag || S.flags[p.requires_flag]) && nSprings() >= (p.requires_springs || 0); p.fill.material.opacity = ok ? 0.95 : 0.25; } }
    if (W.water) { W.water.offset.x = t * 0.01; W.water.offset.y = t * 0.015; }
    for (const s of W.springs) {
      if (s.g.visible && s.g.position.distanceTo(camera.position) < 70) s.pool.update(dt, t);
      if (s.hintRift) { s.hintRift.visible = !s.found; s.hintRift.lookAt(camera.position.x, s.g.position.y + 1.6, camera.position.z); s.hintRift.material.opacity = 0.35 + 0.15 * Math.sin(t * 2); }
    }
    for (const f of W.falls) { f.wt.offset.y = t * 1.2; for (const p of f.foam) { const u = p.userData; u.t += 0.02; if (u.t > 1) u.t = 0; const c = Math.cos(f.rot), sn = Math.sin(f.rot);
      p.position.set(f.pos[0] + u.x * c, f.pos[1] + u.t * 1.6 - 0.2, f.pos[2] - u.x * sn + 0.4 * c); p.material.opacity = 0.55 * (1 - u.t); p.scale.setScalar(0.8 + u.t * 1.5); } }
    for (const s of W.amb.ff) { const u = s.userData; s.position.set(u.x + Math.sin(t * u.sp + u.ph) * 1.4, u.y + Math.sin(t * 1.3 + u.ph) * 0.5, u.z + Math.cos(t * u.sp * 0.8 + u.ph) * 1.4); s.material.opacity = 0.5 + 0.5 * Math.sin(t * 3 + u.ph); }
    for (const s of W.amb.sp) { const u = s.userData; s.position.set(u.x + Math.sin(t * 0.2 + u.ph) * 2, u.y + ((t * 0.15 * u.sp + u.ph) % 3), u.z + Math.cos(t * 0.17 + u.ph) * 2); }
    for (const b of W.amb.sb) b.material.opacity = 0.08 + 0.05 * Math.sin(t * 0.6 + b.userData.ph);
    for (const m of W.amb.mist) { const u = m.userData; m.position.x = u.x + Math.sin(t * 0.05 + u.ph) * 4; }
    for (const e of W.amb.em) { const u = e.userData; e.position.set(u.x + Math.sin(t + u.ph) * 0.5, u.y + ((t * 0.8 * u.sp + u.ph) % 4), u.z); e.material.opacity = 0.9 - ((t * 0.8 * u.sp + u.ph) % 4) / 4.4; }
    for (const n of W.npcs) { n.mark.visible = !S.talked[n.id] || (currentQuest() && currentQuest().giver === n.id); n.mark.position.y = 1.9 + Math.sin(t * 3) * 0.08; }
    for (const c of W.pick) if (!c.got) { c.obj.rotation.y = t * 1.5; c.obj.position.y = c.base + Math.sin(t * 2) * 0.15; }
    for (const fn of W.anims) fn(t);
    if (W.mother) W.mother.g.visible = S.flags.ending || !!G.cut || W.mother.g.visible && G.mode === 'ending';
    for (let i = fxList.length - 1; i >= 0; i--) if (fxList[i].step(dt)) { fxList[i].dispose(); fxList.splice(i, 1); }
  }

  // ---------- input dispatch
  const PADMENU = { PadUp: 'ArrowUp', PadDown: 'ArrowDown', PadLeft: 'ArrowLeft', PadRight: 'ArrowRight' };
  const PADFIELD = { PadUp: 'KeyH', PadDown: 'KeyR', PadLeft: 'SpellPrev', PadRight: 'SpellNext' };
  const jump = () => { if (G.py <= 0.01) { G.vy = G.riding ? 7 : 6.2; sfx('jump', 0.4); pA && pA.play('jump', 0.05, true); } };
  function handleKeys() {
    const ks = [...takePressed(), ...injected.splice(0)];
    for (let k of ks) {
      const m = G.mode, play = m === 'field' || m === 'battle';
      k = (play ? PADFIELD[k] : PADMENU[k]) || k;
      if (k === 'Backquote' || k === 'Fullscreen') {  // ` key / Start+Select: fullscreen (undo a pause / map the combo's first button just opened)
        if (k === 'Fullscreen' && (m === 'menu' || m === 'map') && performance.now() - G.modeAt < 900) { if (m === 'menu') closeMenu(); else closeMap(); }
        display.toggleFS(); continue; }
      if (k === 'CamToggle' || k === 'KeyC') { if (play) toggleCam(); continue; }
      if (k === 'LockOn' || k === 'KeyT' || k === 'ClickLock') { if (play) lockPress(); continue; }
      if (m === 'title') { const nT = titleEl.querySelectorAll('.mi').length || 2, dT = ['ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA'].includes(k) ? -1 : ['ArrowDown', 'KeyS', 'ArrowRight', 'KeyD'].includes(k) ? 1 : 0;
        if (dT) { titleSel = (titleSel + dT + nT) % nT; drawTitleSel(); sfx('menu_tick', 0.4); } if (['Enter', 'Space', 'KeyE'].includes(k)) titlePick(); continue; }
      if (m === 'intro' || m === 'ending') { if (['Enter', 'Space', 'KeyE', 'AltR'].includes(k)) G.introNext && G.introNext(); continue; }
      if (m === 'dialog') {
        const n = k.match(/^Digit([1-4])$/), no = dlgEl.querySelectorAll('.opt').length, ok = ['Enter', 'Space', 'KeyE', 'AltR', 'ClickAlt'].includes(k);
        if (n) choose(+n[1] - 1);
        else if (no && ['ArrowUp', 'KeyW', 'ArrowLeft'].includes(k)) { D.opt = (D.opt + no - 1) % no; drawOpt(); sfx('menu_tick', 0.3); }
        else if (no && ['ArrowDown', 'KeyS', 'ArrowRight'].includes(k)) { D.opt = (D.opt + 1) % no; drawOpt(); sfx('menu_tick', 0.3); }
        else if (no && ok) choose(D.opt);
        else if (ok) advance();
        else if (k === 'Escape' && D.typing) finishLine();
        continue;
      }
      if (m === 'map') { if (['KeyM', 'Escape', 'KeyE', 'Space', 'Tab', 'Enter'].includes(k)) closeMap(); continue; }
      if (m === 'menu') {
        if (menuPage === 'settings') { settingsKey(k); continue; }
        if (menuPage !== 'main') { if (['Escape', 'KeyP', 'Enter', 'Space', 'Backspace', 'KeyE'].includes(k)) menuBack(); else if (['ArrowUp', 'ArrowDown'].includes(k)) { menuEl.scrollTop += k === 'ArrowUp' ? -40 : 40; } continue; }
        if (k === 'ArrowUp' || k === 'KeyW') { menuSel = (menuSel + MENU.length - 1) % MENU.length; drawMenu(); sfx('menu_tick', 0.3); }
        if (k === 'ArrowDown' || k === 'KeyS') { menuSel = (menuSel + 1) % MENU.length; drawMenu(); sfx('menu_tick', 0.3); }
        if (k === 'Enter' || k === 'Space' || k === 'KeyE') menuPick();
        if (k === 'KeyP' || k === 'Escape') closeMenu();
        continue;
      }
      if (!play) continue;
      if (k === 'WalkToggle' || k === 'ShiftLeft' || k === 'ShiftRight') { G.walk = !G.walk; toast(G.walk ? 'Walking' : 'Running', 700); continue; }
      if (m === 'battle') {
        const n = k.match(/^Digit([1-6])$/); if (n) { selSpell = +n[1] - 1; cast(selSpell); if (B) buildSpellBar(); }
        if (k === 'KeyF' || k === 'ClickAttack') bonk();
        if (k === 'SpellPrev' || k === 'KeyQ') cycleSpell(-1);
        if (k === 'SpellNext' || k === 'KeyR') cycleSpell(1);
        if (['AltR', 'Enter', 'CastSel', 'ClickAlt', 'KeyE'].includes(k)) cast(selSpell);
        if (k === 'Space') jump();
        if (k === 'KeyP' || k === 'Escape') toast('No pausing mid-scuffle!', 900);
        continue;
      }
      if (G.swinging) { if (['Space', 'KeyE', 'AltR', 'Enter'].includes(k)) leaveSwing(); continue; }
      if (k === 'Space') jump();
      if (['KeyE', 'Enter', 'AltR', 'ClickAlt'].includes(k)) interact(interactTarget());
      if (k === 'KeyR') toggleRide();
      if (k === 'KeyM' || k === 'Tab') openMap();
      if (k === 'KeyP' || k === 'Escape') openMenu();
      if (k === 'KeyH') hint();
      if (k === 'SpellPrev' || k === 'KeyQ') cycleSpell(-1);
      if (k === 'SpellNext') cycleSpell(1);
      if (k === 'KeyF' || /^Digit[1-6]$/.test(k) || k === 'CastSel') toast('Spells and bonks are for cross critters.', 1000);
    }
  }
  // ---------- Target Lock (auto when a cross critter comes close, or LT / T / middle-click / reticle button)
  const LOCK_AUTO = 6, LOCK_RANGE = 12, LOCK_BREAK = 15;
  const lockAlive = (e) => (B ? B.foes.includes(e) && e.hp > 0 : !e.gone && e.calm <= 0 && G.mode === 'field');
  function lockCands() {
    const list = B ? B.foes.filter((f) => f.hp > 0) : G.mode === 'field' ? W.critters.filter((k) => !k.gone && k.calm <= 0) : [];
    return list.map((e) => ({ e, pos: e.obj.position }));
  }
  function setLock(e, manual) {
    const was = G.lock; G.lock = e ? { e } : null; hud.classList.toggle('locked', !!e);
    if (e && (!was || was.e !== e)) sfx('menu_tick', 0.5); if (!e && was && manual) { G.lockNo = was.e; G.lockQuiet = performance.now() + 2500; }  // letting go means letting go
  }
  function lockPress() {
    const cands = lockCands(), cur = G.lock && cands.find((c) => c.e === G.lock.e);
    const nx = pickTarget(player.position, cands, LOCK_RANGE, cur || null);
    if (G.lock && !nx) return setLock(null, true);  // pressed again with nobody else in range: let go
    if (!nx) { toast('Nothing to lock on to', 700); return; }
    setLock(nx.e); G.lockNo = null;
  }
  function lockStep() {
    if (G.mode !== 'field' && G.mode !== 'battle') { if (G.lock) setLock(null); reticle.classList.add('hide'); return; }
    if (G.lock) { const e = G.lock.e; if (!lockAlive(e) || e.obj.position.distanceTo(player.position) > LOCK_BREAK) setLock(null); }
    if (G.lockNo && (!lockAlive(G.lockNo) || G.lockNo.obj.position.distanceTo(player.position) > LOCK_AUTO + 2)) G.lockNo = null;
    if (!G.lock && input.settings.autoLock !== false && !G.riding && !G.swinging && performance.now() > (G.lockQuiet || 0)) {
      const n = pickTarget(player.position, lockCands().filter((q) => q.e !== G.lockNo), B ? LOCK_RANGE : LOCK_AUTO); if (n) setLock(n.e);
    }
    if (G.lock) { const e = G.lock.e, v = e.obj.position.clone().add(new THREE.Vector3(0, e.boss ? 3.4 : 1.8, 0)).project(camera);
      reticle.style.left = `${(v.x + 1) * 50}%`; reticle.style.top = `${(1 - v.y) * 50}%`; reticle.classList.toggle('hide', v.z > 1); } else reticle.classList.add('hide');
  }
  function toggleCam(quiet) {
    input.settings.camMode = input.settings.camMode === 'free' ? 'follow' : 'free'; input.save(); G.camIdle = 9;
    if (!quiet) { toast(`Camera: ${input.settings.camMode === 'free' ? 'Free (moves only when you move it)' : 'Follow (swings in behind you)'}`, 1200); sfx('menu_tick', 0.4); }
  }
  function hint() {
    sfx('gnome_hum', 0.5);
    const un = W.springs.filter((s) => !s.found && !s.isMother).sort((a, b) => Math.hypot(a.pos[0] - player.position.x, a.pos[2] - player.position.z) - Math.hypot(b.pos[0] - player.position.x, b.pos[2] - player.position.z))[0];
    const q = currentQuest();
    if (un) { const dx = un.pos[0] - player.position.x, dz = un.pos[2] - player.position.z; const dir = `${dz < -4 ? 'north' : dz > 4 ? 'south' : ''}${dx < -4 ? (Math.abs(dz) > 4 ? '-west' : 'west') : dx > 4 ? (Math.abs(dz) > 4 ? '-east' : 'east') : ''}` || 'right here';
      toast(`<small>Hint</small><br>${game.hints.springs[un.id]}<br><small>(somewhere ${dir}; listen for the fizz)</small>`, 4200); }
    else toast(`<small>Hint</small><br>${q ? q.hint : 'Enjoy the fizzing springs!'}`, 4200);
  }

  // ---------- camera (third person; Z/C or mouse drag to orbit)
  let drag = null;
  // HUD buttons / dialog / menus stop propagation, so this only sees touches on the 3D view or the letterbox around it
  addEventListener('pointerdown', (e) => {
    if (!window.__loaded || (e.target.closest && e.target.closest('#bar, #loading'))) return;
    if (G.mode === 'dialog') { advance(); return; } if (G.mode === 'intro' || G.mode === 'ending') { G.introNext && G.introNext(); return; }
    if (e.pointerType === 'mouse') {
      if (e.button === 1) { e.preventDefault(); press('ClickLock'); return; }
      if (e.button === 2) { press('ClickAlt'); return; }
      if (input.settings.mouseLock && !G.mode.match(/title|menu|map/)) { if (input.locked) press('ClickAttack'); return; }  // the click itself grabs the pointer
    }
    if (e.pointerType !== 'mouse' && joyId === null && !joy.classList.contains('hide') && e.clientX < innerWidth / 3) { e.preventDefault(); joyStart(e, true); return; }
    if (!drag) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, mouse: e.pointerType === 'mouse' && e.button === 0 }; try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } }
  });
  for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, (e) => { if (drag && e.pointerId === drag.id) { if (ev === 'pointerup' && drag.mouse && drag.moved < 6) press('ClickAttack'); drag = null; } });
  addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });  // no autoscroll on middle-click
  addEventListener('pointermove', (e) => { if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y, sn = input.settings.sens, inv = input.settings.invertY ? -1 : 1;
    drag.moved += Math.abs(dx) + Math.abs(dy); if (drag.moved > 3) G.camIdle = 0; G.cy -= dx * 0.008 * sn; G.cp = clampPitch(G.cp + dy * 0.004 * sn * inv); drag.x = e.clientX; drag.y = e.clientY; });
  dlgEl.onpointerdown = (e) => { e.stopPropagation(); if (G.mode === 'dialog') advance(); };
  endEl.onpointerdown = (e) => { e.stopPropagation(); G.introNext && G.introNext(); };
  mapEl.onpointerdown = (e) => { e.stopPropagation(); closeMap(); };
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  function updateCamera(dt, t) {
    const sn = input.settings.sens, inv = input.settings.invertY ? -1 : 1; G.camIdle += dt;
    if (input.look.x || input.look.y) { G.cy -= input.look.x * 2.4 * sn * dt; G.cp = clampPitch(G.cp + input.look.y * 1.2 * sn * inv * dt); G.camIdle = 0; }
    if (input.mouse.dx || input.mouse.dy) { G.cy -= input.mouse.dx * 0.004 * sn; G.cp = clampPitch(G.cp + input.mouse.dy * 0.0025 * sn * inv); input.mouse.dx = input.mouse.dy = 0; G.camIdle = 0; }
    const lk = G.lock && (G.mode === 'field' || G.mode === 'battle') ? G.lock.e.obj.position : null;
    let pos, look, orbit = false;
    if (G.mode === 'title') { pos = new THREE.Vector3(Math.sin(t * 0.06) * 26, 13, Math.cos(t * 0.06) * 26 + 6); look = new THREE.Vector3(0, 4, 0); }
    else if (G.closeup) { const cu = G.closeup, s = cu.g.position, tight = cu.hide === 'hollow_log' || cu.hide === 'root_tunnel';
      const log = cu.hide === 'hollow_log', tun = cu.hide === 'root_tunnel';
      const ov = G.cuOv || {}, a = cu.camA + (ov.da ?? (tun ? 0.5 : 0)) + Math.sin(t * 0.3) * (tight ? 0.04 : 0.18), rr = ov.rr ?? (log ? 2.4 : tun ? cu.r + 0.85 : cu.r + 1.7);
      pos = new THREE.Vector3(s.x + Math.sin(a) * rr, s.y + (ov.h ?? (log ? 1.2 : tun ? 1.0 : 1.85)), s.z + Math.cos(a) * rr); look = new THREE.Vector3(s.x, s.y - (ov.ly ?? (log ? 0.25 : tun ? 0.3 : 0.8)), s.z); }
    else if (G.mode === 'dialog' && D.tree && D.tree !== '__spring') {
      const who = D.tree === 'boss' ? dwarf : (W.npcs.find((n) => n.id === D.tree) || {}).obj; const wp = who ? who.position : player.position;
      const mid = wp.clone().add(player.position).multiplyScalar(0.5); const side = new THREE.Vector3().subVectors(wp, player.position); side.y = 0; side.normalize();
      const perp = new THREE.Vector3(-side.z, 0, side.x); pos = mid.clone().addScaledVector(perp, D.tree === 'boss' ? 6.5 : 3.6).add(new THREE.Vector3(0, D.tree === 'boss' ? 2.2 : 1.25, 0)); look = mid.clone().add(new THREE.Vector3(0, D.tree === 'boss' ? 0.4 : -0.1, 0));
    }
    else if (G.mode === 'ending' && W.mother) { const m = W.mother.g.position; pos = new THREE.Vector3(m.x + 5.5 + Math.sin(t * 0.1), m.y + 3.2, m.z + 8.5); look = new THREE.Vector3(m.x - 0.5, m.y + 0.2, m.z); }
    else if (G.mode === 'cutscene' && W.lid) { pos = new THREE.Vector3(W.lid.position.x + 7, W.lid.position.y + 4, W.lid.position.z + 9); look = W.lid.position.clone(); }
    else if (lk) {  // Target Lock: from behind the player, framing player + target
      const dist = (B && B.boss ? 9.5 : 6.4) * (B ? 1 : G.zoom), f = lockFrame(player.position, lk, { dist, height: B && B.boss ? 4.2 : 2.5 });
      G.cy += wrapA(f.yaw - G.cy) * (1 - Math.exp(-dt * 5)); const p = player.position;
      pos = new THREE.Vector3(p.x + Math.sin(G.cy) * dist, p.y + (B && B.boss ? 4.2 : 2.5), p.z + Math.cos(G.cy) * dist); look = new THREE.Vector3(f.look.x, f.look.y, f.look.z); orbit = true; }
    else if (B) { const c = B.c; const tp = B.boss ? dwarf.position : player.position; const dist = B.boss ? 12 : 7.8; pos = new THREE.Vector3(c.x + Math.sin(G.cy) * dist, W.h(c.x, c.z) + (B.boss ? 7 : 4.2), c.z + Math.cos(G.cy) * dist); look = c.clone().lerp(tp, 0.3).add(new THREE.Vector3(0, 1, 0)); }
    else {
      if (input.settings.camMode !== 'free' && G.mode === 'field' && !G.swinging) {  // Follow: ease round behind the gnome
        G.cy = followYaw(G.cy, { facing: player.rotation.y, moving: G.moveT > 0, moveT: G.moveT, idle: G.camIdle, dt });
        if (G.camIdle > 1.5 && (G.moveT > 0 || G.cp > PITCH.low)) G.cp += (PITCH.rest - G.cp) * (1 - Math.exp(-dt * 1.2));  // a look up into the trees holds until you walk on
      }
      const dist = (G.swinging ? 7.5 : 6.8) * G.zoom; const p = player.position; pos = new THREE.Vector3(p.x + Math.sin(G.cy) * dist * Math.cos(G.cp), p.y + 1.4 + dist * Math.sin(G.cp), p.z + Math.cos(G.cy) * dist * Math.cos(G.cp)); look = p.clone().add(new THREE.Vector3(0, 1.1, 0)); orbit = true; }
    if (orbit && G.cp < PITCH.low) { const r = lookUp(pos, look, player.position, upAmount(G.cp), { h: W.h, tilt: lk ? 0.3 : 0.4 /* lock: a little less; the letterbox bars eat the frame edges */ }); pos.set(r.pos.x, r.pos.y, r.pos.z); look.set(r.look.x, r.look.y, r.look.z); }
    const gy = W.h(pos.x, pos.z) + 0.8; if (pos.y < gy) pos.y = gy;
    const k = G.snap ? 1 : 1 - Math.pow(0.002, dt); G.snap = false;
    camPos.lerp(pos, k); camLook.lerp(look, k); camera.position.copy(camPos); camera.lookAt(camLook);
    sky.position.copy(camera.position);
  }

  // ---------- main loop
  const st = loop(renderer, scene, () => camera, (dt, t) => {
    if (!W) return;
    handleKeys();
    joySmooth(dt); lockStep();
    if (input.mouse.wheel) { const w = input.mouse.wheel; input.mouse.wheel = 0; if (G.mode === 'battle') cycleSpell(w > 0 ? 1 : -1); else if (G.mode === 'field') G.zoom = clamp(G.zoom * (w > 0 ? 1.1 : 0.9), 0.55, 1.7); }
    if (G.mode === 'field') { if (G.swinging) swingStep(dt); else moveField(dt); if (C) chaseStep(dt); if (G.mode === 'field' && !G.swinging) fieldChecks(dt); }
    else if (G.mode === 'battle' && B) { moveField(dt); battleStep(dt); }
    if (G.cut) G.cut(dt);
    if (W.swing && !W.swing.on) { W.swing.obj.rotation.set(Math.sin(t * 0.8) * 0.06, W.swing.rot, 0, 'YXZ'); }
    if (G.mode === 'field' || G.mode === 'battle') S.time += dt;
    timerEl.querySelector('span').textContent = fmtTime(S.time);
    if (G.flash > 0) { G.flash -= dt; hud.style.boxShadow = `inset 0 0 ${60 * G.flash * 4}px rgba(232,72,60,${G.flash * 2})`; } else hud.style.boxShadow = '';
    animateWorld(dt, t); updateCamera(dt, t); mini.update(dt, t);
    hudUpdate.t = (hudUpdate.t || 0) + dt; if (hudUpdate.t > 0.25) { hudUpdate.t = 0; hudUpdate(); }
  });

  // ---------- scenes (?scene=...) for screenshots / testing
  async function setupScene(sc) {
    const lvl = sc === 'spring' && Q.get('id') && springById[Q.get('id')] ? springById[Q.get('id')].region : (SCENE_LEVEL[sc] || 'HUB');
    S = fresh(); for (const f of (SCENE_FLAGS[sc] || [])) { S.flags[f] = true; if (/^spring\d$/.test(f)) S.springs[f] = true; }
    if (S.flags.has_map) S.items.push('Parchment Map');
    for (const id of Object.keys(S.springs)) { const rw = springById[id].reward; if (rw.type === 'spell') S.spells.push(rw.spell_id); if (rw.type === 'map') S.revealed[rw.region] = true; if (rw.type === 'max_hp') S.maxHp += rw.amount; if (rw.type === 'max_mp') S.maxMp += rw.amount; }
    if (S.flags.met_lamp) S.spells.push(springs.spellbook.big); if (S.flags.forest_done) S.spells.push(springs.spellbook.water);
    S.hp = S.maxHp; S.mp = S.maxMp; S.time = 754;
    await goLevel(lvl); G.snap = true; lastQuest = (currentQuest() || {}).id; toastEl.classList.add('hide');
    const L = W.L, at = (x, z, face) => { player.position.set(x, W.h(x, z), z); if (face !== undefined) { player.rotation.y = face; G.cy = face + Math.PI; } G.snap = true; };
    const sp1 = (id) => W.springs.find((s) => s.id === id);
    if (sc === 'title') { showTitle(); }
    if (sc === 'hub') { at(-1, 27, Math.PI); G.cy = 0.12; G.cp = 0.36; }
    if (sc === 'dialogue') { const n = W.npcs.find((q) => q.id === 'npc1'); at(n.obj.position.x + 0.5, n.obj.position.z + 2.4, Math.PI); interact({ k: 'npc', n }); setTimeout(() => finishLine(), 50); }
    if (sc === 'swing') { const sw = W.swing; at(sw.pivot[0], sw.pivot[2] + 2); mountSwing(); sw.ang = 0.75; sw.vel = 0.5; G.cy = sw.rot + Math.PI / 2 + 0.25; G.cp = 0.3; setTimeout(() => toastEl.classList.add('hide'), 100); }
    if (sc === 'ride') { at(fox.position.x - 0.3, fox.position.z); toggleRide(); G.cy = 0; G.cp = 0.2; keys.KeyA = true; setTimeout(() => { keys.KeyA = false; }, 2600); }
    if (sc === 'portal') { const p = L.portals.find((q) => q.type === 'spore_ring'); at(p.pos[0] + 3.4, p.pos[2] - 2.2); player.rotation.y = Math.atan2(-3.4, 2.2); G.cy = Math.atan2(3.4, -2.2) + 0.5; G.cp = 0.5; }
    if (sc === 'spring') { const s = sp1(Q.get('id') || 'spring2') || W.springs[0]; delete S.springs[s.id]; s.found = false; at(s.pos[0], s.pos[2] + 1.8); discover(s); setTimeout(() => finishLine(), 50); }
    if (sc === 'battle') { const k = W.critters.slice().sort((a, b) => a.obj.position.distanceTo(player.position) - b.obj.position.distanceTo(player.position))[0]; at(k.obj.position.x, k.obj.position.z + 2.2, Math.PI); startBattle(k); fox.visible = false; setTimeout(() => cast(0), 1650); }
    if (sc === 'map') { at(L.spawn[0], L.spawn[2] - 6); S.revealed.L1 = true; openMap(); }
    if (sc === 'pause') { at(L.spawn[0], L.spawn[2] - 4); openMenu(); }
    if (sc === 'chase') { const s = sp1('spring7'); at(s.pos[0] + 2, s.pos[2] + 14, 0); G.cy = 0.35; G.cp = 0.22; startChase(); dwarf.position.set(player.position.x - 0.5, 0, player.position.z - 6); dwarf.position.y = W.h(dwarf.position.x, dwarf.position.z); C.t = 0; C.shout = 0.8; toastEl.classList.add('hide'); keys.KeyS = true; setTimeout(() => { keys.KeyS = false; }, 4000); }
    if (sc === 'boss') { at(0, 8, Math.PI); G.cy = 0.4; }
    if (sc === 'boss_battle') { startBossBattle(); setTimeout(() => cast(S.spells.length - 1), 900); }
    if (sc === 'ending') { at(2.4, -15.2, Math.PI * 1.15); dwarf.position.set(-2.4, W.h(-2.4, -15.6), -15.6); dwarf.rotation.y = Math.PI * 0.85; dwarf.visible = true; W.mother.g.visible = true; W.lid.position.set(-4, W.lid.position.y + 0.2, -18); W.lid.rotation.z = 1.2; showEnding(); }
    if (sc === 'caverns' || sc === 'marsh' || sc === 'forest') { at(L.spawn[0], L.spawn[2] - 3, Math.PI); G.cy = 0; }
  }

  window.__game = { get S() { return S; }, get W() { return W; }, get mode() { return G.mode; }, get battle() { return B; }, get chase() { return C; }, fps: () => st.fps, game, springs };
  const dbg = () => ({ mode: G.mode, level: W && W.id, pos: player.position.toArray().map((v) => +v.toFixed(2)), anim: pA && pA.name, riding: G.riding, swinging: G.swinging,
    springs: nSprings(), quest: (currentQuest() || {}).id || 'done', battle: B ? B.foes.map((f) => [f.name, f.hp]) : null, chase: !!C, fps: +st.fps.toFixed(1), cam: +G.cy.toFixed(3), pitch: +G.cp.toFixed(3), face: +player.rotation.y.toFixed(3), joy: joyV ? [+joyV.x.toFixed(2), +joyV.y.toFixed(2)] : null,
    disp: { res: display.res, set: { ...display.settings }, rw: display.rw, rh: display.rh, w: display.w, h: display.h, hk: display.hk, tv: display.tv, fs: display.isFS(), pad: padFirst() },
    lock: G.lock ? (G.lock.e.name || G.lock.e.id || 'foe') : null, lockPos: G.lock ? G.lock.e.obj.position.toArray().map((v) => +v.toFixed(3)) : null, camMode: input.settings.camMode === 'free' ? 'free' : 'follow', mini: { on: mini.visible, arrow: mini.arrow, angle: mini.angle === null ? null : +mini.angle.toFixed(3), draws: mini.shown, heading: (() => { const h = W && questNav(); return h ? { x: +h.x.toFixed(2), z: +h.z.toFixed(2), via: h.via || null } : null; })() }, pitchUp: +upAmount(G.cp).toFixed(3), viewPitch: (() => { const v = camLook.clone().sub(camPos).normalize(); return +(Math.asin(v.y) * 57.2958).toFixed(1); })(), camY: +camera.position.y.toFixed(3), camPos: camera.position.toArray().map((v) => +v.toFixed(3)), camGround: W ? +(camera.position.y - W.h(camera.position.x, camera.position.z)).toFixed(3) : null, scheme: input.scheme, zoom: +G.zoom.toFixed(2), walk: G.walk, sel: selSpell, mp: S.mp, menuPage, setSel });
  window.__debug = Object.assign(dbg, {
    setFlag: (f) => { S.flags[f] = true; progress(); }, go: (id) => goLevel(id), teleport: (x, z) => { player.position.set(x, W.h(x, z), z); },
    discover: (id) => { const s = W.springs.find((q) => q.id === id); if (s && !s.found) discover(s); }, talk, startChase, startBossBattle, save, loadSave, scene: setupScene, cu: (o) => { G.cuOv = o; G.snap = true; },

  });
  G.start = async () => {
    if (G.started) return; G.started = true;
    const sc = Q.get('scene');
    await buildLevel('HUB'); progress();
    if (sc && sc !== 'title') await setupScene(sc); else { showTitle(); G.snap = true; }
    await new Promise((r) => setTimeout(r, 900));
    loaded(); window.__ready = true;
  };
  if (!Q.get('autostart')) G.start();
}

export function begin() { if (G && G.start) G.start(); }
