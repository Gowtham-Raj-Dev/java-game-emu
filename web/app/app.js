/* JavaPlay player UI – game library, engine host, keypad / keyboard / touch input, rotation, themes, recording. */
(function () {
  'use strict';
  const KP = window.KP;
  const $ = (id) => document.getElementById(id);
  const Bridge = window.JavaPlayAndroid || null; // present inside the Android app
  const IN_APP = !!Bridge;
  const VERSION = (Bridge && Bridge.versionName && Bridge.versionName()) || '2.4.1';

  // ---------------- IndexedDB game library ----------------
  const DB = {
    db: null, mem: null,
    open() {
      return new Promise((resolve) => {
        if (!window.indexedDB) { resolve(null); return; }
        const req = indexedDB.open('keyplay', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('games', { keyPath: 'id' });
        req.onsuccess = () => { DB.db = req.result; resolve(DB.db); };
        req.onerror = () => resolve(null);
      });
    },
    store(mode) { return DB.db.transaction('games', mode).objectStore('games'); },
    all() {
      return new Promise((resolve) => {
        if (!DB.db) { resolve(DB.mem ? Object.values(DB.mem) : []); return; }
        const r = DB.store('readonly').getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => resolve([]);
      });
    },
    put(rec) {
      return new Promise((resolve) => {
        if (!DB.db) { (DB.mem = DB.mem || {})[rec.id] = rec; resolve(); return; }
        const r = DB.store('readwrite').put(rec);
        r.onsuccess = () => resolve(); r.onerror = () => resolve();
      });
    },
    del(id) {
      return new Promise((resolve) => {
        if (!DB.db) { if (DB.mem) delete DB.mem[id]; resolve(); return; }
        const r = DB.store('readwrite').delete(id);
        r.onsuccess = () => resolve(); r.onerror = () => resolve();
      });
    },
  };

  function fnvHash(bytes) {
    let h = 0x811c9dc5;
    const step = Math.max(1, Math.floor(bytes.length / 65536));
    for (let i = 0; i < bytes.length; i += step) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16) + '-' + bytes.length.toString(16);
  }

  function iconDataUrl(jar, props) {
    let path = props['MIDlet-Icon'];
    if (!path && props['MIDlet-1']) path = (props['MIDlet-1'].split(',')[1] || '').trim();
    if (!path) return null;
    try {
      const b = jar.get(path.replace(/^\/+/, ''));
      if (!b || !KP.isPng(b)) return null;
      const d = KP.decodePng(b);
      const c = document.createElement('canvas');
      c.width = d.width; c.height = d.height;
      const ctx = c.getContext('2d');
      const id = ctx.createImageData(d.width, d.height); id.data.set(d.data); ctx.putImageData(id, 0, 0);
      return c.toDataURL('image/png');
    } catch (e) { return null; }
  }

  async function addJarBytes(fileName, bytes) {
    let jar, props;
    try {
      jar = new KP.Jar(bytes);
      props = KP.parseManifest(jar.text('META-INF/MANIFEST.MF') || '');
    } catch (e) { note('“' + fileName + '” is not a valid .jar file.'); return null; }
    if (!props['MIDlet-1'] && !jar.names().some((n) => n.endsWith('.class'))) { note('“' + fileName + '” has no Java game inside.'); return null; }
    const profile = KP.detectProfile(jar, props, fileName);
    const rec = {
      id: fnvHash(bytes),
      name: props['MIDlet-Name'] || fileName.replace(/\.jar$/i, ''),
      vendor: props['MIDlet-Vendor'] || '',
      fileName,
      icon: iconDataUrl(jar, props),
      w: profile.w, h: profile.h, touch: profile.touch, rotate: profile.rotate || 0,
      added: Date.now(),
      jar: bytes,
    };
    await DB.put(rec);
    return rec;
  }

  async function handleFiles(files) {
    let last = null, added = 0;
    for (const f of files) {
      if (!/\.jar$/i.test(f.name) && !(f.type || '').includes('java')) {
        if (/\.jad$/i.test(f.name)) note('Pick the .jar file, not the .jad. The .jar has the game.');
        else note('“' + f.name + '” is not a .jar game.');
        continue;
      }
      const buf = new Uint8Array(await f.arrayBuffer());
      const rec = await addJarBytes(f.name, buf);
      if (rec) { last = rec; added++; }
    }
    await renderLibrary();
    if (last && added === 1) startGame(last);
  }

  let noteTimer = null;
  function note(msg) {
    const el = $('homeNote');
    el.textContent = msg; el.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }

  // effective profile of a stored game (user overrides win)
  function profileOf(rec) {
    const o = rec.override || {};
    const w = o.w || rec.w, h = o.h || rec.h;
    const rotate = o.rotate !== undefined ? o.rotate : (rec.rotate || 0);
    const touch = o.touch !== undefined ? o.touch : !!rec.touch;
    return { w, h, rotate, touch, landscape: rotate ? w < h : w > h };
  }

  async function renderLibrary() {
    const list = (await DB.all()).sort((a, b) => (b.played || b.added) - (a.played || a.added));
    const grid = $('gameGrid');
    grid.innerHTML = '';
    libCount = list.length;
    $('empty').hidden = list.length > 0;
    $('fab').hidden = list.length === 0 || !$('storeBody').hidden;
    for (const g of list) {
      const p = profileOf(g);
      const card = document.createElement('div');
      card.className = 'card'; card.tabIndex = 0; card.setAttribute('role', 'button');
      card.setAttribute('aria-label', 'Play ' + g.name);
      card.innerHTML = (g.shot ? '<span class="shot lib"><img alt="" src="' + g.shot + '">' + (g.icon ? '<img class="ico" alt="" src="' + g.icon + '">' : '') + '</span>' : g.icon ? '<img alt="" src="' + g.icon + '">' : '<span class="noicon"></span>') +
        '<span class="name"></span><span class="meta"></span><button class="more" type="button" aria-label="Game options">⋮</button>';
      if (!g.icon && !g.shot) card.querySelector('.noicon').textContent = (g.name[0] || '?').toUpperCase();
      card.querySelector('.name').textContent = g.name;
      card.querySelector('.meta').textContent = p.w + '×' + p.h + (p.rotate ? ' · turned' : '') + (p.touch ? ' · touch' : '');
      let pressTimer = null, longPressed = false;
      card.addEventListener('pointerdown', () => { longPressed = false; pressTimer = setTimeout(() => { longPressed = true; gameOptions(g); }, 550); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => card.addEventListener(ev, () => clearTimeout(pressTimer)));
      card.addEventListener('contextmenu', (e) => e.preventDefault());
      card.addEventListener('click', (e) => {
        if (longPressed) return;
        if (e.target.classList.contains('more')) { e.stopPropagation(); gameOptions(g); return; }
        startGame(g);
      });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(g); });
      grid.appendChild(card);
    }
  }

  function gameOptions(g) {
    sheet(g.name, (body, close) => {
      body.appendChild(opt('▶', 'Play', () => { close(); startGame(g); }));
      body.appendChild(opt('🗑', 'Remove game', () => { close(); confirmDelete(g); }, 'danger'));
    });
  }

  function confirmDelete(g) {
    sheet('Remove “' + g.name + '”?', (body, close) => {
      const p = document.createElement('p'); p.className = 'info'; p.textContent = 'The game and its saved progress are removed from this device.'; body.appendChild(p);
      const row = document.createElement('div'); row.className = 'row';
      row.append(opt('', 'Cancel', () => close()), opt('', 'Remove', async () => {
        close();
        await DB.del(g.id);
        try { Object.keys(localStorage).filter((k) => k.startsWith('kp:' + g.id + ':')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* storage blocked */ }
        renderLibrary();
      }, 'primary'));
      body.appendChild(row);
    });
  }

  // ---------------- bottom sheet ----------------
  function opt(icon, label, fn, cls, value) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'opt' + (cls ? ' ' + cls : '');
    if (icon) { const i = document.createElement('span'); i.className = 'ico'; i.textContent = icon; b.appendChild(i); }
    const l = document.createElement('span'); l.textContent = label; b.appendChild(l);
    if (value !== undefined) { const v = document.createElement('span'); v.className = 'val'; v.textContent = value; b.appendChild(v); }
    b.addEventListener('click', fn);
    return b;
  }
  let closeSheet = null;
  function sheet(title, build, onClose) {
    if (closeSheet) closeSheet(true);
    const modal = $('modal'), body = $('modalBody');
    $('modalTitle').textContent = title;
    body.innerHTML = '';
    let closed = false;
    const close = (replaced) => {
      if (closed) return; closed = true;
      modal.hidden = true; closeSheet = null;
      if (onClose && !replaced) onClose();
      if (!$('player').hidden) display.focus({ preventScroll: true });
    };
    closeSheet = close;
    build(body, close);
    modal.hidden = false;
    const first = body.querySelector('textarea');
    if (first) first.focus();
  }
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal') && closeSheet) closeSheet(); });

  // ---------------- player ----------------
  let emu = null, current = null, prof = null, dirty = false, paused = false, menuOpen = false;
  const display = $('screen');
  const dctx = display.getContext('2d');

  function storageFor(id) {
    const pre = 'kp:' + id + ':';
    return {
      load(k) { try { const v = localStorage.getItem(pre + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
      save(k, v) { try { localStorage.setItem(pre + k, JSON.stringify(v)); } catch (e) { toast('Could not save game data (storage full or blocked).'); } },
      remove(k) { try { localStorage.removeItem(pre + k); } catch (e) { /* ignore */ } },
      list(prefix) { try { return Object.keys(localStorage).filter((k) => k.startsWith(pre + prefix)).map((k) => k.substring(pre.length)); } catch (e) { return []; } },
    };
  }

  // ---------------- controls: keypad themes, sizes, sides ----------------
  // every theme sets all of THEME_VARS; app.css holds the Midnight values as defaults
  const THEMES = {
    midnight: { name: 'Midnight', '--stage': '#07080b', '--pad-bg': 'linear-gradient(#1b1e26, #111318)', '--pad-edge': '#262b36', '--k-bg': '#262a34', '--k-edge': '#363c4b', '--k-fg': '#eef0f4', '--k-sub': '#8d95a7', '--dpad': '#262a34', '--arrow': '#b9bfcc', '--hl': '#ff8a1f', '--hl-ink': '#1a1206', '--ok': '#ff8a1f', '--ok-ink': '#1a1206', '--kr': '14px', '--glow': 'none' },
    classic: { name: 'Classic', '--stage': '#9ea4ad', '--pad-bg': 'linear-gradient(#dfe2e7, #b4bac3)', '--pad-edge': '#8d949e', '--k-bg': '#f5f6f8', '--k-edge': '#9aa1ab', '--k-fg': '#1f232a', '--k-sub': '#5b6370', '--dpad': '#eceef1', '--arrow': '#4a515c', '--hl': '#1d6fe0', '--hl-ink': '#ffffff', '--ok': '#1d6fe0', '--ok-ink': '#ffffff', '--kr': '10px', '--glow': '0 2px 0 #8a919b' },
    neon: { name: 'Neon', '--stage': '#020206', '--pad-bg': '#05050c', '--pad-edge': '#11324a', '--k-bg': '#090914', '--k-edge': '#00e5ff', '--k-fg': '#c8faff', '--k-sub': '#00a9c0', '--dpad': '#090914', '--arrow': '#00e5ff', '--hl': '#ff2bd6', '--hl-ink': '#ffffff', '--ok': '#ff2bd6', '--ok-ink': '#ffffff', '--kr': '12px', '--glow': '0 0 8px rgba(0, 229, 255, 0.45)' },
    retro: { name: 'Retro', '--stage': '#a9a796', '--pad-bg': 'linear-gradient(#cfcdbd, #b8b6a3)', '--pad-edge': '#98968a', '--k-bg': '#3d3c46', '--k-edge': '#2a2a31', '--k-fg': '#ecebdf', '--k-sub': '#b5b3a6', '--dpad': '#2b2b33', '--arrow': '#8f8e99', '--hl': '#8bac0f', '--hl-ink': '#0f380f', '--ok': '#a32559', '--ok-ink': '#ffffff', '--kr': '999px', '--glow': '0 2px 0 #77756a' },
    ocean: { name: 'Ocean', '--stage': '#04121d', '--pad-bg': 'linear-gradient(#0d2a42, #071827)', '--pad-edge': '#173f5e', '--k-bg': '#12324d', '--k-edge': '#1e4d72', '--k-fg': '#e3f4ff', '--k-sub': '#7fb0d3', '--dpad': '#103049', '--arrow': '#9cc8e6', '--hl': '#2ad4c4', '--hl-ink': '#03201d', '--ok': '#2ad4c4', '--ok-ink': '#03201d', '--kr': '16px', '--glow': 'none' },
    sakura: { name: 'Sakura', '--stage': '#2a1520', '--pad-bg': 'linear-gradient(#ffe6ee, #f6c8d7)', '--pad-edge': '#e9a6bd', '--k-bg': '#fff6f9', '--k-edge': '#efb0c5', '--k-fg': '#6b2140', '--k-sub': '#b0607e', '--dpad': '#fff0f5', '--arrow': '#b0607e', '--hl': '#e84a7f', '--hl-ink': '#ffffff', '--ok': '#e84a7f', '--ok-ink': '#ffffff', '--kr': '18px', '--glow': '0 2px 0 #e3a3b9' },
    gold: { name: 'Gold', '--stage': '#050505', '--pad-bg': 'linear-gradient(#151515, #0a0a0a)', '--pad-edge': '#3b3016', '--k-bg': '#1b1b1b', '--k-edge': '#5c4a1e', '--k-fg': '#f3d27a', '--k-sub': '#a88a3d', '--dpad': '#171717', '--arrow': '#c9a24a', '--hl': '#e8b84a', '--hl-ink': '#1a1206', '--ok': '#e8b84a', '--ok-ink': '#1a1206', '--kr': '12px', '--glow': 'none' },
    glass: { name: 'Glass', '--stage': '#000000', '--pad-bg': 'transparent', '--pad-edge': 'transparent', '--k-bg': 'rgba(255, 255, 255, 0.06)', '--k-edge': 'rgba(255, 255, 255, 0.2)', '--k-fg': '#ffffff', '--k-sub': 'rgba(255, 255, 255, 0.55)', '--dpad': 'rgba(255, 255, 255, 0.05)', '--arrow': 'rgba(255, 255, 255, 0.7)', '--hl': '#ffffff', '--hl-ink': '#000000', '--ok': 'rgba(255, 255, 255, 0.85)', '--ok-ink': '#000000', '--kr': '999px', '--glow': 'none' },
  };
  const THEME_VARS = Object.keys(THEMES.midnight).filter((k) => k !== 'name');
  const ACCENTS = ['', '#ff8a1f', '#ff4d4d', '#ffd23f', '#3ddc84', '#2ad4c4', '#3d8bff', '#9b6bff', '#ff4fa3'];
  const CTL_DEFAULT = { theme: 'midnight', accent: '', ks: 100, ds: 100, swap: false, nonum: false, haptic: true };
  let ctl = Object.assign({}, CTL_DEFAULT);
  try { Object.assign(ctl, JSON.parse(localStorage.getItem('kp:ctl') || '{}')); } catch (e) { /* storage blocked */ }
  function saveCtl() { try { localStorage.setItem('kp:ctl', JSON.stringify(ctl)); } catch (e) { /* ignore */ } }

  function inkFor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return l > 150 ? '#14110a' : '#ffffff';
  }
  function themeVars(id, accent) {
    const t = Object.assign({}, THEMES[id] || THEMES.midnight);
    if (accent) { t['--hl'] = t['--ok'] = accent; t['--hl-ink'] = t['--ok-ink'] = inkFor(accent); }
    return t;
  }
  function applyControls() {
    const p = $('player'), t = themeVars(ctl.theme, ctl.accent);
    for (const k of THEME_VARS) p.style.setProperty(k, t[k]);
    p.style.setProperty('--ks', ctl.ks / 100);
    p.style.setProperty('--ds', ctl.ds / 100);
    const dev = $('device');
    dev.classList.toggle('swap', !!ctl.swap);
    dev.classList.toggle('nonum', !!ctl.nonum);
    dev.classList.toggle('can-rotate', CAN_ROTATE);
    dirty = true;
  }

  // phone rotation: the app locks the orientation natively; a phone browser can only lock it in full screen
  const CAN_ROTATE = IN_APP || !!(window.screen && screen.orientation && screen.orientation.lock && window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const ORIENT_LABEL = { auto: 'Auto', portrait: 'Portrait', landscape: 'Landscape' };
  function wantedOrientation() {
    const o = current && current.orient;
    if (o === 'portrait' || o === 'landscape') return o;
    return prof && prof.landscape ? 'landscape' : 'portrait';
  }
  function lockOrientation(fromUser) {
    const mode = wantedOrientation();
    if (Bridge && Bridge.setOrientation) { Bridge.setOrientation(mode); return; }
    if (!fromUser || !CAN_ROTATE) return;
    (async () => {
      try {
        if (!document.fullscreenElement) await $('app').requestFullscreen();
        await screen.orientation.lock(mode);
      } catch (e) { toast('Turn your phone to ' + mode + '.'); }
    })();
  }
  function setOrientation(mode, fromUser) {
    current.orient = mode;
    DB.put(current);
    lockOrientation(fromUser);
    toast('Phone: ' + ORIENT_LABEL[mode]);
  }
  function rotatePhone() {
    if (!current) return;
    const now = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
    setOrientation(now === 'landscape' ? 'portrait' : 'landscape', true);
  }

  function applyLayout() {
    const dev = $('device');
    dev.classList.toggle('landscape', prof.landscape);
    dev.classList.toggle('portrait', !prof.landscape);
    const hideKeys = current.keypad === undefined ? prof.touch : !current.keypad;
    dev.classList.toggle('nokeys', hideKeys);
    $('player').classList.toggle('immersive', hideKeys && IN_APP);
    applyControls();
    lockOrientation(false);
    if (Bridge && Bridge.setFullscreen) Bridge.setFullscreen(true);
    resizeDisplay();
  }

  function startGame(rec) {
    stopGame();
    current = rec;
    rec.played = Date.now();
    DB.put(rec);
    prof = profileOf(rec);
    $('home').hidden = true;
    $('player').hidden = false;
    try {
      emu = new KP.Emulator({
        jarBytes: rec.jar,
        fileName: rec.fileName,
        profile: { w: prof.w, h: prof.h, touch: prof.touch, landscape: prof.landscape, rotate: prof.rotate },
        host: {
          present: () => { dirty = true; },
          storage: storageFor(rec.id),
          setSoftLabels: (l, r) => { $('softL').textContent = l || ''; $('softR').textContent = r || ''; },
          showMenu: (labels, cb) => showGameMenu(labels, cb),
          textInput: (title, text, max, cb) => showTextInput(title, text, max, cb),
          vibrate: (ms) => { if (Bridge && Bridge.vibrate) Bridge.vibrate(ms | 0); else if (navigator.vibrate) navigator.vibrate(ms | 0); },
          exit: () => exitGame(),
          openUrl: (url) => { if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener'); },
          touch: true,
          muted: muted,
        },
        log: (s) => console.log('[game] ' + s),
        warn: (s) => console.warn('[javaplay] ' + s),
        onError: (msg) => toast('Game error: ' + msg, 6000),
      });
    } catch (e) {
      toast('Could not start this game: ' + e.message, 6000);
      return;
    }
    window.KPDebug = { emu };
    $('softL').textContent = ''; $('softR').textContent = '';
    applyLayout();
    emu.start();
    paused = false; menuOpen = false;
    display.focus({ preventScroll: true });
    if (!localStorage.getItem('kp:menuHint')) {
      toast(prof.touch ? 'Tap ☰ for the game menu' : '☰ key opens the game menu', 3500);
      try { localStorage.setItem('kp:menuHint', '1'); } catch (e) { /* ignore */ }
    }
  }

  function stopGame() {
    stopRecording();
    if (emu) { emu.stop(); emu = null; }
    releaseAll();
  }

  function exitGame() {
    stopGame();
    current = null;
    $('player').hidden = true;
    $('home').hidden = false;
    if (Bridge && Bridge.setOrientation) Bridge.setOrientation('auto');
    if (Bridge && Bridge.setFullscreen) Bridge.setFullscreen(false);
    renderLibrary();
  }

  function pauseEmu() { if (emu && !paused) { emu.pause(); paused = true; } }
  function resumeEmu() { if (emu && paused) { emu.resume(); paused = false; } }

  // render size: crisp integer scale; at least ~720 px for good videos, capped for phone performance
  let scale = 1;
  function resizeDisplay() {
    if (!emu) return;
    const w = prof.w, h = prof.h;
    const dw = prof.rotate ? h : w, dh = prof.rotate ? w : h;
    const wrap = $('screenWrap');
    const dpr = window.devicePixelRatio || 1;
    const fit = Math.floor(Math.min(wrap.clientWidth * dpr / dw, wrap.clientHeight * dpr / dh)) || 1;
    const minForVideo = Math.ceil(720 / Math.max(dw, dh));
    scale = Math.max(1, fit, minForVideo);
    while (scale > 1 && dw * dh * scale * scale > 3200000) scale--;
    if (display.width !== dw * scale || display.height !== dh * scale) { display.width = dw * scale; display.height = dh * scale; }
    dctx.imageSmoothingEnabled = false;
    dirty = true;
  }
  window.addEventListener('resize', resizeDisplay);
  if (window.ResizeObserver) new ResizeObserver(resizeDisplay).observe($('screenWrap'));

  function frame() {
    if (emu && (dirty || recorder)) {
      dirty = false;
      const src = emu.host.screen.front;
      const s = scale;
      dctx.imageSmoothingEnabled = false;
      if (prof.rotate === 270) { dctx.setTransform(0, -s, s, 0, 0, prof.w * s); dctx.drawImage(src, 0, 0); dctx.setTransform(1, 0, 0, 1, 0, 0); }
      else if (prof.rotate === 90) { dctx.setTransform(0, s, -s, 0, prof.h * s, 0); dctx.drawImage(src, 0, 0); dctx.setTransform(1, 0, 0, 1, 0, 0); }
      else dctx.drawImage(src, 0, 0, display.width, display.height);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2500);
  }

  // ---------------- input ----------------
  const active = new Map(); // code -> {count, timer}
  function press(code) {
    if (!emu || menuOpen) return;
    KP.audio.unlock();
    const a = active.get(code);
    if (a) { a.count++; return; }
    emu.keyDown(code);
    const st = { count: 1, timer: null };
    st.timer = setTimeout(function rep() { if (!emu || !active.has(code)) return; emu.keyDown(code); st.timer = setTimeout(rep, 90); }, 420);
    active.set(code, st);
    markKey(code, true);
  }
  function release(code) {
    const a = active.get(code);
    if (!a) return;
    if (--a.count > 0) return;
    clearTimeout(a.timer);
    active.delete(code);
    if (emu) emu.keyUp(code);
    markKey(code, false);
  }
  function releaseAll() { for (const code of Array.from(active.keys())) { active.get(code).count = 1; release(code); } }
  function markKey(code, on) {
    document.querySelectorAll('[data-key="' + code + '"]').forEach((el) => el.classList.toggle('down', on));
    const dir = { '-1': 'up', '-2': 'down', '-3': 'left', '-4': 'right' }[code];
    if (dir) $('dpad').classList.toggle(dir, on);
  }
  function haptic() { if (!ctl.haptic) return; if (Bridge && Bridge.vibrate) Bridge.vibrate(12); else if (navigator.vibrate) navigator.vibrate(8); }

  document.querySelectorAll('.k[data-key], .ok[data-key]').forEach((el) => {
    const code = +el.dataset.key;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } haptic(); press(code); });
    const up = (e) => { e.preventDefault(); release(code); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  document.querySelector('[data-action="menu"]').addEventListener('click', () => pauseMenu());
  document.querySelector('[data-action="rotate"]').addEventListener('click', () => rotatePhone());
  $('floatMenu').addEventListener('click', () => pauseMenu());

  // D-pad: slide between directions, diagonals in narrow bands
  const dpad = $('dpad');
  const dpadPointers = new Map();
  function dpadCodes(e) {
    const r = dpad.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(x, y) < r.width * 0.12) return [];
    const ang = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const near = (a, b) => Math.abs(((a - b + 540) % 360) - 180) <= 60;
    const codes = [];
    if (near(ang, 270)) codes.push(-1);
    if (near(ang, 90)) codes.push(-2);
    if (near(ang, 180)) codes.push(-3);
    if (near(ang, 0)) codes.push(-4);
    return codes;
  }
  function dpadUpdate(id, codes) {
    const prev = dpadPointers.get(id) || [];
    for (const c of prev) if (codes.indexOf(c) < 0) release(c);
    for (const c of codes) if (prev.indexOf(c) < 0) { haptic(); press(c); }
    dpadPointers.set(id, codes);
  }
  dpad.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('ok')) return; e.preventDefault(); try { dpad.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } dpadUpdate(e.pointerId, dpadCodes(e)); });
  dpad.addEventListener('pointermove', (e) => { if (dpadPointers.has(e.pointerId)) dpadUpdate(e.pointerId, dpadCodes(e)); });
  const dpadEnd = (e) => { if (dpadPointers.has(e.pointerId)) { dpadUpdate(e.pointerId, []); dpadPointers.delete(e.pointerId); } };
  dpad.addEventListener('pointerup', dpadEnd); dpad.addEventListener('pointercancel', dpadEnd);

  // keyboard (desktop + phones with hardware keys)
  const KEYMAP = {
    ArrowUp: -1, ArrowDown: -2, ArrowLeft: -3, ArrowRight: -4, Enter: -5, NumpadEnter: -5, ' ': -5,
    F1: -6, F2: -7, '[': -6, ']': -7, Backspace: -8, Delete: -8, '*': 42, '#': 35, NumpadMultiply: 42,
  };
  // custom keys from Controls → Keyboard keys: { KeyboardEvent.code: J2ME key code }, checked before the defaults
  let keyBinds = {};
  try { keyBinds = JSON.parse(localStorage.getItem('kp:keys') || '{}') || {}; } catch (e) { /* storage blocked */ }
  let keyCapture = null; // set while the key editor waits for a key press
  function codeForKey(e) {
    if (e.code && keyBinds[e.code] !== undefined) return keyBinds[e.code];
    if (e.key && e.key.length === 1 && e.key >= '0' && e.key <= '9') return 48 + (+e.key);
    if (KEYMAP[e.key] !== undefined) return KEYMAP[e.key];
    if (KEYMAP[e.code] !== undefined) return KEYMAP[e.code];
    if (e.key === 'q' || e.key === 'Q' || e.key === 'SoftLeft') return -6;
    if (e.key === 'e' || e.key === 'E' || e.key === 'SoftRight') return -7;
    return null;
  }
  window.addEventListener('keydown', (e) => {
    if (keyCapture) { e.preventDefault(); keyCapture(e); return; }
    KP.audio.unlock();
    if (!emu || $('player').hidden) return;
    if (!$('modal').hidden) { if (e.key === 'Escape' && closeSheet) closeSheet(); return; }
    if (e.key === 'Escape') { e.preventDefault(); pauseMenu(); return; }
    const code = codeForKey(e);
    if (code === null) return;
    e.preventDefault();
    if (e.repeat) { if (!menuOpen) emu.keyDown(code); return; }
    press(code);
  });
  window.addEventListener('keyup', (e) => {
    if (!emu) return;
    const code = codeForKey(e);
    if (code === null) return;
    e.preventDefault();
    release(code);
  });
  window.addEventListener('blur', releaseAll);

  // touch / mouse on the game screen -> MIDP pointer events (rotation aware)
  function gamePoint(e) {
    const r = display.getBoundingClientRect();
    const w = prof.w, h = prof.h;
    const dw = prof.rotate ? h : w, dh = prof.rotate ? w : h;
    const s = Math.min(r.width / dw, r.height / dh);
    const X = (e.clientX - (r.left + (r.width - dw * s) / 2)) / s;
    const Y = (e.clientY - (r.top + (r.height - dh * s) / 2)) / s;
    let x = X, y = Y;
    if (prof.rotate === 270) { x = w - Y; y = X; } else if (prof.rotate === 90) { x = Y; y = h - X; }
    return [Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y))];
  }
  let screenPointer = null;
  display.addEventListener('pointerdown', (e) => {
    if (!emu || menuOpen) return;
    KP.audio.unlock();
    e.preventDefault();
    try { display.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    screenPointer = e.pointerId;
    const [x, y] = gamePoint(e);
    emu.pointer('press', x, y);
  });
  display.addEventListener('pointermove', (e) => { if (emu && screenPointer === e.pointerId) { const [x, y] = gamePoint(e); emu.pointer('drag', x, y); } });
  const screenUp = (e) => { if (emu && screenPointer === e.pointerId) { const [x, y] = gamePoint(e); emu.pointer('release', x, y); screenPointer = null; } };
  display.addEventListener('pointerup', screenUp); display.addEventListener('pointercancel', screenUp);

  // ---------------- menus ----------------
  function showGameMenu(labels, cb) {
    sheet('Options', (body, close) => {
      labels.forEach((l, i) => body.appendChild(opt('', l, () => { close(); cb(i); })));
      body.appendChild(opt('', 'Cancel', () => { close(); cb(-1); }));
    });
  }
  function showTextInput(title, text, max, cb) {
    sheet(title || 'Enter text', (body, close) => {
      const ta = document.createElement('textarea'); ta.id = 'kpTextInput'; ta.maxLength = max || 256; ta.value = text || '';
      body.appendChild(ta);
      const row = document.createElement('div'); row.className = 'row';
      row.append(opt('', 'Cancel', () => { close(); cb(null); }), opt('', 'OK', () => { close(); cb(ta.value); }, 'primary'));
      body.appendChild(row);
    });
  }

  function saveOverride(patch) {
    current.override = Object.assign({}, current.override || {}, patch);
    DB.put(current);
  }

  const SIZES = [[128, 128], [128, 160], [176, 208], [176, 220], [240, 320], [320, 240], [240, 400], [352, 416], [360, 640], [640, 360], [480, 800], [800, 480]];
  const ROT_LABEL = { 0: 'Off', 270: 'Left', 90: 'Right' };
  function pauseMenu() {
    if (!emu || menuOpen) return;
    releaseAll();
    menuOpen = true;
    pauseEmu();
    const resume = () => { menuOpen = false; resumeEmu(); };
    sheet(current.name, (body, close) => {
      body.appendChild(opt('', 'Resume', () => close(), 'primary'));
      if (CAN_ROTATE) {
        const o = current.orient || 'auto';
        body.appendChild(opt('📱', 'Phone orientation', () => {
          close();
          setOrientation(o === 'auto' ? 'landscape' : o === 'landscape' ? 'portrait' : 'auto', true);
        }, '', ORIENT_LABEL[o]));
      }
      const keysOn = !$('device').classList.contains('nokeys');
      body.appendChild(opt('⌨', 'Keypad', () => { close(); current.keypad = !keysOn; DB.put(current); applyLayout(); }, '', keysOn ? 'On' : 'Off'));
      body.appendChild(opt('🎨', 'Controls & theme', () => controlsSheet(), '', THEMES[ctl.theme] ? THEMES[ctl.theme].name : ''));
      body.appendChild(opt('⟳', 'Turn game picture', () => {
        close();
        const next = prof.rotate === 0 ? 270 : prof.rotate === 270 ? 90 : 0;
        saveOverride({ rotate: next });
        prof = profileOf(current);
        applyLayout();
        toast('Game picture: ' + ROT_LABEL[next]);
      }, '', ROT_LABEL[prof.rotate] || 'Off'));
      body.appendChild(opt('▣', 'Screen size', () => { close(); sizeMenu(); }, '', prof.w + '×' + prof.h));
      body.appendChild(opt('♪', 'Sound', () => { close(); setMuted(!muted); }, '', muted ? 'Off' : 'On'));
      if (window.MediaRecorder && display.captureStream) body.appendChild(opt('●', recorder ? 'Stop recording' : 'Record video', () => { close(); toggleRecord(); }));
      if (!IN_APP && document.documentElement.requestFullscreen) body.appendChild(opt('⛶', document.fullscreenElement ? 'Exit full screen' : 'Full screen', () => { close(); toggleFullscreen(); }));
      body.appendChild(opt('↺', 'Restart game', () => { menuOpen = false; close(); startGame(current); }));
      body.appendChild(opt('⌂', 'Exit to games', () => { menuOpen = false; close(); exitGame(); }, 'danger'));
    }, resume);
  }
  function sizeMenu() {
    menuOpen = true;
    releaseAll();
    pauseEmu();
    sheet('Screen size', (body, close) => {
      const p = document.createElement('p'); p.className = 'info'; p.textContent = 'Pick the size this game was made for. The game restarts.'; body.appendChild(p);
      for (const [w, h] of SIZES) {
        body.appendChild(opt('', w + ' × ' + h, () => {
          menuOpen = false; close();
          saveOverride({ w, h });
          startGame(current);
        }, '', w === prof.w && h === prof.h ? 'current' : undefined));
      }
    }, () => { menuOpen = false; resumeEmu(); });
  }

  // ---------------- controls sheet (themes, sizes, sides, keyboard keys) ----------------
  function inGame() { return !!emu && !$('player').hidden; }
  function holdGame() {
    if (!inGame()) return;
    menuOpen = true; releaseAll(); pauseEmu();
    $('modal').classList.add('peek'); // keypad stays visible behind the sheet as a live preview
  }
  function releaseGame() {
    keyCapture = null;
    $('modal').classList.remove('peek');
    if (inGame()) { menuOpen = false; resumeEmu(); }
  }
  function section(body, title) {
    const s = document.createElement('div'); s.className = 'sec';
    const h = document.createElement('h3'); h.textContent = title; s.appendChild(h);
    body.appendChild(s);
    return s;
  }
  function setVal(btn, text) { btn.querySelector('.val').textContent = text; }

  function controlsSheet() {
    holdGame();
    sheet('Controls & theme', (body, close) => {
      const changed = () => { saveCtl(); applyControls(); };

      const themeGrid = document.createElement('div'); themeGrid.className = 'themes';
      section(body, 'Keypad theme').appendChild(themeGrid);
      const swatches = document.createElement('div'); swatches.className = 'swatches';
      section(body, 'Button colour').appendChild(swatches);
      function renderLooks() {
        themeGrid.innerHTML = '';
        for (const id of Object.keys(THEMES)) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'tcard';
          b.setAttribute('aria-pressed', String(ctl.theme === id));
          const pv = document.createElement('span'); pv.className = 'pv';
          const vars = themeVars(id, ctl.accent);
          for (const k of THEME_VARS) pv.style.setProperty(k, vars[k]);
          pv.innerHTML = '<i></i><b></b><i class="hl"></i>';
          const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = THEMES[id].name;
          b.append(pv, nm);
          b.addEventListener('click', () => { ctl.theme = id; changed(); renderLooks(); });
          themeGrid.appendChild(b);
        }
        swatches.innerHTML = '';
        for (const c of ACCENTS) {
          const s = document.createElement('button'); s.type = 'button'; s.className = 'sw';
          s.setAttribute('aria-pressed', String((ctl.accent || '') === c));
          s.setAttribute('aria-label', c ? 'Colour ' + c : 'Theme colour');
          if (c) s.style.background = c;
          else { s.style.background = (THEMES[ctl.theme] || THEMES.midnight)['--hl']; s.style.color = (THEMES[ctl.theme] || THEMES.midnight)['--hl-ink']; s.textContent = 'A'; }
          s.addEventListener('click', () => { ctl.accent = c; changed(); renderLooks(); });
          swatches.appendChild(s);
        }
      }
      renderLooks();

      const sizes = section(body, 'Size');
      [['ks', 'Buttons'], ['ds', 'D-pad']].forEach(([key, label]) => {
        const row = document.createElement('div'); row.className = 'range';
        const id = 'ctl-' + key;
        row.innerHTML = '<label for="' + id + '"></label><input type="range" min="70" max="150" step="5" id="' + id + '"><output></output>';
        row.querySelector('label').textContent = label;
        const input = row.querySelector('input'), out = row.querySelector('output');
        input.value = ctl[key]; out.textContent = ctl[key] + '%';
        input.addEventListener('input', () => { ctl[key] = +input.value; out.textContent = input.value + '%'; changed(); });
        sizes.appendChild(row);
      });

      const lay = section(body, 'Layout');
      const side = opt('↔', 'D-pad side (phone sideways)', () => { ctl.swap = !ctl.swap; changed(); setVal(side, ctl.swap ? 'Right' : 'Left'); }, '', ctl.swap ? 'Right' : 'Left');
      const nums = opt('#', 'Number keys', () => { ctl.nonum = !ctl.nonum; changed(); setVal(nums, ctl.nonum ? 'Big 5 + OK' : 'Show'); }, '', ctl.nonum ? 'Big 5 + OK' : 'Show');
      const vib = opt('〰', 'Vibrate on key press', () => { ctl.haptic = !ctl.haptic; changed(); setVal(vib, ctl.haptic ? 'On' : 'Off'); }, '', ctl.haptic ? 'On' : 'Off');
      lay.append(side, nums, vib);
      lay.appendChild(opt('⌨', 'Keyboard / controller keys', () => keysSheet(), '', Object.keys(keyBinds).length ? Object.keys(keyBinds).length + ' custom' : 'Default'));
      lay.appendChild(opt('↺', 'Reset controls', () => {
        ctl = Object.assign({}, CTL_DEFAULT); changed(); controlsSheet();
      }));

      body.appendChild(opt('', 'Done', () => close(), 'primary'));
    }, releaseGame);
  }

  const KEY_ACTIONS = [
    [-1, 'Up', '↑'], [-2, 'Down', '↓'], [-3, 'Left', '←'], [-4, 'Right', '→'], [-5, 'OK / Fire', 'Enter · Space'],
    [-6, 'Left soft key', 'F1 · Q'], [-7, 'Right soft key', 'F2 · E'], [-8, 'Clear (C)', 'Backspace'],
    [49, '1', '1'], [50, '2', '2'], [51, '3', '3'], [52, '4', '4'], [53, '5', '5'], [54, '6', '6'],
    [55, '7', '7'], [56, '8', '8'], [57, '9', '9'], [42, '*', '*'], [48, '0', '0'], [35, '#', '#'],
  ];
  function keyName(c) {
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit\d$/.test(c)) return c.slice(5);
    if (/^Numpad\d$/.test(c)) return 'Num ' + c.slice(6);
    return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt' }[c] || c;
  }
  function saveKeys() { try { localStorage.setItem('kp:keys', JSON.stringify(keyBinds)); } catch (e) { /* ignore */ } }

  function keysSheet() {
    holdGame();
    sheet('Keyboard / controller keys', (body, close) => {
      const p = document.createElement('p'); p.className = 'info';
      p.textContent = 'Tap a phone key, then press the keyboard or game-controller key you want for it. The default keys keep working.';
      body.appendChild(p);
      const list = document.createElement('div'); body.appendChild(list);
      function render(waiting) {
        list.innerHTML = '';
        for (const [code, label, def] of KEY_ACTIONS) {
          const mine = Object.keys(keyBinds).filter((c) => keyBinds[c] === code).map(keyName);
          const b = opt('', label, () => {
            render(code);
            keyCapture = (e) => {
              keyCapture = null;
              if (e.key === 'Escape' || !e.code) { render(); return; }
              for (const c of Object.keys(keyBinds)) if (keyBinds[c] === code) delete keyBinds[c];
              keyBinds[e.code] = code;
              saveKeys(); render();
            };
          }, 'keyrow' + (waiting === code ? ' wait' : ''), '');
          const v = b.querySelector('.val');
          if (waiting === code) v.textContent = 'Press a key…';
          else { if (mine.length) { const m = document.createElement('b'); m.textContent = mine.join(' · '); v.appendChild(m); } v.appendChild(document.createTextNode(def)); }
          list.appendChild(b);
        }
      }
      render();
      const row = document.createElement('div'); row.className = 'row';
      row.append(opt('', 'Reset keys', () => { keyBinds = {}; saveKeys(); keyCapture = null; render(); }), opt('', 'Back', () => controlsSheet(), 'primary'));
      body.appendChild(row);
    }, releaseGame);
  }

  // ---------------- about / credits ----------------
  const NETWORK = [
    ['https://codelove.in', 'CodeLove', 'codelove.in'],
    ['https://models.codelove.in', 'Free 3D Models', 'models.codelove.in'],
    ['https://games.codelove.in', 'Free 3D Games', 'games.codelove.in'],
    ['https://downloader.codelove.in', 'Insta & Pinterest Downloader', 'downloader.codelove.in'],
    ['https://linkinbio.codelove.in', 'Link in Bio', 'linkinbio.codelove.in'],
    ['https://videotogif.codelove.in', 'Video to GIF', 'videotogif.codelove.in'],
    ['https://videotoimages.codelove.in', 'Video to Images', 'videotoimages.codelove.in'],
    ['https://utubeflow.codelove.in', 'Free YouTube Automation', 'utubeflow.codelove.in'],
  ];
  function aboutSheet() {
    sheet('About JavaPlay', (body, close) => {
      const sites = NETWORK.map(([u, n, d]) => '<a href="' + u + '" target="_blank" rel="noopener">' + esc(n) + '<small>' + esc(d) + '</small></a>').join('');
      body.insertAdjacentHTML('beforeend',
        '<div class="about-top"><img src="assets/javaplay-logo.png" alt="" width="56" height="56"><div><strong>JavaPlay</strong>' +
        '<span>Version ' + VERSION + (IN_APP ? ' · Android app' : ' · Web player') + '<br>Free J2ME emulator for old Java phone games</span></div></div>' +
        '<div class="sec"><h3>Credits</h3>' +
        '<a class="credit" href="https://gowtham.codelove.in" target="_blank" rel="noopener"><span class="av">G</span><span><strong>Made by Gowtham</strong><small>Design, code and the JavaPlay engine · gowtham.codelove.in</small></span><span class="go">›</span></a>' +
        '<a class="credit" href="https://codelove.in" target="_blank" rel="noopener"><span class="av cl">♥</span><span><strong>A CodeLove product</strong><small>Free tools and games · codelove.in</small></span><span class="go">›</span></a>' +
        '<a class="credit" href="https://javaplay.codelove.in" target="_blank" rel="noopener"><span class="av">▶</span><span><strong>JavaPlay website</strong><small>Play in the browser, get the app · javaplay.codelove.in</small></span><span class="go">›</span></a>' +
        '</div>' +
        '<div class="sec"><h3>More from CodeLove</h3><div class="sites">' + sites + '</div></div>' +
        '<a class="cl-banner" href="https://codelove.in" target="_blank" rel="noopener" aria-label="CodeLove – codelove.in"><img src="assets/codelove-footer.png" alt="CodeLove" width="704" height="144"></a>' +
        '<p class="fine">The Java engine (bytecode VM, MIDP 2.0, Nokia UI) is written from scratch for JavaPlay. ' +
        'Free games in the catalog belong to their authors and are shared under their own open licenses; see each game\'s details.<br>' +
        'Made with <span class="heart">♥</span> by Gowtham · © ' + new Date().getFullYear() + ' CodeLove</p>');
      if (CAN_UPDATE) body.appendChild(opt('⟳', 'Check for updates', () => { close(); checkUpdate(true); }));
      else if (!IN_APP) body.insertAdjacentHTML('beforeend', '<a class="btn" style="width:100%;margin-bottom:8px" href="' + SITE + 'download/JavaPlay.apk" download>Get the Android app</a>');
      body.appendChild(opt('', 'Close', () => close(), 'primary'));
    });
  }
  $('aboutBtn').addEventListener('click', () => aboutSheet());

  // ---------------- in-app updates (Android) ----------------
  // web/version.json is written by the Gradle task publishApk together with web/download/JavaPlay.apk
  const CAN_UPDATE = !!(Bridge && Bridge.versionCode && Bridge.downloadUpdate);
  let updateUi = null; // { bar, label, btn } while the update sheet is open
  async function fetchLatest() {
    const r = await fetch(SITE + 'version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  async function checkUpdate(manual) {
    if (!CAN_UPDATE) return;
    let v;
    try { v = await fetchLatest(); } catch (e) { if (manual) toast('Could not check for updates. Check your internet connection.', 3500); return; }
    const have = Bridge.versionCode();
    if (!(v.versionCode > have)) { if (manual) toast('You have the latest version (' + VERSION + ').', 3000); return; }
    if (!manual) {
      let skip = null;
      try { skip = JSON.parse(localStorage.getItem('kp:updLater') || 'null'); } catch (e) { /* ignore */ }
      if (skip && skip.code === v.versionCode && Date.now() - skip.at < 864e5) return; // "Later" = ask again tomorrow
      if (emu) return; // never interrupt a game
    }
    updateSheet(v);
  }
  function updateSheet(v) {
    sheet('Update available', (body, close) => {
      const p = document.createElement('p'); p.className = 'info';
      p.textContent = 'JavaPlay ' + v.versionName + ' is ready. You have ' + VERSION + '. Your games and saves stay.';
      body.appendChild(p);
      if (v.notes && v.notes.length) {
        const ul = document.createElement('ul'); ul.className = 'notes';
        v.notes.forEach((n) => { const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); });
        body.appendChild(ul);
      }
      const prog = document.createElement('div'); prog.className = 'progress fixed'; prog.hidden = true; prog.innerHTML = '<span></span>';
      const label = document.createElement('p'); label.className = 'info upd-label'; label.hidden = true;
      body.append(prog, label);
      const btn = opt('', 'Update now', () => {
        btn.disabled = true; prog.hidden = false; label.hidden = false; label.textContent = 'Downloading…';
        Bridge.downloadUpdate(v.apk);
      }, 'primary');
      body.appendChild(btn);
      body.appendChild(opt('', 'Later', () => {
        try { localStorage.setItem('kp:updLater', JSON.stringify({ code: v.versionCode, at: Date.now() })); } catch (e) { /* ignore */ }
        close();
      }));
      updateUi = { bar: prog.firstChild, label, btn, prog };
    }, () => { updateUi = null; });
  }
  const updateCallbacks = {
    updateProgress(pct) {
      if (!updateUi) return;
      if (pct >= 0) { updateUi.bar.style.width = pct + '%'; updateUi.label.textContent = 'Downloading… ' + pct + '%'; }
    },
    updateNeedsPermission() {
      if (updateUi) { updateUi.label.textContent = 'Allow “Install unknown apps” for JavaPlay, then come back.'; updateUi.btn.disabled = false; }
    },
    updateInstalling() {
      if (updateUi) { updateUi.bar.style.width = '100%'; updateUi.label.textContent = 'Tap Update in the installer to finish.'; updateUi.btn.disabled = false; }
    },
    updateFailed(msg) {
      if (updateUi) { updateUi.prog.hidden = true; updateUi.label.textContent = 'Update failed: ' + msg; updateUi.btn.disabled = false; }
      else toast('Update failed: ' + msg, 4000);
    },
  };
  $('ctlBtn').addEventListener('click', () => controlsSheet());

  // ---------------- sound / fullscreen ----------------
  let muted = false;
  try { muted = localStorage.getItem('kp:muted') === '1'; } catch (e) { /* ignore */ }
  KP.audio.setMuted(muted);
  function setMuted(m) {
    muted = m;
    KP.audio.setMuted(m);
    if (emu) emu.host.muted = m;
    $('muteBtn').classList.toggle('muted', m);
    try { localStorage.setItem('kp:muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (emu) toast(m ? 'Sound off' : 'Sound on');
  }
  $('muteBtn').classList.toggle('muted', muted);
  $('muteBtn').addEventListener('click', () => setMuted(!muted));
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await $('app').requestFullscreen();
      if (prof && prof.landscape && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    } catch (e) { toast('Full screen is not available here.'); }
  }

  // ---------------- recording ----------------
  let recorder = null, recChunks = [], recStart = 0, recTimer = null, recDest = null;
  function stopRecording() { if (recorder && recorder.state !== 'inactive') recorder.stop(); }
  function toggleRecord() {
    if (recorder) { stopRecording(); return; }
    if (!emu) return;
    const stream = display.captureStream(30);
    const ac = KP.audio.ensure();
    if (ac && ac.createMediaStreamDestination) {
      recDest = ac.createMediaStreamDestination();
      KP.audio.master.connect(recDest);
      recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    }
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const mimeType = types.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    try { recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 5e6 } : undefined); } catch (e) { toast('Recording is not supported here.'); return; }
    recChunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(recTimer);
      $('recBadge').hidden = true;
      if (recDest) { try { KP.audio.master.disconnect(recDest); } catch (e) { /* ignore */ } recDest = null; }
      const blob = new Blob(recChunks, { type: recorder.mimeType || 'video/webm' });
      const ext = (recorder.mimeType || '').indexOf('mp4') >= 0 ? 'mp4' : 'webm';
      const name = (current ? current.name : 'javaplay').replace(/[^\w-]+/g, '_') + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.' + ext;
      recorder = null;
      saveBlob(blob, name);
    };
    recorder.start(1000);
    recStart = Date.now();
    $('recBadge').hidden = false; $('recTime').textContent = '0:00';
    recTimer = setInterval(() => { const s = Math.floor((Date.now() - recStart) / 1000); $('recTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 500);
    toast('Recording. Open the menu and choose Stop recording to save.', 3500);
  }
  $('recBadge').addEventListener('click', () => stopRecording());
  function saveBlob(blob, name) {
    if (Bridge && Bridge.saveFile) {
      const r = new FileReader();
      r.onload = () => { Bridge.saveFile(name, String(r.result).split(',')[1], blob.type); };
      r.readAsDataURL(blob);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('Video saved: ' + name, 4000);
  }

  // ---------------- free games store ----------------
  const SITE = 'https://javaplay.codelove.in/';
  const BASE = (IN_APP || location.protocol === 'file:') ? SITE : '';
  let catalog = null, storeCat = 'All', storeQuery = '', libCount = 0;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function loadCatalog() {
    if (catalog) return catalog;
    const r = await fetch(BASE + 'games/catalog.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    catalog = await r.json();
    $('freeCount').textContent = catalog.count;
    return catalog;
  }

  function setTab(free) {
    $('tabMine').setAttribute('aria-selected', String(!free));
    $('tabFree').setAttribute('aria-selected', String(free));
    $('homeBody').hidden = free;
    $('storeBody').hidden = !free;
    $('fab').hidden = free || libCount === 0;
    if (free) renderStore();
  }
  $('tabMine').addEventListener('click', () => setTab(false));
  $('tabFree').addEventListener('click', () => setTab(true));
  $('emptyFree').addEventListener('click', () => setTab(true));

  async function renderStore() {
    const msg = $('storeMsg');
    try { await loadCatalog(); } catch (e) {
      msg.hidden = false;
      msg.textContent = 'Could not load the free games list. Check your internet connection and try again.';
      return;
    }
    msg.hidden = true;
    if (!$('storeChips').children.length) {
      const names = ['All'].concat(Object.keys(catalog.categories).sort());
      $('storeChips').innerHTML = names.map((c) => '<button class="chip" type="button" data-cat="' + esc(c) + '" aria-pressed="' + (c === storeCat) + '">' + esc(c) + '</button>').join('');
    }
    const installed = new Set((await DB.all()).map((g) => g.catalogId).filter(Boolean));
    const words = storeQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const list = catalog.games.filter((g) => (storeCat === 'All' || g.cat === storeCat) && words.every((w) => (g.name + ' ' + g.cat + ' ' + g.desc).toLowerCase().indexOf(w) >= 0));
    $('storeGrid').innerHTML = list.map((g) =>
      '<button class="scard" type="button" data-id="' + esc(g.id) + '">' +
      '<span class="shot">' + (g.shot ? '<img loading="lazy" alt="" src="' + esc(BASE + g.shot) + '">' : '') +
      (installed.has(g.id) ? '<span class="got">✓ added</span>' : '') + '</span>' +
      '<span class="nm">' + esc(g.name) + '</span><span class="ct">' + esc(g.cat) + '</span></button>').join('');
    if (!list.length) { msg.hidden = false; msg.textContent = 'No games match that search.'; }
  }
  $('storeChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    storeCat = b.dataset.cat;
    $('storeChips').querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    renderStore();
  });
  $('storeQ').addEventListener('input', (e) => { storeQuery = e.target.value; renderStore(); });
  $('storeGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.scard');
    if (b && catalog) storeDetail(catalog.games.find((g) => g.id === b.dataset.id));
  });

  function storeDetail(g) {
    if (!g) return;
    sheet(g.name, (body, close) => {
      const d = document.createElement('div'); d.className = 'detail';
      d.innerHTML = '<span class="shot">' + (g.shot ? '<img alt="" src="' + esc(BASE + g.shot) + '">' : '') + '</span>' +
        '<div><p>' + esc(g.desc) + '</p><small>' + esc(g.cat) + ' · ' + g.kb + ' KB<br>By ' + esc(g.author) + '<br>License: ' + esc(g.license) +
        ' · <a href="' + esc(g.source) + '" target="_blank" rel="noopener">source</a></small></div>';
      body.appendChild(d);
      const prog = document.createElement('div'); prog.className = 'progress'; prog.hidden = true; prog.innerHTML = '<span></span>';
      body.appendChild(prog);
      const play = opt('', '▶  Play', async () => {
        play.disabled = true; prog.hidden = false;
        const ok = await playCatalogGame(g);
        if (ok) close(); else { play.disabled = false; prog.hidden = true; }
      }, 'primary');
      body.appendChild(play);
      body.appendChild(opt('', 'Close', () => close()));
    });
  }

  async function playCatalogGame(g) {
    const have = (await DB.all()).find((r) => r.catalogId === g.id);
    if (have) { startGame(have); return true; }
    try {
      const r = await fetch(BASE + g.jar);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const rec = await addJarBytes(g.jar.split('/').pop(), bytes);
      if (!rec) return false;
      rec.catalogId = g.id;
      rec.name = g.name;
      if (g.shot) rec.shot = BASE + g.shot;
      const o = {};
      if (g.size) { const m = /^(\d+)x(\d+)$/.exec(g.size); if (m) { o.w = +m[1]; o.h = +m[2]; } }
      if (g.rotate) o.rotate = g.rotate;
      if (g.controls === 'touch') o.touch = true;
      if (Object.keys(o).length) rec.override = o;
      await DB.put(rec);
      renderLibrary();
      startGame(rec);
      return true;
    } catch (e) {
      toast('Download failed. Check your internet connection.', 3500);
      note('Could not download ' + g.name + '. Check your internet connection.');
      return false;
    }
  }

  // ---------------- lifecycle ----------------
  document.addEventListener('visibilitychange', () => {
    if (!emu) return;
    if (document.hidden) { if (!recorder) { releaseAll(); pauseEmu(); } } else if (!menuOpen) resumeEmu();
  });
  window.addEventListener('pointerdown', () => KP.audio.unlock(), { capture: true });

  $('jarInput').addEventListener('change', (e) => { handleFiles(Array.from(e.target.files || [])); e.target.value = ''; });
  const home = $('home');
  ['dragenter', 'dragover'].forEach((ev) => home.addEventListener(ev, (e) => { e.preventDefault(); home.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => home.addEventListener(ev, (e) => { e.preventDefault(); home.classList.remove('drag'); }));
  home.addEventListener('drop', (e) => handleFiles(Array.from(e.dataTransfer.files || [])));

  // called by the Android app
  window.JavaPlayApp = {
    async openJarBase64(name, b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const rec = await addJarBytes(name, bytes);
      await renderLibrary();
      if (rec) startGame(rec);
    },
    back() {
      if (!$('modal').hidden && closeSheet) { closeSheet(); return true; }
      if (emu) { pauseMenu(); return true; }
      return false;
    },
    videoSaved(ok) { toast(ok ? 'Video saved to Movies/JavaPlay' : 'Could not save the video', 3500); },
  };
  Object.assign(window.JavaPlayApp, updateCallbacks);

  (async function init() {
    if (typeof BigInt === 'undefined' || typeof BigInt64Array === 'undefined') {
      $('empty').hidden = false;
      note('This browser is too old for JavaPlay. Update Chrome or "Android System WebView" from the Play Store.');
      return;
    }
    await DB.open();
    applyControls();
    await renderLibrary();
    // ?jar=<url> loads a game directly (demo links and automated tests); &size=WxH &touch=1 &rotate=270
    const q = new URLSearchParams(location.search);
    const url = q.get('jar');
    if (url) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const rec = await addJarBytes(url.split('/').pop(), bytes);
        if (rec) {
          const size = /^(\d+)x(\d+)$/.exec(q.get('size') || '');
          const o = {};
          if (size) { o.w = +size[1]; o.h = +size[2]; }
          if (q.get('touch')) o.touch = q.get('touch') === '1';
          if (q.get('rotate')) o.rotate = +q.get('rotate');
          if (Object.keys(o).length) { rec.override = o; await DB.put(rec); }
          await renderLibrary();
          startGame(rec);
        }
      } catch (e) { note('Could not load ' + url); }
      return;
    }
    // ?game=<catalog id> (Play buttons on the website)
    const gid = q.get('game');
    if (gid) {
      try {
        const cat = await loadCatalog();
        const g = cat.games.find((x) => x.id === gid);
        if (g) { await playCatalogGame(g); return; }
      } catch (e) { /* fall through to the library */ }
    }
    // first run: show the free games so there is something to play right away
    if (libCount === 0) setTab(true);
    else loadCatalog().catch(() => {});
    setTimeout(() => checkUpdate(false), 1500);
  })();
})();
