// n64-suite shared display layer: render-resolution presets, aspect (fit / 16:9 / 4:3 with black bars), render scale,
// fullscreen (Fullscreen API + webkit prefix; iPhone falls back to "Add to Home Screen" via the web app manifest),
// notch / home-bar safe areas, small-height HUD scaling and a "turn your phone sideways" overlay.
export const RES = [['auto', 'Auto'], ['phone', 'Phone (landscape)'], ['p720', '720p TV/PC'], ['p1080', '1080p TV/PC'], ['retro', 'Retro 320x240']];
export const ASPECTS = [['fit', 'Fit screen'], ['16:9', '16:9'], ['4:3', '4:3']];
export const SCALES = [1, 0.85, 0.7, 0.5];
const SETTINGS = { res: 'auto', aspect: 'fit', scale: 1 };
const coarse = () => matchMedia('(pointer: coarse)').matches;
export const isIPhone = () => /iPhone|iPod/.test(navigator.userAgent);
export const isIOS = () => isIPhone() || /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(navigator.userAgent);
// "Install app": Chrome / Edge / Samsung fire beforeinstallprompt (index.html stashes it early in window.__bip); iPhone + iPad
// Safari have no prompt, so we show the Add to Home Screen steps instead.
let installed = false;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__bip = e; });
addEventListener('appinstalled', () => { installed = true; window.__bip = null; });
export const standalone = () => navigator.standalone === true || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
export const isFS = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
export function canFS() {  // element fullscreen exists everywhere except iPhone Safari
  const e = document.documentElement;
  return !isIPhone() && !!(e.requestFullscreen || e.webkitRequestFullscreen) && (document.fullscreenEnabled || document.webkitFullscreenEnabled) !== false;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const css = `#n64-rotate,#n64-tip{position:fixed;inset:0;z-index:3000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;box-sizing:border-box;
background:rgba(12,16,8,.96);color:#f4ecd0;font:600 17px system-ui,sans-serif;text-align:center;touch-action:none}
#n64-tip{background:rgba(12,16,8,.88)}#n64-tip .card{max-width:440px;background:#f2e2b8;color:#4a2a14;border:4px solid #8a5a32;border-radius:18px;padding:18px 20px;line-height:1.35}
#n64-rotate b{font-size:22px}#n64-rotate small,#n64-tip small{opacity:.85;font-weight:500}
#n64-rotate button,#n64-tip button{min-height:48px;min-width:160px;padding:10px 22px;border-radius:24px;border:3px solid #2f6a1e;background:#5aa832;color:#fff8e8;font:700 17px system-ui,sans-serif;cursor:pointer}
#n64-rotate .ph{width:64px;height:104px;border:5px solid #f4ecd0;border-radius:12px;animation:n64rot 2.2s ease-in-out infinite}
@keyframes n64rot{0%,25%{transform:rotate(0)}60%,100%{transform:rotate(-90deg)}}
html[data-res=retro] canvas#view{image-rendering:pixelated}
#n64-safe{position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}`;

export function createDisplay({ renderer, cameras = () => [], storageKey = 'n64.display', aspects = ['fit', '16:9', '4:3'], title = document.title, onChange = null, onToast = null } = {}) {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (e) { /* private mode */ }
  const D = { settings: { ...SETTINGS, ...saved }, res: 'window', tv: false, aspect: 4 / 3, w: 0, h: 0, rw: 320, rh: 240, hk: 1, aspects,
    save() { try { localStorage.setItem(storageKey, JSON.stringify(D.settings)); } catch (e) { /* private mode */ } } };
  if (!aspects.includes(D.settings.aspect)) D.settings.aspect = aspects[0];
  if (!RES.some((r) => r[0] === D.settings.res)) D.settings.res = 'auto';
  if (!SCALES.includes(+D.settings.scale)) D.settings.scale = 1;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const probe = document.createElement('div'); probe.id = 'n64-safe'; document.body.appendChild(probe);
  const qs = new URLSearchParams(location.search).get('safearea');  // tests: ?safearea=top,right,bottom,left (px) stands in for a notch
  const insets = () => { if (qs) { const v = qs.split(',').map(Number); return { t: v[0] || 0, r: v[1] || 0, b: v[2] || 0, l: v[3] || 0 }; }
    const s = getComputedStyle(probe); return { t: parseFloat(s.paddingTop) || 0, r: parseFloat(s.paddingRight) || 0, b: parseFloat(s.paddingBottom) || 0, l: parseFloat(s.paddingLeft) || 0 }; };
  D.apply = () => {
    const wrap = document.getElementById('wrap'), stage = document.getElementById('stage'); if (!wrap || !stage) return;
    const W = wrap.clientWidth || innerWidth, H = wrap.clientHeight || innerHeight, as = D.settings.aspect;
    const a = as === '16:9' ? 16 / 9 : as === '4:3' ? 4 / 3 : clamp(W / H, 4 / 3, 2.4);  // fit: fill the screen (portrait keeps a 4:3 band)
    let sw = W, sh = W / a; if (sh > H) { sh = H; sw = H * a; }
    sw = Math.round(sw); sh = Math.round(sh); stage.style.width = `${sw}px`; stage.style.height = `${sh}px`;
    const res = D.settings.res === 'auto' ? (coarse() ? 'phone' : 'window') : D.settings.res, dpr = Math.min(devicePixelRatio || 1, 2), k = +D.settings.scale || 1;
    let rh = res === 'retro' ? 240 : res === 'p720' ? 720 : res === 'p1080' ? 1080 : res === 'phone' ? Math.min(480, sh * dpr) * k : sh * dpr * k;
    if (res === 'p720' || res === 'p1080') rh *= k;
    rh = Math.max(144, Math.round(rh)); let rw = Math.round(rh * sw / sh); if (rw > 2560) { rw = 2560; rh = Math.round(rw * sh / sw); }  // pixel cap
    if (renderer) { renderer.setPixelRatio(1); renderer.setSize(rw, rh, false); }
    for (const c of cameras()) { if (c && c.isPerspectiveCamera) { c.aspect = sw / sh; c.updateProjectionMatrix(); } }
    const i = insets(), ox = (W - sw) / 2, oy = (H - sh) / 2;  // a letterboxed stage is already clear of the notch by the bar width
    D.tv = res === 'p720' || res === 'p1080'; D.hk = Math.max(clamp(560 / sh, 1, 1.4), D.tv ? 1.2 : 1);
    const v = { '--sal': Math.max(0, i.l - ox), '--sar': Math.max(0, i.r - ox), '--sat': Math.max(0, i.t - oy), '--sab': Math.max(0, i.b - oy) };
    for (const n in v) stage.style.setProperty(n, `${v[n]}px`);
    stage.style.setProperty('--hk', D.hk.toFixed(3));
    Object.assign(D, { res, aspect: sw / sh, w: sw, h: sh, rw, rh });
    const de = document.documentElement; de.dataset.res = res; de.dataset.tv = D.tv ? '1' : '0'; de.dataset.small = sh < 520 ? '1' : '0';
    rotate(); onChange && onChange(D);
  };
  let q = 0; const later = () => { if (!q) q = requestAnimationFrame(() => { q = 0; D.apply(); }); };
  addEventListener('resize', later); addEventListener('orientationchange', () => { later(); setTimeout(later, 350); });
  if (window.visualViewport) visualViewport.addEventListener('resize', later);
  D.set = (k, v) => { D.settings[k] = v; D.save(); D.apply(); };
  D.cycle = (k, d = 1) => { const list = k === 'res' ? RES.map((r) => r[0]) : k === 'aspect' ? aspects : SCALES; const i = list.indexOf(k === 'scale' ? +D.settings[k] : D.settings[k]); D.set(k, list[(i + d + list.length) % list.length]); };
  D.label = (k) => (k === 'res' ? RES.find((r) => r[0] === D.settings.res)[1] + (D.settings.res === 'auto' ? ` (${{ phone: 'phone', window: 'window' }[D.res] || D.res})` : '')
    : k === 'aspect' ? ASPECTS.find((r) => r[0] === D.settings.aspect)[1] : `${Math.round(D.settings.scale * 100)}%`);
  // ---- fullscreen
  D.canFS = canFS; D.isFS = isFS;
  D.toggleFS = async () => {
    if (!canFS()) { D.tip(true); return false; }
    try {
      if (isFS()) await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen());
      else {
        const e = document.documentElement; await (e.requestFullscreen ? e.requestFullscreen({ navigationUI: 'hide' }) : e.webkitRequestFullscreen());
        if (coarse() && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => { /* not allowed here */ });
      }
    } catch (err) { onToast && onToast('Fullscreen needs a tap, click or key press<br><small>Use the corner button, the title / Settings item or the ` key</small>'); return false; }
    return true;
  };
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => { later(); document.documentElement.dataset.fs = isFS() ? '1' : '0'; });
  // ---- iPhone: no element fullscreen, so explain "Add to Home Screen" once (and again whenever the fullscreen button is pressed)
  D.tip = (force) => {
    if (!isIPhone() || standalone() || document.getElementById('n64-tip')) return;
    if (rot) { setTimeout(() => D.tip(force), 1000); return; }  // after the rotate-sideways overlay
    const key = `${storageKey}.fstip`; let seen = false; try { seen = !!localStorage.getItem(key); } catch (e) { /* private */ }
    if (seen && !force) return; try { localStorage.setItem(key, '1'); } catch (e) { /* private */ }
    const t = document.createElement('div'); t.id = 'n64-tip';
    t.innerHTML = `<div class="card"><b>Play fullscreen on iPhone</b><br>Tap <b>Share</b> <span aria-hidden="true">&#x2B06;&#xFE0E;</span> then <b>Add to Home Screen</b>.<br><small>Open ${title.replace(/</g, '&lt;')} from your home screen and it fills the whole screen, sideways.</small></div><button>Got it</button>`;
    const eat = (e) => e.stopPropagation(); for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'mousedown']) t.addEventListener(ev, eat);
    t.querySelector('button').addEventListener('click', () => t.remove()); document.body.appendChild(t);
  };
  // ---- Install app (Settings): the real prompt where the browser offers one, otherwise the steps for this device
  D.installState = () => (standalone() || installed ? 'installed' : window.__bip ? 'prompt' : isIOS() ? 'ios' : isAndroid() ? 'android' : 'desktop');
  D.installLabel = () => ({ installed: 'Installed', prompt: 'Install', ios: 'How to', android: 'How to', desktop: 'How to' }[D.installState()]);
  D.install = async () => {
    const st = D.installState();
    if (st === 'installed') { onToast && onToast('Already installed: open it from your home screen'); return st; }
    if (st === 'prompt') {
      const ev = window.__bip; window.__bip = null;
      try { await ev.prompt(); const r = await ev.userChoice; if (r && r.outcome === 'accepted') installed = true; return r ? r.outcome : 'shown'; } catch (e) { window.__bip = ev; onToast && onToast('Tap or click Install app to open the install prompt'); return 'error'; }
    }
    D.installSteps(st); return 'steps';
  };
  D.installSteps = (st = D.installState()) => {
    if (document.getElementById('n64-tip')) return;
    const name = title.replace(/</g, '&lt;'), share = '<b>Share</b> <span aria-hidden="true">&#x2B06;&#xFE0E;</span>';
    const body = st === 'ios' ? `In <b>Safari</b>: tap ${share}, scroll down, then tap <b>Add to Home Screen</b> and <b>Add</b>.<br><small>In Chrome on iPhone: tap ${share} in the address bar, then <b>Add to Home Screen</b>. Open ${name} from the new icon and it fills the whole screen, sideways.</small>`
      : st === 'android' ? `In <b>Chrome</b>: tap the <b>&#8942;</b> menu (top right), then <b>Install app</b> or <b>Add to Home screen</b>.<br><small>Samsung Internet: tap <b>&#9776;</b> then <b>Add page to</b> &rarr; <b>Home screen</b>. Open ${name} from the new icon to play fullscreen.</small>`
      : `In <b>Chrome</b> or <b>Edge</b>: click the install icon at the right end of the address bar, or open the <b>&#8942;</b> menu and choose <b>Install</b>.<br><small>On a phone or tablet this adds ${name} to your home screen.</small>`;
    const t = document.createElement('div'); t.id = 'n64-tip'; t.dataset.kind = 'install-' + st;
    t.innerHTML = `<div class="card"><b>Install ${name}</b><br>${body}</div><button>Got it</button>`;
    const eat = (e) => e.stopPropagation(); for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'mousedown']) t.addEventListener(ev, eat);
    t.querySelector('button').addEventListener('click', () => t.remove()); document.body.appendChild(t);
  };
  // ---- held upright on a phone: ask for landscape (can be dismissed for this visit)
  let rot = null, keep = false; try { keep = sessionStorage.getItem('n64.portrait') === '1'; } catch (e) { /* private */ }
  function rotate() {
    const want = coarse() && innerHeight > innerWidth * 1.05 && !keep;
    if (want && !rot) {
      rot = document.createElement('div'); rot.id = 'n64-rotate';
      rot.innerHTML = '<div class="ph"></div><b>Turn your phone sideways</b><small>This game is made for landscape.</small><button>Keep playing anyway</button>';
      const eat = (e) => e.stopPropagation(); for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'mousedown']) rot.addEventListener(ev, eat);
      rot.querySelector('button').addEventListener('click', () => { keep = true; try { sessionStorage.setItem('n64.portrait', '1'); } catch (e) { /* private */ } rot.remove(); rot = null; });
      document.body.appendChild(rot);
    } else if (!want && rot) { rot.remove(); rot = null; }
    document.documentElement.dataset.portrait = innerHeight > innerWidth * 1.05 ? '1' : '0';
  }
  D.apply(); window.__display = D;
  return D;
}
