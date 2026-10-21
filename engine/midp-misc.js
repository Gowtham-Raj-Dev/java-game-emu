/* JavaPlay engine – MIDlet, RMS, MMAPI (javax.microedition.media), Nokia UI API, I/O and vendor stubs. */
(function (KP) {
  'use strict';
  const def = KP.native;
  const S_ = (f) => Object.assign(f, { isStatic: true });
  const thr = (t, n, m) => t.vm.throwNew(n, m);
  const P = 'javax/microedition/lcdui/';

  // ---------- MIDlet ----------
  def('javax/microedition/midlet/MIDlet', {
    methods: {
      '<init>()V': (t, [o]) => { t.vm.midlet = o; },
      'getAppProperty(Ljava/lang/String;)Ljava/lang/String;': (t, [o, k]) => { const v = t.vm.props[k]; return v === undefined ? null : v; },
      'notifyDestroyed()V': (t) => { if (t.vm.host.exit) t.vm.host.exit(); },
      'notifyPaused()V': () => {},
      'resumeRequest()V': () => {},
      'platformRequest(Ljava/lang/String;)Z': (t, [o, url]) => { if (t.vm.host.openUrl && url) t.vm.host.openUrl(url); return 0; },
      'checkPermission(Ljava/lang/String;)I': () => 1,
      'startApp()V': () => {}, 'pauseApp()V': () => {}, 'destroyApp(Z)V': () => {},
    },
  });
  def('javax/microedition/midlet/MIDletStateChangeException', { super: 'java/lang/Exception', methods: {} });

  // ---------- RMS ----------
  const R = 'javax/microedition/rms/';
  def(R + 'RecordStoreException', { super: 'java/lang/Exception', methods: {} });
  for (const n of ['RecordStoreNotFoundException', 'RecordStoreFullException', 'RecordStoreNotOpenException', 'InvalidRecordIDException']) def(R + n, { super: R + 'RecordStoreException', methods: {} });
  def(R + 'RecordFilter', { isInterface: true, methods: {} });
  def(R + 'RecordComparator', { isInterface: true, statics: { EQUIVALENT: ['I', 0], FOLLOWS: ['I', 1], PRECEDES: ['I', -1] }, methods: {} });
  def(R + 'RecordListener', { isInterface: true, methods: {} });

  const b64e = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i] & 255); return btoa(s); };
  const b64d = (s) => { const b = atob(s); const a = new Int8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };

  function storeData(vm, name) {
    vm.rms = vm.rms || new Map();
    if (vm.rms.has(name)) return vm.rms.get(name);
    const raw = vm.host.storage ? vm.host.storage.load('rms:' + name) : null;
    if (!raw) return null;
    const d = { name, nextId: raw.nextId, version: raw.version || 0, modified: raw.modified || Date.now(), records: new Map() };
    for (const k in raw.records) d.records.set(+k, b64d(raw.records[k]));
    vm.rms.set(name, d);
    return d;
  }
  function persist(vm, d) {
    d.version++; d.modified = Date.now();
    if (!vm.host.storage) return;
    const recs = {};
    for (const [k, v] of d.records) recs[k] = b64e(v);
    vm.host.storage.save('rms:' + d.name, { nextId: d.nextId, version: d.version, modified: d.modified, records: recs });
  }
  function openRS(t, name, create) {
    const vm = t.vm;
    if (name === null || !name.length || name.length > 32) thr(t, 'java/lang/IllegalArgumentException', 'bad record store name');
    let d = storeData(vm, name);
    if (!d) {
      if (!create) thr(t, R + 'RecordStoreNotFoundException', name);
      d = { name, nextId: 1, version: 0, modified: Date.now(), records: new Map() };
      vm.rms.set(name, d);
      persist(vm, d);
    }
    vm.rsObjs = vm.rsObjs || new Map();
    let o = vm.rsObjs.get(name);
    if (!o) { o = vm.newObject(R + 'RecordStore'); o._d = d; o._open = 0; o._listeners = []; vm.rsObjs.set(name, o); }
    o._d = d;
    o._open++;
    return o;
  }
  function chk(t, o) { if (!o._open) thr(t, R + 'RecordStoreNotOpenException'); return o._d; }
  function recOf(t, d, id) { const r = d.records.get(id); if (!r) thr(t, R + 'InvalidRecordIDException', String(id)); return r; }
  function notifyListeners(t, o, kind, id) {
    for (const l of o._listeners) {
      const m = t.vm.findVirtual(l, kind + '(Ljavax/microedition/rms/RecordStore;I)V');
      if (m) KP.postEvent(t.vm, { type: 'invoke', m, args: [l, o, id] });
    }
  }

  def(R + 'RecordStore', {
    statics: { AUTHMODE_PRIVATE: ['I', 0], AUTHMODE_ANY: ['I', 1] },
    methods: {
      'openRecordStore(Ljava/lang/String;Z)Ljavax/microedition/rms/RecordStore;': S_((t, [n, c]) => openRS(t, n, c)),
      'openRecordStore(Ljava/lang/String;ZIZ)Ljavax/microedition/rms/RecordStore;': S_((t, [n, c]) => openRS(t, n, c)),
      'openRecordStore(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljavax/microedition/rms/RecordStore;': S_((t, [n]) => openRS(t, n, false)),
      'deleteRecordStore(Ljava/lang/String;)V': S_((t, [n]) => {
        const vm = t.vm;
        const d = storeData(vm, n);
        if (!d) thr(t, R + 'RecordStoreNotFoundException', n);
        const o = vm.rsObjs && vm.rsObjs.get(n);
        if (o && o._open > 0) thr(t, R + 'RecordStoreException', 'Record store is open');
        vm.rms.delete(n);
        if (vm.rsObjs) vm.rsObjs.delete(n);
        if (vm.host.storage) vm.host.storage.remove('rms:' + n);
      }),
      'listRecordStores()[Ljava/lang/String;': S_((t) => {
        const names = t.vm.host.storage ? t.vm.host.storage.list('rms:').map((k) => k.substring(4)) : [];
        if (!names.length) return null;
        names.$t = '[Ljava/lang/String;';
        return names;
      }),
      'closeRecordStore()V': (t, [o]) => { if (!o._open) thr(t, R + 'RecordStoreNotOpenException'); o._open--; },
      'getName()Ljava/lang/String;': (t, [o]) => chk(t, o).name,
      'getVersion()I': (t, [o]) => chk(t, o).version,
      'getLastModified()J': (t, [o]) => BigInt(chk(t, o).modified),
      'getNumRecords()I': (t, [o]) => chk(t, o).records.size,
      'getSize()I': (t, [o]) => { let n = 0; for (const r of chk(t, o).records.values()) n += r.length + 8; return n; },
      'getSizeAvailable()I': () => 1024 * 1024,
      'getNextRecordID()I': (t, [o]) => chk(t, o).nextId,
      'addRecord([BII)I': (t, [o, b, off, len]) => {
        const d = chk(t, o);
        const id = d.nextId++;
        const r = new Int8Array(len);
        if (b !== null && len > 0) r.set(b.subarray(off, off + len));
        d.records.set(id, r);
        persist(t.vm, d);
        notifyListeners(t, o, 'recordAdded', id);
        return id;
      },
      'getRecord(I)[B': (t, [o, id]) => {
        const r = recOf(t, chk(t, o), id);
        if (!r.length) return null;
        const a = r.slice(); a.$t = '[B'; return a;
      },
      'getRecord(I[BI)I': (t, [o, id, buf, off]) => {
        const r = recOf(t, chk(t, o), id);
        if (off + r.length > buf.length) thr(t, 'java/lang/ArrayIndexOutOfBoundsException');
        buf.set(r, off);
        return r.length;
      },
      'getRecordSize(I)I': (t, [o, id]) => recOf(t, chk(t, o), id).length,
      'setRecord(I[BII)V': (t, [o, id, b, off, len]) => {
        const d = chk(t, o);
        recOf(t, d, id);
        const r = new Int8Array(len);
        if (b !== null && len > 0) r.set(b.subarray(off, off + len));
        d.records.set(id, r);
        persist(t.vm, d);
        notifyListeners(t, o, 'recordChanged', id);
      },
      'deleteRecord(I)V': (t, [o, id]) => {
        const d = chk(t, o);
        recOf(t, d, id);
        d.records.delete(id);
        persist(t.vm, d);
        notifyListeners(t, o, 'recordDeleted', id);
      },
      'addRecordListener(Ljavax/microedition/rms/RecordListener;)V': (t, [o, l]) => { if (l && o._listeners.indexOf(l) < 0) o._listeners.push(l); },
      'removeRecordListener(Ljavax/microedition/rms/RecordListener;)V': (t, [o, l]) => { o._listeners = o._listeners.filter((x) => x !== l); },
      'setMode(IZ)V': () => {},
      'enumerateRecords(Ljavax/microedition/rms/RecordFilter;Ljavax/microedition/rms/RecordComparator;Z)Ljavax/microedition/rms/RecordEnumeration;': (t, [o, filter, comp, keep]) => {
        chk(t, o);
        const e = t.vm.newObject('kp/RecordEnum');
        e._rs = o; e._filter = filter; e._comp = comp; e._keep = !!keep;
        buildEnum(t, e);
        return e;
      },
    },
  });
  def(R + 'RecordEnumeration', { isInterface: true, methods: {} });
  function buildEnum(t, e) {
    const vm = t.vm;
    const d = e._rs._d;
    let ids = Array.from(d.records.keys());
    if (e._filter) {
      const m = vm.findVirtual(e._filter, 'matches([B)Z');
      ids = ids.filter((id) => { const r = d.records.get(id).slice(); r.$t = '[B'; return !!vm.invokeSync(m, [e._filter, r]); });
    }
    if (e._comp) {
      const m = vm.findVirtual(e._comp, 'compare([B[B)I');
      ids.sort((a, b) => { const ra = d.records.get(a).slice(), rb = d.records.get(b).slice(); ra.$t = rb.$t = '[B'; return vm.invokeSync(m, [e._comp, ra, rb]); });
    } else ids.sort((a, b) => b - a); // like most phones: newest first
    e._ids = ids; e._i = 0;
  }
  def('kp/RecordEnum', {
    interfaces: [R + 'RecordEnumeration'],
    methods: {
      'numRecords()I': (t, [e]) => { if (e._keep) buildEnum(t, e); return e._ids.length; },
      'hasNextElement()Z': (t, [e]) => e._i < e._ids.length,
      'hasPreviousElement()Z': (t, [e]) => e._i > 0,
      'nextRecordId()I': (t, [e]) => { if (e._i >= e._ids.length) thr(t, R + 'InvalidRecordIDException'); return e._ids[e._i++]; },
      'previousRecordId()I': (t, [e]) => { if (e._i <= 0) thr(t, R + 'InvalidRecordIDException'); return e._ids[--e._i]; },
      'nextRecord()[B': (t, [e]) => { if (e._i >= e._ids.length) thr(t, R + 'InvalidRecordIDException'); const r = e._rs._d.records.get(e._ids[e._i++]); const a = r.slice(); a.$t = '[B'; return a; },
      'previousRecord()[B': (t, [e]) => { if (e._i <= 0) thr(t, R + 'InvalidRecordIDException'); const r = e._rs._d.records.get(e._ids[--e._i]); const a = r.slice(); a.$t = '[B'; return a; },
      'reset()V': (t, [e]) => { e._i = 0; },
      'rebuild()V': (t, [e]) => buildEnum(t, e),
      'keepUpdated(Z)V': (t, [e, k]) => { e._keep = !!k; },
      'isKeptUpdated()Z': (t, [e]) => e._keep,
      'destroy()V': () => {},
    },
  });

  // ---------- MMAPI ----------
  const M = 'javax/microedition/media/';
  def(M + 'MediaException', { super: 'java/lang/Exception', methods: {} });
  def(M + 'Controllable', { isInterface: true, methods: {} });
  def(M + 'Control', { isInterface: true, methods: {} });
  def(M + 'PlayerListener', {
    isInterface: true,
    statics: { STARTED: ['Ljava/lang/String;', 'started'], STOPPED: ['Ljava/lang/String;', 'stopped'], END_OF_MEDIA: ['Ljava/lang/String;', 'endOfMedia'], CLOSED: ['Ljava/lang/String;', 'closed'], ERROR: ['Ljava/lang/String;', 'error'], DURATION_UPDATED: ['Ljava/lang/String;', 'durationUpdated'], VOLUME_CHANGED: ['Ljava/lang/String;', 'volumeChanged'], DEVICE_AVAILABLE: ['Ljava/lang/String;', 'deviceAvailable'], DEVICE_UNAVAILABLE: ['Ljava/lang/String;', 'deviceUnavailable'], STOPPED_AT_TIME: ['Ljava/lang/String;', 'stoppedAtTime'], BUFFERING_STARTED: ['Ljava/lang/String;', 'bufferingStarted'], BUFFERING_STOPPED: ['Ljava/lang/String;', 'bufferingStopped'], RECORD_STARTED: ['Ljava/lang/String;', 'recordStarted'], RECORD_STOPPED: ['Ljava/lang/String;', 'recordStopped'], RECORD_ERROR: ['Ljava/lang/String;', 'recordError'] },
    methods: {},
  });
  def(M + 'Player', { isInterface: true, interfaces: [M + 'Controllable'], statics: { UNREALIZED: ['I', 100], REALIZED: ['I', 200], PREFETCHED: ['I', 300], STARTED: ['I', 400], CLOSED: ['I', 0], TIME_UNKNOWN: ['J', -1n] }, methods: {} });
  def(M + 'control/VolumeControl', { isInterface: true, interfaces: [M + 'Control'], methods: {} });
  def(M + 'control/ToneControl', { isInterface: true, interfaces: [M + 'Control'], statics: { VERSION: ['B', -2], TEMPO: ['B', -3], RESOLUTION: ['B', -4], BLOCK_START: ['B', -5], BLOCK_END: ['B', -6], PLAY_BLOCK: ['B', -7], SET_VOLUME: ['B', -8], REPEAT: ['B', -9], C4: ['B', 60], SILENCE: ['B', -1] }, methods: {} });

  function pevent(t, p, ev, data) {
    const vm = t.vm;
    for (const l of p._listeners) {
      const m = vm.findVirtual(l, 'playerUpdate(Ljavax/microedition/media/Player;Ljava/lang/String;Ljava/lang/Object;)V');
      if (m) KP.postEvent(vm, { type: 'invoke', m, args: [l, p, ev, data] });
    }
  }
  function newPlayer(vm, bytes, type) {
    const p = vm.newObject('kp/Player');
    p._bytes = bytes; p._type = type || ''; p._state = 100; p._loops = 1; p._level = 100; p._muted = false;
    p._listeners = []; p._h = null; p._tone = null; p._vm = vm; p._time = 0;
    return p;
  }
  function vol(p) { return p._muted ? 0 : p._level / 100; }
  function stopHandle(p) { if (p._h) { const h = p._h; p._h = null; h.stop(); } }

  def(M + 'Manager', {
    statics: { TONE_DEVICE_LOCATOR: ['Ljava/lang/String;', 'device://tone'], MIDI_DEVICE_LOCATOR: ['Ljava/lang/String;', 'device://midi'] },
    methods: {
      'createPlayer(Ljava/io/InputStream;Ljava/lang/String;)Ljavax/microedition/media/Player;': S_((t, [ins, type]) => {
        if (ins === null) thr(t, 'java/lang/IllegalArgumentException');
        const chunks = []; let total = 0;
        const buf = KP.newByteArray(16384);
        for (;;) { const n = KP.readInto(t, ins, buf, 0, buf.length); if (n <= 0) break; chunks.push(buf.slice(0, n)); total += n; }
        const all = new Int8Array(total); let q = 0;
        for (const c of chunks) { all.set(c, q); q += c.length; }
        return newPlayer(t.vm, all, type);
      }),
      'createPlayer(Ljava/lang/String;)Ljavax/microedition/media/Player;': S_((t, [loc]) => {
        if (loc === null) thr(t, 'java/lang/IllegalArgumentException');
        if (loc.startsWith('device://tone')) { const p = newPlayer(t.vm, null, 'tone'); p._toneDevice = true; return p; }
        if (loc.startsWith('device://midi')) return newPlayer(t.vm, null, 'audio/midi');
        const path = loc.replace(/^(resource|file):\/*/, '');
        const bytes = t.vm.jar.get(path);
        if (!bytes) thr(t, M + 'MediaException', 'Cannot create player for ' + loc);
        const b = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
        return newPlayer(t.vm, b, /\.mid/i.test(loc) ? 'audio/midi' : '');
      }),
      'createPlayer(Ljavax/microedition/media/protocol/DataSource;)Ljavax/microedition/media/Player;': S_((t) => thr(t, M + 'MediaException', 'DataSource not supported')),
      'playTone(III)V': S_((t, [note, dur, v]) => { if (!t.vm.host.muted) KP.audio.tone(note, dur, v); }),
      'getSupportedContentTypes(Ljava/lang/String;)[Ljava/lang/String;': S_(() => { const a = ['audio/midi', 'audio/x-tone-seq', 'audio/x-wav', 'audio/mpeg']; a.$t = '[Ljava/lang/String;'; return a; }),
      'getSupportedProtocols(Ljava/lang/String;)[Ljava/lang/String;': S_(() => { const a = ['device', 'resource']; a.$t = '[Ljava/lang/String;'; return a; }),
      'getSystemTimeBase()Ljavax/microedition/media/TimeBase;': S_(() => null),
    },
  });

  def('kp/Player', {
    interfaces: [M + 'Player'],
    methods: {
      'realize()V': (t, [p]) => { if (p._state === 0) thr(t, 'java/lang/IllegalStateException'); if (p._state < 200) p._state = 200; },
      'prefetch()V': (t, [p]) => { if (p._state === 0) thr(t, 'java/lang/IllegalStateException'); if (p._state < 300) p._state = 300; },
      'start()V': (t, [p]) => {
        if (p._state === 0) thr(t, 'java/lang/IllegalStateException');
        if (p._state === 400) return;
        p._state = 400;
        stopHandle(p);
        const data = p._toneDevice ? p._tone : p._bytes;
        const onEnd = () => {
          if (p._state !== 400) return;
          p._state = 300; p._h = null; p._time = 0;
          pevent(t, p, 'endOfMedia', null);
        };
        if (!data || t.vm.host.muted) {
          // nothing audible: still behave like a short clip
          setTimeout(onEnd, 50);
        } else if (p._toneDevice) p._h = KP.audio.playToneSeq(data, p._loops, vol(p), onEnd);
        else p._h = KP.audio.play(data, p._type, p._loops, vol(p), onEnd);
        pevent(t, p, 'started', null);
      },
      'stop()V': (t, [p]) => {
        if (p._state === 0) thr(t, 'java/lang/IllegalStateException');
        if (p._state !== 400) return;
        if (p._h && p._h.position) p._time = p._h.position();
        stopHandle(p); p._state = 300;
        pevent(t, p, 'stopped', null);
      },
      'deallocate()V': (t, [p]) => { stopHandle(p); if (p._state > 200) p._state = 200; },
      'close()V': (t, [p]) => { if (p._state === 0) return; stopHandle(p); p._state = 0; pevent(t, p, 'closed', null); },
      'getState()I': (t, [p]) => p._state,
      'setLoopCount(I)V': (t, [p, n]) => { if (n === 0) thr(t, 'java/lang/IllegalArgumentException'); p._loops = n; },
      'getDuration()J': (t, [p]) => { const d = p._bytes ? KP.audio.duration(p._bytes, p._type) : -1; return d < 0 ? -1n : BigInt(Math.round(d * 1e6)); },
      'getMediaTime()J': (t, [p]) => BigInt(Math.round((p._h && p._h.position ? p._h.position() : p._time) * 1e6)),
      'setMediaTime(J)J': (t, [p, v]) => { p._time = Number(v) / 1e6; return v; },
      'getContentType()Ljava/lang/String;': (t, [p]) => p._type || 'audio/midi',
      'addPlayerListener(Ljavax/microedition/media/PlayerListener;)V': (t, [p, l]) => { if (l && p._listeners.indexOf(l) < 0) p._listeners.push(l); },
      'removePlayerListener(Ljavax/microedition/media/PlayerListener;)V': (t, [p, l]) => { p._listeners = p._listeners.filter((x) => x !== l); },
      'getControl(Ljava/lang/String;)Ljavax/microedition/media/Control;': (t, [p, name]) => {
        if (/VolumeControl$/.test(name)) { const c = t.vm.newObject('kp/VolumeControl'); c._p = p; return c; }
        if (/ToneControl$/.test(name)) { const c = t.vm.newObject('kp/ToneControl'); c._p = p; return c; }
        return null;
      },
      'getControls()[Ljavax/microedition/media/Control;': (t, [p]) => { const c = t.vm.newObject('kp/VolumeControl'); c._p = p; const a = [c]; a.$t = '[Ljavax/microedition/media/Control;'; return a; },
      'setTimeBase(Ljavax/microedition/media/TimeBase;)V': () => {},
      'getTimeBase()Ljavax/microedition/media/TimeBase;': () => null,
    },
  });
  def('kp/VolumeControl', {
    interfaces: [M + 'control/VolumeControl'],
    methods: {
      'setLevel(I)I': (t, [c, l]) => { const p = c._p; p._level = Math.max(0, Math.min(100, l)); if (p._h) p._h.setVolume(vol(p)); return p._level; },
      'getLevel()I': (t, [c]) => c._p._level,
      'setMute(Z)V': (t, [c, m]) => { const p = c._p; p._muted = !!m; if (p._h) p._h.setVolume(vol(p)); },
      'isMuted()Z': (t, [c]) => c._p._muted,
    },
  });
  def('kp/ToneControl', {
    interfaces: [M + 'control/ToneControl'],
    methods: { 'setSequence([B)V': (t, [c, seq]) => { c._p._tone = seq; } },
  });

  // ---------- Nokia UI API ----------
  const N = 'com/nokia/mid/';
  def(N + 'ui/FullCanvas', {
    super: P + 'Canvas',
    statics: { KEY_SOFTKEY1: ['I', -6], KEY_SOFTKEY2: ['I', -7], KEY_SOFTKEY3: ['I', -5], KEY_SEND: ['I', -10], KEY_END: ['I', -11], KEY_UP_ARROW: ['I', -1], KEY_DOWN_ARROW: ['I', -2], KEY_LEFT_ARROW: ['I', -3], KEY_RIGHT_ARROW: ['I', -4] },
    methods: {
      '<init>()V': (t, [o]) => { o._cmds = []; o._listener = null; o._full = true; o._held = 0; o._latched = 0; if (t.vm.host.onFullScreen) t.vm.host.onFullScreen(o, true); },
      'addCommand(Ljavax/microedition/lcdui/Command;)V': (t) => thr(t, 'java/lang/IllegalStateException'),
      'setCommandListener(Ljavax/microedition/lcdui/CommandListener;)V': (t) => thr(t, 'java/lang/IllegalStateException'),
    },
  });

  def(N + 'ui/DeviceControl', {
    methods: {
      'setLights(II)V': S_(() => {}),
      'flashLights(J)V': S_(() => {}),
      'startVibra(IJ)V': S_((t, [f, d]) => { if (t.vm.host.vibrate) t.vm.host.vibrate(Number(d)); }),
      'stopVibra()V': S_((t) => { if (t.vm.host.vibrate) t.vm.host.vibrate(0); }),
    },
  });

  // DirectGraphics: Nokia rotation is counter-clockwise; flips applied before rotation
  function nokiaToMidp(manip) {
    const fh = !!(manip & 0x2000), fv = !!(manip & 0x4000);
    let rot = ((manip & 0x0fff) % 360 + 360) % 360; // degrees CCW
    // express as: optional mirror (horizontal) then clockwise rotation
    // vertical flip == horizontal mirror + 180 rotation
    let mirror = fh;
    let cw = (360 - rot) % 360;
    if (fv) { mirror = !mirror; cw = (cw + 180) % 360; }
    const table = mirror ? { 0: 2, 90: 7, 180: 1, 270: 4 } : { 0: 0, 90: 5, 180: 3, 270: 6 };
    return table[cw] !== undefined ? table[cw] : 0;
  }
  function argbCss(c) { return 'rgba(' + ((c >> 16) & 255) + ',' + ((c >> 8) & 255) + ',' + (c & 255) + ',' + (((c >>> 24) & 255) / 255) + ')'; }
  function dgFill(dg, argb) { const g = dg._g; const c = KP.gPrep(g); c.fillStyle = argbCss(argb); return c; }
  function polyPath(c, g, xs, xo, ys, yo, n) {
    c.beginPath();
    for (let i = 0; i < n; i++) { const x = xs[xo + i] + g._tx, y = ys[yo + i] + g._ty; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    c.closePath();
  }
  // pixel format helpers
  function toARGB(fmt, v) {
    switch (fmt) {
      case 4444: return (((v >> 12) & 15) * 17 << 24) | (((v >> 8) & 15) * 17 << 16) | (((v >> 4) & 15) * 17 << 8) | ((v & 15) * 17);
      case 444: return 0xff000000 | (((v >> 8) & 15) * 17 << 16) | (((v >> 4) & 15) * 17 << 8) | ((v & 15) * 17);
      case 565: return 0xff000000 | ((((v >> 11) & 31) * 255 / 31) << 16) | ((((v >> 5) & 63) * 255 / 63) << 8) | ((v & 31) * 255 / 31);
      case 555: return 0xff000000 | ((((v >> 10) & 31) * 255 / 31) << 16) | ((((v >> 5) & 31) * 255 / 31) << 8) | ((v & 31) * 255 / 31);
      case 888: return 0xff000000 | v;
      default: return v;
    }
  }
  function fromARGB(fmt, v) {
    const a = (v >>> 24) & 255, r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    switch (fmt) {
      case 4444: return ((a >> 4) << 12) | ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      case 444: return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      case 565: return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
      case 555: return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      case 888: return v & 0xffffff;
      default: return v;
    }
  }
  function drawPixelsARGB(dg, argbArr, alpha, x, y, w, h) {
    KP.gDrawRGB(dg._g, argbArr, 0, w, x, y, w, h, alpha);
  }
  def(N + 'ui/DirectGraphics', {
    isInterface: true,
    statics: {
      FLIP_HORIZONTAL: ['I', 0x2000], FLIP_VERTICAL: ['I', 0x4000], ROTATE_90: ['I', 90], ROTATE_180: ['I', 180], ROTATE_270: ['I', 270],
      TYPE_BYTE_1_GRAY: ['I', 1], TYPE_BYTE_1_GRAY_VERTICAL: ['I', -1], TYPE_BYTE_2_GRAY: ['I', 2], TYPE_BYTE_4_GRAY: ['I', 4], TYPE_BYTE_8_GRAY: ['I', 8],
      TYPE_BYTE_332_RGB: ['I', 332], TYPE_USHORT_4444_ARGB: ['I', 4444], TYPE_USHORT_444_RGB: ['I', 444], TYPE_USHORT_555_RGB: ['I', 555],
      TYPE_USHORT_1555_ARGB: ['I', 1555], TYPE_USHORT_565_RGB: ['I', 565], TYPE_INT_888_RGB: ['I', 888], TYPE_INT_8888_ARGB: ['I', 8888],
    },
    methods: {},
  });
  def('kp/DirectGraphicsImpl', {
    interfaces: [N + 'ui/DirectGraphics'],
    methods: {
      'setARGBColor(I)V': (t, [dg, c]) => { const g = dg._g; g._color = c & 0xffffff; g._css = argbCss(c); dg._alpha = (c >>> 24) & 255; },
      'getAlphaComponent()I': (t, [dg]) => (dg._alpha === undefined ? 255 : dg._alpha),
      'getNativePixelFormat()I': () => 4444,
      'drawImage(Ljavax/microedition/lcdui/Image;IIII)V': (t, [dg, im, x, y, anchor, manip]) => {
        if (im === null) thr(t, 'java/lang/NullPointerException');
        const g = dg._g;
        const tr = nokiaToMidp(manip);
        const swap = tr === 5 || tr === 6 || tr === 7 || tr === 4;
        const w = swap ? im._h : im._w, h = swap ? im._w : im._h;
        const [ax, ay] = KP.gAnchor(anchor || 20, x + g._tx, y + g._ty, w, h, h);
        KP.drawRegionRaw(KP.gPrep(g), im._c, 0, 0, im._w, im._h, tr, ax, ay);
      },
      'drawTriangle(IIIIIII)V': (t, [dg, x1, y1, x2, y2, x3, y3, argb]) => {
        const g = dg._g; const c = KP.gPrep(g); c.strokeStyle = argbCss(argb); c.lineWidth = 1;
        c.beginPath(); c.moveTo(x1 + g._tx + 0.5, y1 + g._ty + 0.5); c.lineTo(x2 + g._tx + 0.5, y2 + g._ty + 0.5); c.lineTo(x3 + g._tx + 0.5, y3 + g._ty + 0.5); c.closePath(); c.stroke();
      },
      'fillTriangle(IIIIIII)V': (t, [dg, x1, y1, x2, y2, x3, y3, argb]) => {
        const g = dg._g; const c = dgFill(dg, argb);
        c.beginPath(); c.moveTo(x1 + g._tx, y1 + g._ty); c.lineTo(x2 + g._tx, y2 + g._ty); c.lineTo(x3 + g._tx, y3 + g._ty); c.closePath(); c.fill();
      },
      'drawPolygon([II[IIII)V': (t, [dg, xs, xo, ys, yo, n, argb]) => { const g = dg._g; const c = KP.gPrep(g); c.strokeStyle = argbCss(argb); polyPath(c, g, xs, xo, ys, yo, n); c.stroke(); },
      'fillPolygon([II[IIII)V': (t, [dg, xs, xo, ys, yo, n, argb]) => { const g = dg._g; const c = dgFill(dg, argb); polyPath(c, g, xs, xo, ys, yo, n); c.fill(); },
      'drawPixels([IZIIIIIIII)V': (t, [dg, px, trans, off, scan, x, y, w, h, manip, fmt]) => {
        const out = new Int32Array(w * h);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out[j * w + i] = toARGB(fmt, px[off + j * scan + i]);
        drawPixelsARGB(dg, out, trans || fmt === 8888, x, y, w, h);
      },
      'drawPixels([SZIIIIIIII)V': (t, [dg, px, trans, off, scan, x, y, w, h, manip, fmt]) => {
        const out = new Int32Array(w * h);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out[j * w + i] = toARGB(fmt, px[off + j * scan + i] & 0xffff);
        drawPixelsARGB(dg, out, trans || fmt === 4444, x, y, w, h);
      },
      'drawPixels([B[BIIIIIIII)V': (t, [dg, px, mask, off, scan, x, y, w, h, manip, fmt]) => {
        const out = new Int32Array(w * h);
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const bitIdx = off * 8 + j * scan + i;
            const on = (px[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
            const vis = mask ? (mask[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1 : 1;
            out[j * w + i] = vis ? (on ? 0xff000000 : 0xffffffff) : 0;
          }
        }
        drawPixelsARGB(dg, out, true, x, y, w, h);
      },
      'getPixels([IIIIIIII)V': (t, [dg, px, off, scan, x, y, w, h, fmt]) => {
        const g = dg._g;
        const d = KP.ctxOf(g._canvas).getImageData(x + g._tx, y + g._ty, w, h).data;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const q = (j * w + i) * 4; px[off + j * scan + i] = fromARGB(fmt, (d[q + 3] << 24) | (d[q] << 16) | (d[q + 1] << 8) | d[q + 2]); }
      },
      'getPixels([SIIIIIII)V': (t, [dg, px, off, scan, x, y, w, h, fmt]) => {
        const g = dg._g;
        const d = KP.ctxOf(g._canvas).getImageData(x + g._tx, y + g._ty, w, h).data;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const q = (j * w + i) * 4; px[off + j * scan + i] = (fromARGB(fmt, (d[q + 3] << 24) | (d[q] << 16) | (d[q + 1] << 8) | d[q + 2]) << 16) >> 16; }
      },
    },
  });
  def(N + 'ui/DirectUtils', {
    methods: {
      'getDirectGraphics(Ljavax/microedition/lcdui/Graphics;)Lcom/nokia/mid/ui/DirectGraphics;': S_((t, [g]) => { if (!g._dg) { g._dg = t.vm.newObject('kp/DirectGraphicsImpl'); g._dg._g = g; } return g._dg; }),
      'createImage(III)Ljavax/microedition/lcdui/Image;': S_((t, [w, h, argb]) => {
        const im = KP.newImage(t.vm, w, h, true);
        const c = KP.ctxOf(im._c); c.clearRect(0, 0, w, h);
        if ((argb >>> 24) !== 0) { c.fillStyle = argbCss(argb); c.fillRect(0, 0, w, h); }
        return im;
      }),
      'createImage([BII)Ljavax/microedition/lcdui/Image;': S_((t, [b, off, len]) => {
        const src = KP.decodeImageBytes(t, b, off, len);
        const im = KP.newImage(t.vm, src._w, src._h, true);
        const c = KP.ctxOf(im._c); c.clearRect(0, 0, src._w, src._h); c.drawImage(src._c, 0, 0);
        return im;
      }),
    },
  });

  // Nokia Sound
  const SND = { SOUND_PLAYING: 0, SOUND_STOPPED: 1, SOUND_UNINITIALIZED: 3, FORMAT_TONE: 1, FORMAT_WAV: 5 };
  function soundEvent(t, s, ev) {
    if (!s._listener) return;
    const m = t.vm.findVirtual(s._listener, 'soundStateChanged(Lcom/nokia/mid/sound/Sound;I)V');
    if (m) KP.postEvent(t.vm, { type: 'invoke', m, args: [s._listener, s, ev] });
  }
  def(N + 'sound/SoundListener', { isInterface: true, methods: {} });
  def(N + 'sound/Sound', {
    statics: { SOUND_PLAYING: ['I', 0], SOUND_STOPPED: ['I', 1], SOUND_UNINITIALIZED: ['I', 3], FORMAT_TONE: ['I', 1], FORMAT_WAV: ['I', 5] },
    methods: {
      '<init>(IJ)V': (t, [s, f, d]) => { s._freq = f; s._dur = Number(d); s._data = null; s._state = 1; s._gain = 255; },
      '<init>([BI)V': (t, [s, data, type]) => { s._data = data; s._type = type; s._state = 1; s._gain = 255; },
      'init(IJ)V': (t, [s, f, d]) => { s._freq = f; s._dur = Number(d); s._data = null; s._state = 1; },
      'init([BI)V': (t, [s, data, type]) => { s._data = data; s._type = type; s._state = 1; },
      'play(I)V': (t, [s, loops]) => {
        if (s._h) { s._h.stop(); s._h = null; }
        s._state = 0; soundEvent(t, s, 0);
        const done = () => { s._state = 1; s._h = null; soundEvent(t, s, 1); };
        if (t.vm.host.muted) { setTimeout(done, 30); return; }
        const n = loops === 0 ? -1 : loops;
        if (!s._data) s._h = KP.audio.freqTone(s._freq, s._dur, s._gain / 255);
        else if (s._type === 1) s._h = KP.audio.playOtt(s._data, n, s._gain / 255, done);
        else s._h = KP.audio.play(s._data, 'audio/x-wav', n, s._gain / 255, done);
        if (!s._data) setTimeout(done, s._dur);
      },
      'stop()V': (t, [s]) => { if (s._h) { s._h.stop(); s._h = null; } if (s._state === 0) { s._state = 1; soundEvent(t, s, 1); } },
      'resume()V': () => {},
      'release()V': (t, [s]) => { if (s._h) s._h.stop(); s._h = null; s._state = 3; },
      'getState()I': (t, [s]) => s._state,
      'setGain(I)V': (t, [s, g]) => { s._gain = Math.max(0, Math.min(255, g)); if (s._h) s._h.setVolume(s._gain / 255); },
      'getGain()I': (t, [s]) => s._gain,
      'setSoundListener(Lcom/nokia/mid/sound/SoundListener;)V': (t, [s, l]) => { s._listener = l; },
      'getConcurrentSoundCount(I)I': S_(() => 1),
      'getSupportedFormats()[I': S_(() => { const a = new Int32Array([1, 5]); a.$t = '[I'; return a; }),
    },
  });

  // ---------- javax.microedition.io (no networking for offline games) ----------
  def('javax/microedition/io/ConnectionNotFoundException', { super: 'java/io/IOException', methods: {} });
  def('javax/microedition/io/Connector', {
    statics: { READ: ['I', 1], WRITE: ['I', 2], READ_WRITE: ['I', 3] },
    methods: {
      'open(Ljava/lang/String;)Ljavax/microedition/io/Connection;': S_((t, [u]) => thr(t, 'javax/microedition/io/ConnectionNotFoundException', u)),
      'open(Ljava/lang/String;I)Ljavax/microedition/io/Connection;': S_((t, [u]) => thr(t, 'javax/microedition/io/ConnectionNotFoundException', u)),
      'open(Ljava/lang/String;IZ)Ljavax/microedition/io/Connection;': S_((t, [u]) => thr(t, 'javax/microedition/io/ConnectionNotFoundException', u)),
      'openInputStream(Ljava/lang/String;)Ljava/io/InputStream;': S_((t, [u]) => thr(t, 'javax/microedition/io/ConnectionNotFoundException', u)),
      'openDataInputStream(Ljava/lang/String;)Ljava/io/DataInputStream;': S_((t, [u]) => thr(t, 'javax/microedition/io/ConnectionNotFoundException', u)),
    },
  });

  // ---------- vendor extras ----------
  def('com/samsung/util/Vibration', { methods: { 'start(II)V': S_((t, [d]) => { if (t.vm.host.vibrate) t.vm.host.vibrate(d * 1000); }), 'stop()V': S_(() => {}), 'isSupported()Z': S_(() => 1) } });
  def('com/samsung/util/LCDLight', { methods: { 'on(I)V': S_(() => {}), 'off()V': S_(() => {}), 'isSupported()Z': S_(() => 1) } });
  def('com/siemens/mp/game/Light', { methods: { 'setLightOn()V': S_(() => {}), 'setLightOff()V': S_(() => {}) } });
  def('com/siemens/mp/game/Vibrator', { methods: { 'startVibrator()V': S_(() => {}), 'stopVibrator()V': S_(() => {}), 'triggerVibrator(I)V': S_((t, [d]) => { if (t.vm.host.vibrate) t.vm.host.vibrate(d); }) } });
})(globalThis.KP = globalThis.KP || {});
