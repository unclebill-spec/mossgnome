// Boot: pick the preset demo by manifest.style.preset.demo (field / trek / fp / grove).
import { J, $, Q, font, loaded } from './common.js';
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
if (st.demo !== 'grove') loaded();  // grove drops the loading overlay itself once its world is built
const go = () => { $('title').classList.add('hide'); mod.begin && mod.begin(); };
if (Q.get('autostart')) go(); else $('title').onclick = go;
