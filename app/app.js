/* KeyPlay player UI – game library, engine host, keypad / keyboard / touch input, recording. */
(function () {
  'use strict';
  const KP = window.KP;
  const $ = (id) => document.getElementById(id);
  const Bridge = window.KeyPlayAndroid || null; // present inside the Android app

  // ---------------- IndexedDB game library ----------------
  const DB = {
    db: null,
    open() {
      return new Promise((resolve) => {
        if (!window.indexedDB) { resolve(null); return; }
        const req = indexedDB.open('keyplay', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('games', { keyPath: 'id' });
        req.onsuccess = () => { DB.db = req.result; resolve(DB.db); };
        req.onerror = () => resolve(null);
      });
    },
    tx(mode) { return DB.db.transaction('games', mode).objectStore('games'); },
    all() {
      return new Promise((resolve) => {
        if (!DB.db) { resolve(DB.mem ? Object.values(DB.mem) : []); return; }
        const r = DB.tx('readonly').getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => resolve([]);
      });
    },
    put(rec) {
      return new Promise((resolve) => {
        if (!DB.db) { (DB.mem = DB.mem || {})[rec.id] = rec; resolve(); return; }
        const r = DB.tx('readwrite').put(rec);
        r.onsuccess = () => resolve(); r.onerror = () => resolve();
      });
    },
    del(id) {
      return new Promise((resolve) => {
        if (!DB.db) { if (DB.mem) delete DB.mem[id]; resolve(); return; }
        const r = DB.tx('readwrite').delete(id);
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
    } catch (e) { toastLib('“' + fileName + '” is not a valid .jar file.'); return null; }
    if (!props['MIDlet-1'] && !jar.names().some((n) => n.endsWith('.class'))) { toastLib('“' + fileName + '” has no Java game inside.'); return null; }
    const profile = KP.detectProfile(jar, props, fileName);
    const rec = {
      id: fnvHash(bytes),
      name: props['MIDlet-Name'] || fileName.replace(/\.jar$/i, ''),
      vendor: props['MIDlet-Vendor'] || '',
      fileName,
      icon: iconDataUrl(jar, props),
      w: profile.w, h: profile.h, touch: profile.touch,
      added: Date.now(),
      jar: bytes,
    };
    await DB.put(rec);
    return rec;
  }

  async function handleFiles(files) {
    let last = null;
    for (const f of files) {
      if (!/\.jar$/i.test(f.name)) { if (/\.jad$/i.test(f.name)) toastLib('Pick the .jar file, not the .jad. The .jar has the game.'); continue; }
      const buf = new Uint8Array(await f.arrayBuffer());
      last = await addJarBytes(f.name, buf) || last;
    }
    await renderLibrary();
    if (last && files.length === 1) startGame(last);
  }

  let libToastTimer = null;
  function toastLib(msg) {
    let el = $('libToast');
    if (!el) { el = document.createElement('p'); el.id = 'libToast'; el.className = 'lib-note'; el.style.color = 'var(--accent)'; $('library').insertBefore(el, $('gameGrid')); }
    el.textContent = msg;
    clearTimeout(libToastTimer);
    libToastTimer = setTimeout(() => el.remove(), 5000);
  }

  async function renderLibrary() {
    const list = (await DB.all()).sort((a, b) => (b.played || b.added) - (a.played || a.added));
    const grid = $('gameGrid');
    grid.querySelectorAll('.card').forEach((c) => c.remove());
    for (const g of list) {
      const card = document.createElement('div');
      card.className = 'card'; card.tabIndex = 0; card.setAttribute('role', 'button');
      card.setAttribute('aria-label', 'Play ' + g.name);
      const icon = g.icon ? '<img alt="" src="' + g.icon + '">' : '<span class="noicon">' + (g.name[0] || '?').toUpperCase() + '</span>';
      card.innerHTML = icon + '<span class="name"></span><span class="meta"></span><button class="del" type="button" aria-label="Remove game">×</button>';
      card.querySelector('.name').textContent = g.name;
      card.querySelector('.meta').textContent = g.w + '×' + g.h + (g.touch ? ' · touch' : '') + (g.vendor ? ' · ' + g.vendor : '');
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) { e.stopPropagation(); confirmDelete(g); return; }
        startGame(g);
      });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(g); });
      grid.appendChild(card);
    }
  }

  function confirmDelete(g) {
    sheet('Remove “' + g.name + '”?', (body, close) => {
      const p = document.createElement('p'); p.className = 'info'; p.textContent = 'The game and its saved progress are removed from this device.'; body.appendChild(p);
      const row = document.createElement('div'); row.className = 'row';
      row.append(btn('Cancel', () => close()), btn('Remove', async () => {
        close();
        await DB.del(g.id);
        try { Object.keys(localStorage).filter((k) => k.startsWith('kp:' + g.id + ':')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* storage blocked */ }
        renderLibrary();
      }, true));
      body.appendChild(row);
    });
  }

  // ---------------- modal sheet ----------------
  function btn(label, fn, primary) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'opt' + (primary ? ' primary' : ''); b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }
  let sheetOpen = null;
  function sheet(title, build, onClose) {
    const modal = $('modal'), body = $('modalBody');
    $('modalTitle').textContent = title;
    body.innerHTML = '';
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      modal.hidden = true; sheetOpen = null;
      if (onClose) onClose();
      if (!$('player').hidden) $('screen').focus({ preventScroll: true });
    };
    sheetOpen = close;
    build(body, close);
    modal.hidden = false;
    const first = body.querySelector('textarea, input, .opt');
    if (first) first.focus();
    return close;
  }
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal') && sheetOpen) sheetOpen(); });

  // ---------------- player ----------------
  let emu = null, current = null, dirty = false, paused = false, userPaused = false;
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

  function startGame(rec) {
    stopGame();
    current = rec;
    rec.played = Date.now();
    DB.put(rec);
    $('library').hidden = true;
    $('player').hidden = false;
    $('gameTitle').textContent = rec.name;
    $('keypadBtn').hidden = false;
    $('recBtn').hidden = !(window.MediaRecorder && display.captureStream);
    try {
      emu = new KP.Emulator({
        jarBytes: rec.jar,
        fileName: rec.fileName,
        profile: rec.override || null,
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
        warn: (s) => console.warn('[keyplay] ' + s),
        onError: (msg) => toast('Game error: ' + msg, 6000),
      });
    } catch (e) {
      toast('Could not start this game: ' + e.message, 6000);
      return;
    }
    window.KPDebug = { emu };
    const p = emu.profile;
    const dev = $('device');
    dev.classList.toggle('landscape', p.landscape);
    dev.classList.toggle('portrait', !p.landscape);
    dev.classList.toggle('nokeys', !!p.touch && !rec.forceKeys);
    $('softL').textContent = ''; $('softR').textContent = '';
    if (Bridge && Bridge.setOrientation) Bridge.setOrientation(p.landscape ? 'landscape' : 'portrait');
    resizeDisplay();
    emu.start();
    paused = false; userPaused = false;
    display.focus({ preventScroll: true });
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
    $('library').hidden = false;
    $('gameTitle').textContent = '';
    $('keypadBtn').hidden = true;
    $('recBtn').hidden = true;
    if (Bridge && Bridge.setOrientation) Bridge.setOrientation('auto');
    renderLibrary();
  }

  function pauseEmu() { if (emu && !paused) { emu.pause(); paused = true; } }
  function resumeEmu() { if (emu && paused) { emu.resume(); paused = false; } }

  // crisp integer scaling of the phone screen
  let scale = 1;
  function resizeDisplay() {
    if (!emu) return;
    const { w, h } = emu.profile;
    const wrap = $('screenWrap');
    const dpr = window.devicePixelRatio || 1;
    const fit = Math.min(wrap.clientWidth * dpr / w, wrap.clientHeight * dpr / h);
    // at least 3x internally so recorded videos stay sharp (CSS scales it down on small screens)
    scale = Math.max(3, Math.min(8, Math.floor(fit) || 1));
    if (display.width !== w * scale || display.height !== h * scale) {
      display.width = w * scale; display.height = h * scale;
    }
    dctx.imageSmoothingEnabled = false;
    dirty = true;
  }
  window.addEventListener('resize', resizeDisplay);
  if (window.ResizeObserver) new ResizeObserver(resizeDisplay).observe($('screenWrap'));

  function frame() {
    if (emu && (dirty || recorder)) {
      dirty = false;
      const src = emu.host.screen.canvas;
      dctx.imageSmoothingEnabled = false;
      dctx.drawImage(src, 0, 0, display.width, display.height);
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
    if (!emu) return;
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
  function releaseAll() { for (const code of Array.from(active.keys())) { const a = active.get(code); a.count = 1; release(code); } }
  function markKey(code, on) {
    document.querySelectorAll('.k[data-key="' + code + '"], .ok[data-key="' + code + '"]').forEach((el) => el.classList.toggle('down', on));
    const dp = $('dpad');
    const dir = { '-1': 'up', '-2': 'down', '-3': 'left', '-4': 'right' }[code];
    if (dir) dp.classList.toggle(dir, on);
  }
  function haptic() { if (Bridge && Bridge.vibrate) Bridge.vibrate(12); else if (navigator.vibrate) navigator.vibrate(8); }

  // keypad buttons
  document.querySelectorAll('.k[data-key], .ok[data-key]').forEach((el) => {
    const code = +el.dataset.key;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); haptic(); press(code); });
    const up = (e) => { e.preventDefault(); release(code); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  document.querySelector('.k.menu').addEventListener('click', () => showEmuMenu());

  // D-pad: slide between directions, diagonals near 45°
  const dpad = $('dpad');
  const dpadPointers = new Map();
  function dpadCodes(e) {
    const r = dpad.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const dist = Math.hypot(x, y);
    if (dist < r.width * 0.12) return [];
    const ang = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; // 0 = right, 90 = down
    const codes = [];
    const near = (a, b) => Math.abs(((a - b + 540) % 360) - 180) <= 60; // 120° sectors -> 30° diagonal bands
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
  dpad.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('ok')) return; e.preventDefault(); dpad.setPointerCapture(e.pointerId); dpadUpdate(e.pointerId, dpadCodes(e)); });
  dpad.addEventListener('pointermove', (e) => { if (dpadPointers.has(e.pointerId)) dpadUpdate(e.pointerId, dpadCodes(e)); });
  const dpadEnd = (e) => { if (dpadPointers.has(e.pointerId)) { dpadUpdate(e.pointerId, []); dpadPointers.delete(e.pointerId); } };
  dpad.addEventListener('pointerup', dpadEnd); dpad.addEventListener('pointercancel', dpadEnd);

  // keyboard
  const KEYMAP = {
    ArrowUp: -1, ArrowDown: -2, ArrowLeft: -3, ArrowRight: -4, Enter: -5, NumpadEnter: -5, ' ': -5,
    F1: -6, F2: -7, '[': -6, ']': -7, Backspace: -8, Delete: -8, '*': 42, '#': 35, NumpadMultiply: 42,
  };
  function codeForKey(e) {
    if (e.key >= '0' && e.key <= '9' && e.key.length === 1) return 48 + (+e.key);
    if (KEYMAP[e.key] !== undefined) return KEYMAP[e.key];
    if (KEYMAP[e.code] !== undefined) return KEYMAP[e.code];
    if (e.key === 'q' || e.key === 'Q') return -6;
    if (e.key === 'e' || e.key === 'E') return -7;
    return null;
  }
  window.addEventListener('keydown', (e) => {
    KP.audio.unlock();
    if (!emu || !$('modal').hidden || $('player').hidden) return;
    const code = codeForKey(e);
    if (code === null) return;
    e.preventDefault();
    if (e.repeat) { emu.keyDown(code); return; }
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

  // touch / mouse on the game screen -> MIDP pointer events
  function gamePoint(e) {
    const r = display.getBoundingClientRect();
    const { w, h } = emu.profile;
    const s = Math.min(r.width / w, r.height / h);
    const ox = r.left + (r.width - w * s) / 2, oy = r.top + (r.height - h * s) / 2;
    return [Math.max(0, Math.min(w - 1, (e.clientX - ox) / s)), Math.max(0, Math.min(h - 1, (e.clientY - oy) / s))];
  }
  let screenPointer = null;
  display.addEventListener('pointerdown', (e) => {
    if (!emu) return;
    KP.audio.unlock();
    e.preventDefault();
    display.setPointerCapture(e.pointerId);
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
      labels.forEach((l, i) => body.appendChild(btn(l, () => { close(); cb(i); })));
      body.appendChild(btn('Cancel', () => { close(); cb(-1); }));
    });
  }
  function showTextInput(title, text, max, cb) {
    sheet(title || 'Enter text', (body, close) => {
      const ta = document.createElement('textarea'); ta.id = 'kpTextInput'; ta.maxLength = max || 256; ta.value = text || '';
      body.appendChild(ta);
      const row = document.createElement('div'); row.className = 'row';
      row.append(btn('Cancel', () => { close(); cb(null); }), btn('OK', () => { close(); cb(ta.value); }, true));
      body.appendChild(row);
    });
  }
  const SIZES = [[128, 128], [128, 160], [176, 208], [176, 220], [240, 320], [320, 240], [240, 400], [352, 416], [360, 640], [640, 360]];
  function showEmuMenu() {
    if (!emu) return;
    userPaused = true; pauseEmu();
    sheet(current.name, (body, close) => {
      body.appendChild(btn('Resume', () => { userPaused = false; close(); resumeEmu(); }, true));
      body.appendChild(btn('Restart game', () => { userPaused = false; close(); startGame(current); }));
      body.appendChild(btn('Screen size: ' + emu.profile.w + '×' + emu.profile.h, () => {
        close();
        sheet('Screen size', (b2, close2) => {
          const p = document.createElement('p'); p.className = 'info'; p.textContent = 'Pick the size this game was made for. The game restarts.'; b2.appendChild(p);
          for (const [w, h] of SIZES) b2.appendChild(btn(w + ' × ' + h + (w === emu.profile.w && h === emu.profile.h ? '  (current)' : ''), () => {
            close2();
            current.override = { w, h, landscape: w > h, touch: emu.profile.touch };
            current.w = w; current.h = h;
            DB.put(current); userPaused = false; startGame(current);
          }));
        });
      }));
      body.appendChild(btn('Exit to library', () => { userPaused = false; close(); exitGame(); }));
    }, () => { if (userPaused) { userPaused = false; resumeEmu(); } });
  }

  // ---------------- top bar ----------------
  let muted = false;
  try { muted = localStorage.getItem('kp:muted') === '1'; } catch (e) { /* ignore */ }
  KP.audio.setMuted(muted);
  $('muteBtn').classList.toggle('muted', muted);
  $('muteBtn').addEventListener('click', () => {
    muted = !muted;
    KP.audio.setMuted(muted);
    if (emu) emu.host.muted = muted;
    $('muteBtn').classList.toggle('muted', muted);
    try { localStorage.setItem('kp:muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
  });
  $('homeBtn').addEventListener('click', () => { if (emu) exitGame(); });
  $('keypadBtn').addEventListener('click', () => {
    const dev = $('device');
    const hide = !dev.classList.contains('nokeys');
    dev.classList.toggle('nokeys', hide);
    if (current) { current.forceKeys = !hide; DB.put(current); }
    resizeDisplay();
  });
  $('fsBtn').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await $('app').requestFullscreen();
      if (emu && emu.profile.landscape && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    } catch (e) { toast('Full screen is not available here.'); }
  });

  // ---------------- recording ----------------
  let recorder = null, recChunks = [], recStart = 0, recTimer = null, recDest = null;
  function stopRecording() { if (recorder && recorder.state !== 'inactive') recorder.stop(); }
  $('recBtn').addEventListener('click', () => {
    if (recorder) { stopRecording(); return; }
    if (!emu) return;
    const stream = display.captureStream(30);
    const ac = KP.audio.ensure();
    if (ac) {
      recDest = ac.createMediaStreamDestination();
      KP.audio.master.connect(recDest);
      recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    }
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const mimeType = types.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    try { recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 5e6 } : undefined); } catch (e) { toast('Recording is not supported in this browser.'); return; }
    recChunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(recTimer);
      $('recBtn').classList.remove('recording'); $('recTime').textContent = '';
      if (recDest) { try { KP.audio.master.disconnect(recDest); } catch (e) { /* ignore */ } recDest = null; }
      const blob = new Blob(recChunks, { type: recorder.mimeType || 'video/webm' });
      const ext = (recorder.mimeType || '').indexOf('mp4') >= 0 ? 'mp4' : 'webm';
      const name = (current ? current.name : 'keyplay').replace(/[^\w-]+/g, '_') + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.' + ext;
      recorder = null;
      saveBlob(blob, name);
    };
    recorder.start(1000);
    recStart = Date.now();
    $('recBtn').classList.add('recording');
    recTimer = setInterval(() => { const s = Math.floor((Date.now() - recStart) / 1000); $('recTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 500);
    toast('Recording… tap the red button again to save.');
  });
  function saveBlob(blob, name) {
    if (Bridge && Bridge.saveFile) {
      const r = new FileReader();
      r.onload = () => { Bridge.saveFile(name, String(r.result).split(',')[1], blob.type); toast('Video saved to Movies/KeyPlay'); };
      r.readAsDataURL(blob);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('Video saved: ' + name, 4000);
  }

  // ---------------- lifecycle ----------------
  document.addEventListener('visibilitychange', () => {
    if (!emu) return;
    if (document.hidden) { if (!recorder) pauseEmu(); } else if (!userPaused && $('modal').hidden) resumeEmu();
  });
  window.addEventListener('pointerdown', () => KP.audio.unlock(), { capture: true });

  // file input + drag & drop
  $('jarInput').addEventListener('change', (e) => { handleFiles(Array.from(e.target.files || [])); e.target.value = ''; });
  const lib = $('library');
  ['dragenter', 'dragover'].forEach((ev) => lib.addEventListener(ev, (e) => { e.preventDefault(); lib.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => lib.addEventListener(ev, (e) => { e.preventDefault(); lib.classList.remove('drag'); }));
  lib.addEventListener('drop', (e) => handleFiles(Array.from(e.dataTransfer.files || [])));

  // Android app: JAR opened from another app ("Open with KeyPlay")
  window.KeyPlayApp = {
    async openJarBase64(name, b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const rec = await addJarBytes(name, bytes);
      await renderLibrary();
      if (rec) startGame(rec);
    },
    back() {
      if (!$('modal').hidden && sheetOpen) { sheetOpen(); return true; }
      if (emu) { showEmuMenu(); return true; }
      return false;
    },
  };

  (async function init() {
    if (typeof BigInt === 'undefined' || typeof BigInt64Array === 'undefined') {
      toastLib('This browser is too old for KeyPlay. Update Chrome or "Android System WebView" from the Play Store.');
      return;
    }
    await DB.open();
    await renderLibrary();
    // ?jar=<url> loads a game directly (used by website demo links and automated tests)
    const q = new URLSearchParams(location.search);
    const url = q.get('jar');
    if (url) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const rec = await addJarBytes(url.split('/').pop(), bytes);
        await renderLibrary();
        if (rec) startGame(rec);
      } catch (e) { toastLib('Could not load ' + url); }
    }
    const auto = q.get('keys');
    if (auto) {
      for (const part of auto.split(',')) {
        const [at, code, hold] = part.split(':').map(Number);
        setTimeout(() => { press(code); setTimeout(() => release(code), hold || 150); }, at);
      }
    }
  })();
})();
