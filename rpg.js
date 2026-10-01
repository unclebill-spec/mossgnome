// Boot: pick the preset demo by manifest.style.preset.demo (field / trek / fp / grove).
import { J, $, Q, font, loaded } from './common.js';
import { createInput } from './input.js';
import { createDisplay } from './display.js';
const man = await J('manifest.json');
const st = man.style.preset || {};
document.title = man.game.title;
$('titleText').textContent = man.game.title;
$('crisp').onclick = () => document.body.classList.toggle('crisp');
await Promise.all([font('HudSerif', 'IMFellFrenchCanon-Italic.ttf'), font('DlgSerif', 'IMFellFrenchCanon-Regular.ttf'), font('FloatSerif', 'DejaVuSerif-Bold.ttf'),
  font('HeadSC', 'IMFellEnglishSC-Regular.ttf'), font('HudSans', 'DejaVuSans.ttf'), font('Mono', 'CourierPrime-Bold.ttf'), font('MenuSC', 'IMFellEnglishSC-Regular.ttf'),
  font('DeathSerif', 'IMFellFrenchCanon-Regular.ttf'), font('Gothic', 'UnifrakturMaguntia-Regular.ttf')]);
const mode = { field: './field.js', trek: './trek.js', fp: './fp.js', grove: './grove.js' }[st.demo] || './field.js';
const mod = await import(mode);
await mod.start(man);
if (st.demo !== 'grove') {  // every game gets controller + keyboard/mouse + touch input and the display presets (4:3 HUDs); grove builds richer ones
  loaded(); createInput({ storageKey: `${man.game.title}.input`, canvas: $('view') });
  createDisplay({ renderer: window.__renderer, aspects: ['4:3'], storageKey: `${man.game.title}.display`, title: man.game.title });
}  // every game gets controller + keyboard/mouse + touch input; grove builds its own richer one  // grove drops the loading overlay itself once its world is built
const go = () => { $('title').classList.add('hide'); mod.begin && mod.begin(); };
if (Q.get('autostart')) go(); else $('title').onclick = go;
