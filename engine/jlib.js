/* KeyPlay engine – CLDC 1.1 class library (java.lang, java.util, java.io) implemented in JS. */
(function (KP) {
  'use strict';
  const def = KP.native;
  const JThrow = KP.JThrow;

  // ---------- helpers ----------
  const thr = (t, name, msg) => t.vm.throwNew(name, msg);
  const isObj = (v) => v !== null && typeof v === 'object';

  function cname(vm, v) { return vm.classOf(v).name.replace(/\//g, '.'); }

  // obtain java.lang.String for any value, calling overridden toString() when needed (generator helper)
  function* toJString(t, v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return v;
    const m = t.vm.findVirtual(v, 'toString()Ljava/lang/String;');
    if (m.fn && !m.isGen) return m.fn(t, [v]);
    const r = yield { invoke: m, args: [v] };
    return r === null ? 'null' : r;
  }
  KP.toJString = toJString;

  // synchronous equals/hashCode for collections
  function jequals(t, a, b) {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a === 'string' || typeof b === 'string') return a === b;
    const m = t.vm.findVirtual(a, 'equals(Ljava/lang/Object;)Z');
    if (m.fn) return !!m.fn(t, [a, b]);
    return !!t.vm.invokeSync(m, [a, b]);
  }
  function jhash(t, a) {
    if (a === null) return 0;
    if (typeof a === 'string') return KP.stringHash(a);
    const m = t.vm.findVirtual(a, 'hashCode()I');
    if (m.fn) return m.fn(t, [a]) | 0;
    return t.vm.invokeSync(m, [a]) | 0;
  }
  KP.jequals = jequals; KP.jhash = jhash;

  function dToS(d) {
    if (d !== d) return 'NaN';
    if (d === Infinity) return 'Infinity';
    if (d === -Infinity) return '-Infinity';
    if (d === 0) return (1 / d < 0) ? '-0.0' : '0.0';
    const a = Math.abs(d);
    if (a >= 1e-3 && a < 1e7) {
      let s = String(d);
      if (s.indexOf('e') >= 0) s = d.toFixed(10).replace(/0+$/, '');
      if (s.indexOf('.') < 0) s += '.0';
      return s;
    }
    let [m, e] = d.toExponential().split('e');
    if (m.indexOf('.') < 0) m += '.0';
    return m + 'E' + parseInt(e, 10);
  }
  function fToS(f) {
    if (f !== f || !isFinite(f) || f === 0) return dToS(f);
    for (let p = 1; p <= 9; p++) {
      const v = parseFloat(f.toPrecision(p));
      if (Math.fround(v) === f) return dToS(v);
    }
    return dToS(f);
  }
  KP.dToS = dToS; KP.fToS = fToS;

  function parseIntStrict(t, s, radix) {
    if (s === null) thr(t, 'java/lang/NumberFormatException', 'null');
    if (radix < 2 || radix > 36) thr(t, 'java/lang/NumberFormatException', 'radix');
    let i = 0, neg = false;
    if (s.length === 0) thr(t, 'java/lang/NumberFormatException', s);
    if (s[0] === '-') { neg = true; i = 1; } else if (s[0] === '+') i = 1;
    if (i >= s.length) thr(t, 'java/lang/NumberFormatException', s);
    let v = 0;
    for (; i < s.length; i++) {
      const d = parseInt(s[i], radix);
      if (isNaN(d)) thr(t, 'java/lang/NumberFormatException', 'For input string: "' + s + '"');
      v = v * radix + d;
      if (v > 2147483648) thr(t, 'java/lang/NumberFormatException', 'For input string: "' + s + '"');
    }
    if (neg) v = -v;
    if (v > 2147483647 || v < -2147483648) thr(t, 'java/lang/NumberFormatException', s);
    return v | 0;
  }
  function parseLongStrict(t, s, radix) {
    if (s === null || !s.length) thr(t, 'java/lang/NumberFormatException', String(s));
    let i = 0, neg = false;
    if (s[0] === '-') { neg = true; i = 1; } else if (s[0] === '+') i = 1;
    if (i >= s.length) thr(t, 'java/lang/NumberFormatException', s);
    let v = 0n; const R = BigInt(radix);
    for (; i < s.length; i++) {
      const d = parseInt(s[i], radix);
      if (isNaN(d)) thr(t, 'java/lang/NumberFormatException', 'For input string: "' + s + '"');
      v = v * R + BigInt(d);
    }
    if (neg) v = -v;
    if (v > 9223372036854775807n || v < -9223372036854775808n) thr(t, 'java/lang/NumberFormatException', s);
    return v;
  }
  function parseFloatStrict(t, s) {
    if (s === null) thr(t, 'java/lang/NullPointerException');
    const x = s.trim().replace(/[fFdD]$/, '');
    if (!/^[+-]?(NaN|Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)$/.test(x)) thr(t, 'java/lang/NumberFormatException', s);
    return parseFloat(x.replace(/^\+/, ''));
  }

  // byte <-> string encodings
  function decodeBytes(bytes, off, len, enc) {
    enc = (enc || '').toUpperCase().replace(/[-_]/g, '');
    if (enc === 'UTF8') return KP.utf8Decode(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), off, len);
    if (enc === 'UTF16' || enc === 'UTF16BE') {
      let s = '';
      for (let i = off; i + 1 < off + len; i += 2) s += String.fromCharCode(((bytes[i] & 255) << 8) | (bytes[i + 1] & 255));
      return s;
    }
    if (enc === '' ) {
      // default platform encoding: UTF-8 if valid, else ISO-8859-1
      let valid = true, high = false;
      for (let i = off; i < off + len && valid; i++) {
        const c = bytes[i] & 255;
        if (c < 0x80) continue;
        high = true;
        let n = (c & 0xe0) === 0xc0 ? 1 : (c & 0xf0) === 0xe0 ? 2 : -1;
        if (n < 0) { valid = false; break; }
        for (let k = 1; k <= n; k++) if (((bytes[i + k] & 255) & 0xc0) !== 0x80) { valid = false; break; }
        i += n;
      }
      if (high && valid) return KP.utf8Decode(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), off, len);
    }
    let s = '';
    for (let i = off; i < off + len; i++) s += String.fromCharCode(bytes[i] & 255);
    return s;
  }
  function encodeString(s, enc) {
    enc = (enc || '').toUpperCase().replace(/[-_]/g, '');
    let arr;
    if (enc === 'UTF8') arr = KP.utf8Encode(s);
    else if (enc === 'UTF16' || enc === 'UTF16BE') { arr = []; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); arr.push(c >> 8, c & 255); } }
    else { arr = []; for (let i = 0; i < s.length; i++) arr.push(s.charCodeAt(i) & 255); }
    const b = new Int8Array(arr.length);
    for (let i = 0; i < arr.length; i++) b[i] = arr[i];
    b.$t = '[B';
    return b;
  }
  KP.decodeBytes = decodeBytes; KP.encodeString = encodeString;

  function newByteArray(n) { const a = new Int8Array(n); a.$t = '[B'; return a; }
  function newCharArray(s) { const a = new Uint16Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); a.$t = '[C'; return a; }
  KP.newByteArray = newByteArray;
  function charsToString(a, off, len) {
    let s = '';
    const end = off + len;
    for (let i = off; i < end; i += 4096) s += String.fromCharCode.apply(null, a.subarray(i, Math.min(end, i + 4096)));
    return s;
  }

  // ---------- java.lang.Object ----------
  def('java/lang/Object', {
    super: null,
    methods: {
      '<init>()V': () => {},
      'hashCode()I': (t, [o]) => t.vm.identityHash(o),
      'equals(Ljava/lang/Object;)Z': (t, [a, b]) => a === b,
      'getClass()Ljava/lang/Class;': (t, [o]) => t.vm.jclass(t.vm.classOf(o)),
      'toString()Ljava/lang/String;': function* (t, [o]) {
        const hm = t.vm.findVirtual(o, 'hashCode()I');
        const h = hm.fn ? hm.fn(t, [o]) : yield { invoke: hm, args: [o] };
        return cname(t.vm, o) + '@' + ((h | 0) >>> 0).toString(16);
      },
      'notify()V': (t, [o]) => notify(t, o, false),
      'notifyAll()V': (t, [o]) => notify(t, o, true),
      'wait()V': function* (t, [o]) { yield* waitOn(t, o, 0); },
      'wait(J)V': function* (t, [o, ms]) { yield* waitOn(t, o, Number(ms)); },
      'clone()Ljava/lang/Object;': (t, [o]) => {
        if (o && o.$t) { const c = o.slice(); c.$t = o.$t; return c; }
        const c = new (o.__cls.ctor)();
        for (const k of Object.keys(o)) if (k !== '$mon' && k !== '$h') c[k] = o[k];
        return c;
      },
    },
  });

  function* waitOn(t, o, ms) {
    const mon = KP.monitorOf(o);
    if (mon.owner !== t && !t.sync) thr(t, 'java/lang/IllegalMonitorStateException');
    const count = mon.count;
    mon.owner = null; mon.count = 0;
    const w = { notified: false };
    (mon.waiters || (mon.waiters = [])).push(w);
    const deadline = ms > 0 ? KP.now() + ms : 0;
    yield { block: () => !w.notified && !t.interrupted, wake: deadline };
    const i = mon.waiters.indexOf(w);
    if (i >= 0) mon.waiters.splice(i, 1);
    yield { block: () => !(mon.owner === null || mon.owner === t) };
    mon.owner = t; mon.count = count || 1;
    if (t.interrupted) { t.interrupted = false; thr(t, 'java/lang/InterruptedException'); }
  }
  function notify(t, o, all) {
    const mon = KP.monitorOf(o);
    if (!mon.waiters || !mon.waiters.length) return;
    if (all) { for (const w of mon.waiters) w.notified = true; mon.waiters.length = 0; }
    else mon.waiters.shift().notified = true;
    t.vm.wakeup();
  }

  // ---------- java.lang.Class ----------
  def('java/lang/Class', {
    methods: {
      'getName()Ljava/lang/String;': (t, [c]) => c._cls.name.replace(/\//g, '.'),
      'toString()Ljava/lang/String;': (t, [c]) => (c._cls.isInterface ? 'interface ' : 'class ') + c._cls.name.replace(/\//g, '.'),
      'isInterface()Z': (t, [c]) => c._cls.isInterface,
      'isArray()Z': (t, [c]) => c._cls.isArray,
      'isInstance(Ljava/lang/Object;)Z': (t, [c, o]) => t.vm.isInstance(o, c._cls),
      'isAssignableFrom(Ljava/lang/Class;)Z': (t, [c, o]) => t.vm.isAssignable(o._cls, c._cls),
      'forName(Ljava/lang/String;)Ljava/lang/Class;': Object.assign((t, [name]) => {
        if (name === null) thr(t, 'java/lang/NullPointerException');
        const c = t.vm.loadClass(name.replace(/\./g, '/'), true);
        if (!c || c.native && c.native.lenient) thr(t, 'java/lang/ClassNotFoundException', name);
        return t.vm.jclass(c);
      }, { isStatic: true }),
      'newInstance()Ljava/lang/Object;': function* (t, [c]) {
        const cls = c._cls;
        if (cls.state !== 2) {
          // run static initializer first
          const vm = t.vm;
          if (!vm.ensureInit(t, cls)) yield { yieldNow: true };
          while (cls.state === 1) yield { block: () => cls.state === 1 };
        }
        const o = new cls.ctor();
        const init = cls.methods.get('<init>()V') || cls.findMethod('<init>()V');
        if (init) yield { invoke: init, args: [o] };
        return o;
      },
      'getResourceAsStream(Ljava/lang/String;)Ljava/io/InputStream;': (t, [c, name]) => {
        if (name === null) return null;
        let path = name;
        if (path.startsWith('/')) path = path.substring(1);
        else {
          const n = c._cls.name;
          const i = n.lastIndexOf('/');
          if (i >= 0) path = n.substring(0, i + 1) + path;
        }
        const bytes = t.vm.jar.get(path) || t.vm.jar.get(name.replace(/^\/+/, ''));
        if (!bytes) return null;
        return KP.newBAIS(t.vm, bytes);
      },
    },
  });

  // ---------- java.lang.String ----------
  const S = (v) => v;
  def('java/lang/String', {
    methods: {
      '<init>()V': () => '',
      '<init>(Ljava/lang/String;)V': (t, [o, s]) => s,
      '<init>([C)V': (t, [o, a]) => charsToString(a, 0, a.length),
      '<init>([CII)V': (t, [o, a, off, len]) => {
        if (off < 0 || len < 0 || off + len > a.length) thr(t, 'java/lang/StringIndexOutOfBoundsException');
        return charsToString(a, off, len);
      },
      '<init>([B)V': (t, [o, b]) => decodeBytes(b, 0, b.length, ''),
      '<init>([BII)V': (t, [o, b, off, len]) => decodeBytes(b, off, len, ''),
      '<init>([BLjava/lang/String;)V': (t, [o, b, enc]) => decodeBytes(b, 0, b.length, enc),
      '<init>([BIILjava/lang/String;)V': (t, [o, b, off, len, enc]) => decodeBytes(b, off, len, enc),
      '<init>(Ljava/lang/StringBuffer;)V': (t, [o, sb]) => sb._s,
      'length()I': (t, [s]) => s.length,
      'charAt(I)C': (t, [s, i]) => {
        if (i < 0 || i >= s.length) thr(t, 'java/lang/StringIndexOutOfBoundsException', 'String index out of range: ' + i);
        return s.charCodeAt(i);
      },
      'substring(I)Ljava/lang/String;': (t, [s, a]) => {
        if (a < 0 || a > s.length) thr(t, 'java/lang/StringIndexOutOfBoundsException', String(a));
        return s.substring(a);
      },
      'substring(II)Ljava/lang/String;': (t, [s, a, b]) => {
        if (a < 0 || b > s.length || a > b) thr(t, 'java/lang/StringIndexOutOfBoundsException', a + ',' + b);
        return s.substring(a, b);
      },
      'indexOf(I)I': (t, [s, c]) => s.indexOf(String.fromCharCode(c)),
      'indexOf(II)I': (t, [s, c, f]) => s.indexOf(String.fromCharCode(c), Math.max(0, f)),
      'indexOf(Ljava/lang/String;)I': (t, [s, x]) => s.indexOf(x),
      'indexOf(Ljava/lang/String;I)I': (t, [s, x, f]) => s.indexOf(x, Math.max(0, f)),
      'lastIndexOf(I)I': (t, [s, c]) => s.lastIndexOf(String.fromCharCode(c)),
      'lastIndexOf(II)I': (t, [s, c, f]) => (f < 0 ? -1 : s.lastIndexOf(String.fromCharCode(c), f)),
      'lastIndexOf(Ljava/lang/String;)I': (t, [s, x]) => s.lastIndexOf(x),
      'lastIndexOf(Ljava/lang/String;I)I': (t, [s, x, f]) => (f < 0 ? -1 : s.lastIndexOf(x, f)),
      'equals(Ljava/lang/Object;)Z': (t, [s, o]) => s === o,
      'equalsIgnoreCase(Ljava/lang/String;)Z': (t, [s, o]) => o !== null && s.toLowerCase() === o.toLowerCase(),
      'compareTo(Ljava/lang/String;)I': (t, [a, b]) => {
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) { const d = a.charCodeAt(i) - b.charCodeAt(i); if (d) return d; }
        return a.length - b.length;
      },
      'hashCode()I': (t, [s]) => KP.stringHash(s),
      'toLowerCase()Ljava/lang/String;': (t, [s]) => s.toLowerCase(),
      'toUpperCase()Ljava/lang/String;': (t, [s]) => s.toUpperCase(),
      'trim()Ljava/lang/String;': (t, [s]) => s.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, ''),
      'startsWith(Ljava/lang/String;)Z': (t, [s, p]) => s.startsWith(p),
      'startsWith(Ljava/lang/String;I)Z': (t, [s, p, o]) => o >= 0 && s.startsWith(p, o),
      'endsWith(Ljava/lang/String;)Z': (t, [s, p]) => s.endsWith(p),
      'concat(Ljava/lang/String;)Ljava/lang/String;': (t, [s, o]) => s + o,
      'replace(CC)Ljava/lang/String;': (t, [s, a, b]) => s.split(String.fromCharCode(a)).join(String.fromCharCode(b)),
      'toCharArray()[C': (t, [s]) => newCharArray(s),
      'getChars(II[CI)V': (t, [s, b, e, dst, db]) => {
        if (b < 0 || e > s.length || b > e) thr(t, 'java/lang/StringIndexOutOfBoundsException');
        for (let i = b; i < e; i++) dst[db + i - b] = s.charCodeAt(i);
      },
      'getBytes()[B': (t, [s]) => encodeString(s, ''),
      'getBytes(Ljava/lang/String;)[B': (t, [s, enc]) => encodeString(s, enc),
      'toString()Ljava/lang/String;': (t, [s]) => s,
      'intern()Ljava/lang/String;': (t, [s]) => s,
      'regionMatches(ZILjava/lang/String;II)Z': (t, [s, ic, to, o, oo, len]) => {
        if (to < 0 || oo < 0 || to + len > s.length || oo + len > o.length) return false;
        let a = s.substr(to, len), b = o.substr(oo, len);
        if (ic) { a = a.toLowerCase(); b = b.toLowerCase(); }
        return a === b;
      },
      'contains(Ljava/lang/CharSequence;)Z': (t, [s, x]) => s.indexOf(x) >= 0,
      'isEmpty()Z': (t, [s]) => s.length === 0,
      'split(Ljava/lang/String;)[Ljava/lang/String;': (t, [s, re]) => { const a = s.split(new RegExp(re)); while (a.length && a[a.length - 1] === '') a.pop(); a.$t = '[Ljava/lang/String;'; return a; },
      'valueOf(I)Ljava/lang/String;': Object.assign((t, [v]) => String(v), { isStatic: true }),
      'valueOf(J)Ljava/lang/String;': Object.assign((t, [v]) => String(v), { isStatic: true }),
      'valueOf(F)Ljava/lang/String;': Object.assign((t, [v]) => fToS(v), { isStatic: true }),
      'valueOf(D)Ljava/lang/String;': Object.assign((t, [v]) => dToS(v), { isStatic: true }),
      'valueOf(Z)Ljava/lang/String;': Object.assign((t, [v]) => (v ? 'true' : 'false'), { isStatic: true }),
      'valueOf(C)Ljava/lang/String;': Object.assign((t, [v]) => String.fromCharCode(v), { isStatic: true }),
      'valueOf([C)Ljava/lang/String;': Object.assign((t, [a]) => charsToString(a, 0, a.length), { isStatic: true }),
      'valueOf([CII)Ljava/lang/String;': Object.assign((t, [a, o, n]) => charsToString(a, o, n), { isStatic: true }),
      'valueOf(Ljava/lang/Object;)Ljava/lang/String;': Object.assign(function* (t, [o]) { return yield* toJString(t, o); }, { isStatic: true }),
    },
  });
  KP.charsToString = charsToString;

  // ---------- StringBuffer / StringBuilder ----------
  function sbDef(name) {
    const self = 'L' + name + ';';
    const ap = (fn) => (t, a) => { a[0]._s += fn(a[1], a); return a[0]; };
    const m = {
      '<init>()V': (t, [o]) => { o._s = ''; },
      '<init>(I)V': (t, [o]) => { o._s = ''; },
      '<init>(Ljava/lang/String;)V': (t, [o, s]) => { if (s === null) thr(t, 'java/lang/NullPointerException'); o._s = s; },
      'toString()Ljava/lang/String;': (t, [o]) => o._s,
      'length()I': (t, [o]) => o._s.length,
      'capacity()I': (t, [o]) => o._s.length + 16,
      'ensureCapacity(I)V': () => {},
      'charAt(I)C': (t, [o, i]) => { if (i < 0 || i >= o._s.length) thr(t, 'java/lang/StringIndexOutOfBoundsException', String(i)); return o._s.charCodeAt(i); },
      'setCharAt(IC)V': (t, [o, i, c]) => { if (i < 0 || i >= o._s.length) thr(t, 'java/lang/StringIndexOutOfBoundsException', String(i)); o._s = o._s.substring(0, i) + String.fromCharCode(c) + o._s.substring(i + 1); },
      'setLength(I)V': (t, [o, n]) => { o._s = n <= o._s.length ? o._s.substring(0, n) : o._s + '\u0000'.repeat(n - o._s.length); },
      'getChars(II[CI)V': (t, [o, b, e, dst, db]) => { for (let i = b; i < e; i++) dst[db + i - b] = o._s.charCodeAt(i); },
      ['append(Ljava/lang/String;)' + self]: ap((v) => (v === null ? 'null' : v)),
      ['append(I)' + self]: ap((v) => String(v)),
      ['append(J)' + self]: ap((v) => String(v)),
      ['append(F)' + self]: ap((v) => fToS(v)),
      ['append(D)' + self]: ap((v) => dToS(v)),
      ['append(C)' + self]: ap((v) => String.fromCharCode(v)),
      ['append(Z)' + self]: ap((v) => (v ? 'true' : 'false')),
      ['append([C)' + self]: ap((v) => charsToString(v, 0, v.length)),
      ['append([CII)' + self]: (t, [o, a, off, len]) => { o._s += charsToString(a, off, len); return o; },
      ['append(Ljava/lang/StringBuffer;)' + self]: ap((v) => (v === null ? 'null' : v._s)),
      ['append(Ljava/lang/CharSequence;)' + self]: function* (t, [o, v]) { o._s += yield* toJString(t, v); return o; },
      ['append(Ljava/lang/Object;)' + self]: function* (t, [o, v]) { o._s += yield* toJString(t, v); return o; },
      ['insert(ILjava/lang/String;)' + self]: (t, [o, i, v]) => { o._s = o._s.substring(0, i) + (v === null ? 'null' : v) + o._s.substring(i); return o; },
      ['insert(IC)' + self]: (t, [o, i, v]) => { o._s = o._s.substring(0, i) + String.fromCharCode(v) + o._s.substring(i); return o; },
      ['insert(II)' + self]: (t, [o, i, v]) => { o._s = o._s.substring(0, i) + v + o._s.substring(i); return o; },
      ['insert(IJ)' + self]: (t, [o, i, v]) => { o._s = o._s.substring(0, i) + v + o._s.substring(i); return o; },
      ['insert(IZ)' + self]: (t, [o, i, v]) => { o._s = o._s.substring(0, i) + (v ? 'true' : 'false') + o._s.substring(i); return o; },
      ['insert(I[C)' + self]: (t, [o, i, v]) => { o._s = o._s.substring(0, i) + charsToString(v, 0, v.length) + o._s.substring(i); return o; },
      ['insert(ILjava/lang/Object;)' + self]: function* (t, [o, i, v]) { const x = yield* toJString(t, v); o._s = o._s.substring(0, i) + x + o._s.substring(i); return o; },
      ['delete(II)' + self]: (t, [o, a, b]) => { if (a < 0 || a > o._s.length || a > b) thr(t, 'java/lang/StringIndexOutOfBoundsException'); o._s = o._s.substring(0, a) + o._s.substring(Math.min(b, o._s.length)); return o; },
      ['deleteCharAt(I)' + self]: (t, [o, i]) => { if (i < 0 || i >= o._s.length) thr(t, 'java/lang/StringIndexOutOfBoundsException'); o._s = o._s.substring(0, i) + o._s.substring(i + 1); return o; },
      ['reverse()' + self]: (t, [o]) => { o._s = o._s.split('').reverse().join(''); return o; },
      ['replace(IILjava/lang/String;)' + self]: (t, [o, a, b, s]) => { o._s = o._s.substring(0, a) + s + o._s.substring(Math.min(b, o._s.length)); return o; },
      'indexOf(Ljava/lang/String;)I': (t, [o, s]) => o._s.indexOf(s),
      'substring(I)Ljava/lang/String;': (t, [o, a]) => o._s.substring(a),
      'substring(II)Ljava/lang/String;': (t, [o, a, b]) => o._s.substring(a, b),
    };
    def(name, { methods: m });
  }
  sbDef('java/lang/StringBuffer');
  sbDef('java/lang/StringBuilder');

  // ---------- System / Runtime ----------
  def('java/lang/System', {
    statics: { out: ['Ljava/io/PrintStream;', null], err: ['Ljava/io/PrintStream;', null] },
    clinit(vm, c) {
      const out = vm.newObject('java/io/PrintStream'); out._log = 'out'; out._buf = '';
      const err = vm.newObject('java/io/PrintStream'); err._log = 'err'; err._buf = '';
      c.statics[c.fieldsByName.get('out').id] = out;
      c.statics[c.fieldsByName.get('err').id] = err;
    },
    staticMethods: ['currentTimeMillis()J', 'arraycopy(Ljava/lang/Object;ILjava/lang/Object;II)V', 'gc()V', 'exit(I)V', 'getProperty(Ljava/lang/String;)Ljava/lang/String;', 'identityHashCode(Ljava/lang/Object;)I', 'nanoTime()J'],
    methods: {
      'currentTimeMillis()J': () => BigInt(Date.now()),
      'nanoTime()J': () => BigInt(Math.round(KP.now() * 1e6)),
      'gc()V': () => {},
      'exit(I)V': (t) => { if (t.vm.host.exit) t.vm.host.exit(); },
      'identityHashCode(Ljava/lang/Object;)I': (t, [o]) => (o === null ? 0 : t.vm.identityHash(o)),
      'getProperty(Ljava/lang/String;)Ljava/lang/String;': (t, [k]) => {
        const v = t.vm.sysProps[k];
        return v === undefined ? null : v;
      },
      'arraycopy(Ljava/lang/Object;ILjava/lang/Object;II)V': (t, [src, sp, dst, dp, n]) => {
        if (src === null || dst === null) thr(t, 'java/lang/NullPointerException');
        if (!src.$t || !dst.$t) thr(t, 'java/lang/ArrayStoreException');
        if (n < 0 || sp < 0 || dp < 0 || sp + n > src.length || dp + n > dst.length) thr(t, 'java/lang/ArrayIndexOutOfBoundsException', 'arraycopy');
        if (n === 0) return;
        if (src === dst) {
          if (src.copyWithin) src.copyWithin(dp, sp, sp + n);
          else { const tmp = src.slice(sp, sp + n); for (let i = 0; i < n; i++) dst[dp + i] = tmp[i]; }
          return;
        }
        if (dst.set && src.subarray && dst.constructor === src.constructor) dst.set(src.subarray(sp, sp + n), dp);
        else for (let i = 0; i < n; i++) dst[dp + i] = src[sp + i];
      },
    },
  });
  def('java/lang/Runtime', {
    staticMethods: ['getRuntime()Ljava/lang/Runtime;'],
    methods: {
      'getRuntime()Ljava/lang/Runtime;': (t) => t.vm.runtimeObj || (t.vm.runtimeObj = t.vm.newObject('java/lang/Runtime')),
      'freeMemory()J': () => 3n * 1024n * 1024n,
      'totalMemory()J': () => 4n * 1024n * 1024n,
      'gc()V': () => {},
      'exit(I)V': (t) => { if (t.vm.host.exit) t.vm.host.exit(); },
    },
  });

  // ---------- Math ----------
  const mth = {};
  const st = (k, f) => { mth[k] = Object.assign(f, { isStatic: true }); };
  st('abs(I)I', (t, [a]) => (a < 0 ? -a | 0 : a));
  st('abs(J)J', (t, [a]) => (a < 0n ? BigInt.asIntN(64, -a) : a));
  st('abs(F)F', (t, [a]) => Math.abs(a));
  st('abs(D)D', (t, [a]) => Math.abs(a));
  st('max(II)I', (t, [a, b]) => (a > b ? a : b)); st('min(II)I', (t, [a, b]) => (a < b ? a : b));
  st('max(JJ)J', (t, [a, b]) => (a > b ? a : b)); st('min(JJ)J', (t, [a, b]) => (a < b ? a : b));
  st('max(FF)F', (t, [a, b]) => Math.max(a, b)); st('min(FF)F', (t, [a, b]) => Math.min(a, b));
  st('max(DD)D', (t, [a, b]) => Math.max(a, b)); st('min(DD)D', (t, [a, b]) => Math.min(a, b));
  for (const f of ['sin', 'cos', 'tan', 'sqrt', 'ceil', 'floor', 'asin', 'acos', 'atan', 'exp', 'log']) st(f + '(D)D', (t, [a]) => Math[f](a));
  st('atan2(DD)D', (t, [a, b]) => Math.atan2(a, b));
  st('pow(DD)D', (t, [a, b]) => Math.pow(a, b));
  st('toRadians(D)D', (t, [a]) => a * Math.PI / 180);
  st('toDegrees(D)D', (t, [a]) => a * 180 / Math.PI);
  st('random()D', () => Math.random());
  st('round(F)I', (t, [a]) => (a !== a ? 0 : Math.max(-2147483648, Math.min(2147483647, Math.floor(a + 0.5)))));
  st('round(D)J', (t, [a]) => (a !== a ? 0n : BigInt(Math.floor(a + 0.5))));
  st('rint(D)D', (t, [a]) => { const r = Math.round(a); return (Math.abs(a % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r; });
  def('java/lang/Math', { statics: { PI: ['D', Math.PI], E: ['D', Math.E] }, methods: mth });

  // ---------- Threads ----------
  def('java/lang/Runnable', { isInterface: true, methods: { 'run()V': Object.assign(() => {}, {}) } });
  KP.natives['java/lang/Runnable'].methods['run()V'].abstract = true;

  def('java/lang/Thread', {
    interfaces: ['java/lang/Runnable'],
    statics: { MIN_PRIORITY: ['I', 1], NORM_PRIORITY: ['I', 5], MAX_PRIORITY: ['I', 10] },
    staticMethods: ['sleep(J)V', 'yield()V', 'currentThread()Ljava/lang/Thread;', 'activeCount()I'],
    methods: {
      '<init>()V': (t, [o]) => { o._target = null; o._name = 'Thread-' + (++t.vm.idHash); },
      '<init>(Ljava/lang/Runnable;)V': (t, [o, r]) => { o._target = r; o._name = 'Thread-' + (++t.vm.idHash); },
      '<init>(Ljava/lang/Runnable;Ljava/lang/String;)V': (t, [o, r, n]) => { o._target = r; o._name = n; },
      '<init>(Ljava/lang/String;)V': (t, [o, n]) => { o._target = null; o._name = n; },
      'run()V': function* (t, [o]) {
        if (o._target) yield { invoke: t.vm.findVirtual(o._target, 'run()V'), args: [o._target] };
      },
      'start()V': (t, [o]) => {
        if (o._vt) thr(t, 'java/lang/IllegalThreadStateException');
        const vm = t.vm;
        const nt = vm.newThread(o._name);
        nt.javaThread = o; o._vt = nt;
        vm.pushInvoke(nt, vm.findVirtual(o, 'run()V'), [o]);
        vm.schedule();
      },
      'isAlive()Z': (t, [o]) => !!(o._vt && o._vt.frames.length && o._vt.state !== 2),
      'join()V': function* (t, [o]) { yield { block: () => !!(o._vt && o._vt.frames.length) }; },
      'join(J)V': function* (t, [o, ms]) { yield { block: () => !!(o._vt && o._vt.frames.length), wake: KP.now() + Number(ms) }; },
      'setPriority(I)V': () => {},
      'getPriority()I': () => 5,
      'getName()Ljava/lang/String;': (t, [o]) => o._name || 'Thread',
      'setName(Ljava/lang/String;)V': (t, [o, n]) => { o._name = n; },
      'interrupt()V': (t, [o]) => { if (o._vt) { o._vt.interrupted = true; if (o._vt.blocker) { o._vt.wakeAt = 1; } } t.vm.wakeup(); },
      'isInterrupted()Z': (t, [o]) => !!(o._vt && o._vt.interrupted),
      'setDaemon(Z)V': () => {},
      'toString()Ljava/lang/String;': (t, [o]) => 'Thread[' + (o._name || '') + ',5,main]',
      'sleep(J)V': (t, [ms]) => {
        if (t.sync) return;
        const n = Number(ms);
        if (n < 0) thr(t, 'java/lang/IllegalArgumentException', 'timeout value is negative');
        const wake = KP.now() + Math.max(n, 1);
        t.blocker = () => !t.interrupted; t.wakeAt = wake;
      },
      'yield()V': (t) => { t.yieldNow = true; },
      'currentThread()Ljava/lang/Thread;': (t) => {
        if (!t.javaThread) { const o = t.vm.newObject('java/lang/Thread'); o._name = t.name; o._vt = t; o._target = null; t.javaThread = o; }
        return t.javaThread;
      },
      'activeCount()I': (t) => t.vm.threads.length,
    },
  });

  // ---------- wrappers ----------
  const wrapper = (name, prim, desc, extra) => {
    const m = Object.assign({
      ['<init>(' + prim + ')V']: (t, [o, v]) => { o._v = v; },
      'hashCode()I': (t, [o]) => (prim === 'J' ? Number(BigInt.asIntN(32, o._v ^ (o._v >> 32n))) : prim === 'D' || prim === 'F' ? (Math.floor(o._v) | 0) : (o._v | 0)),
      'equals(Ljava/lang/Object;)Z': (t, [o, x]) => x !== null && typeof x === 'object' && x.__cls === o.__cls && (x._v === o._v || (x._v !== x._v && o._v !== o._v)),
      'toString()Ljava/lang/String;': (t, [o]) => (prim === 'F' ? fToS(o._v) : prim === 'D' ? dToS(o._v) : prim === 'Z' ? (o._v ? 'true' : 'false') : prim === 'C' ? String.fromCharCode(o._v) : String(o._v)),
    }, extra.methods || {});
    def(name, { statics: extra.statics, methods: m });
  };
  const S_ = (f) => Object.assign(f, { isStatic: true });
  const num = (prim, conv) => ({
    'intValue()I': (t, [o]) => (prim === 'J' ? Number(BigInt.asIntN(32, o._v)) : f2iS(o._v)),
    'longValue()J': (t, [o]) => (prim === 'J' ? o._v : BigInt(Math.trunc(o._v))),
    'floatValue()F': (t, [o]) => Math.fround(Number(o._v)),
    'doubleValue()D': (t, [o]) => Number(o._v),
    'byteValue()B': (t, [o]) => (Number(prim === 'J' ? BigInt.asIntN(8, o._v) : (o._v << 24) >> 24)),
    'shortValue()S': (t, [o]) => (Number(prim === 'J' ? BigInt.asIntN(16, o._v) : (o._v << 16) >> 16)),
  });
  function f2iS(v) { return v !== v ? 0 : Math.max(-2147483648, Math.min(2147483647, Math.trunc(v))) | 0; }

  wrapper('java/lang/Integer', 'I', 'I', {
    statics: { MIN_VALUE: ['I', -2147483648], MAX_VALUE: ['I', 2147483647] },
    methods: Object.assign(num('I'), {
      'parseInt(Ljava/lang/String;)I': S_((t, [s]) => parseIntStrict(t, s, 10)),
      'parseInt(Ljava/lang/String;I)I': S_((t, [s, r]) => parseIntStrict(t, s, r)),
      'valueOf(Ljava/lang/String;)Ljava/lang/Integer;': S_((t, [s]) => { const o = t.vm.newObject('java/lang/Integer'); o._v = parseIntStrict(t, s, 10); return o; }),
      'valueOf(Ljava/lang/String;I)Ljava/lang/Integer;': S_((t, [s, r]) => { const o = t.vm.newObject('java/lang/Integer'); o._v = parseIntStrict(t, s, r); return o; }),
      'valueOf(I)Ljava/lang/Integer;': S_((t, [v]) => { const o = t.vm.newObject('java/lang/Integer'); o._v = v; return o; }),
      'toString(I)Ljava/lang/String;': S_((t, [v]) => String(v)),
      'toString(II)Ljava/lang/String;': S_((t, [v, r]) => v.toString(r)),
      'toHexString(I)Ljava/lang/String;': S_((t, [v]) => (v >>> 0).toString(16)),
      'toOctalString(I)Ljava/lang/String;': S_((t, [v]) => (v >>> 0).toString(8)),
      'toBinaryString(I)Ljava/lang/String;': S_((t, [v]) => (v >>> 0).toString(2)),
    }),
  });
  wrapper('java/lang/Long', 'J', 'J', {
    statics: { MIN_VALUE: ['J', -9223372036854775808n], MAX_VALUE: ['J', 9223372036854775807n] },
    methods: Object.assign(num('J'), {
      'parseLong(Ljava/lang/String;)J': S_((t, [s]) => parseLongStrict(t, s, 10)),
      'parseLong(Ljava/lang/String;I)J': S_((t, [s, r]) => parseLongStrict(t, s, r)),
      'toString(J)Ljava/lang/String;': S_((t, [v]) => String(v)),
      'toString(JI)Ljava/lang/String;': S_((t, [v, r]) => v.toString(r)),
      'valueOf(J)Ljava/lang/Long;': S_((t, [v]) => { const o = t.vm.newObject('java/lang/Long'); o._v = v; return o; }),
    }),
  });
  wrapper('java/lang/Short', 'S', 'S', {
    statics: { MIN_VALUE: ['S', -32768], MAX_VALUE: ['S', 32767] },
    methods: Object.assign(num('S'), {
      'parseShort(Ljava/lang/String;)S': S_((t, [s]) => { const v = parseIntStrict(t, s, 10); if (v < -32768 || v > 32767) thr(t, 'java/lang/NumberFormatException', s); return v; }),
      'parseShort(Ljava/lang/String;I)S': S_((t, [s, r]) => parseIntStrict(t, s, r)),
      'toString(S)Ljava/lang/String;': S_((t, [v]) => String(v)),
    }),
  });
  wrapper('java/lang/Byte', 'B', 'B', {
    statics: { MIN_VALUE: ['B', -128], MAX_VALUE: ['B', 127] },
    methods: Object.assign(num('B'), {
      'parseByte(Ljava/lang/String;)B': S_((t, [s]) => { const v = parseIntStrict(t, s, 10); if (v < -128 || v > 127) thr(t, 'java/lang/NumberFormatException', s); return v; }),
      'parseByte(Ljava/lang/String;I)B': S_((t, [s, r]) => parseIntStrict(t, s, r)),
      'toString(B)Ljava/lang/String;': S_((t, [v]) => String(v)),
    }),
  });
  wrapper('java/lang/Character', 'C', 'C', {
    statics: { MIN_VALUE: ['C', 0], MAX_VALUE: ['C', 0xffff], MIN_RADIX: ['I', 2], MAX_RADIX: ['I', 36] },
    methods: {
      'charValue()C': (t, [o]) => o._v,
      'isDigit(C)Z': S_((t, [c]) => c >= 48 && c <= 57),
      'isLetter(C)Z': S_((t, [c]) => /\p{L}/u.test(String.fromCharCode(c))),
      'isLetterOrDigit(C)Z': S_((t, [c]) => /[\p{L}\p{Nd}]/u.test(String.fromCharCode(c))),
      'isSpace(C)Z': S_((t, [c]) => c === 32 || (c >= 9 && c <= 13)),
      'isWhitespace(C)Z': S_((t, [c]) => /\s/.test(String.fromCharCode(c))),
      'isUpperCase(C)Z': S_((t, [c]) => { const s = String.fromCharCode(c); return s !== s.toLowerCase() && s === s.toUpperCase(); }),
      'isLowerCase(C)Z': S_((t, [c]) => { const s = String.fromCharCode(c); return s !== s.toUpperCase() && s === s.toLowerCase(); }),
      'toUpperCase(C)C': S_((t, [c]) => { const u = String.fromCharCode(c).toUpperCase(); return u.length === 1 ? u.charCodeAt(0) : c; }),
      'toLowerCase(C)C': S_((t, [c]) => { const u = String.fromCharCode(c).toLowerCase(); return u.length === 1 ? u.charCodeAt(0) : c; }),
      'digit(CI)I': S_((t, [c, r]) => { const d = parseInt(String.fromCharCode(c), r); return isNaN(d) ? -1 : d; }),
      'forDigit(II)C': S_((t, [d, r]) => (d >= 0 && d < r ? d.toString(r).charCodeAt(0) : 0)),
      'toString(C)Ljava/lang/String;': S_((t, [c]) => String.fromCharCode(c)),
      'valueOf(C)Ljava/lang/Character;': S_((t, [c]) => { const o = t.vm.newObject('java/lang/Character'); o._v = c; return o; }),
    },
  });
  wrapper('java/lang/Boolean', 'Z', 'Z', {
    statics: { TRUE: ['Ljava/lang/Boolean;', null], FALSE: ['Ljava/lang/Boolean;', null] },
    methods: {
      'booleanValue()Z': (t, [o]) => o._v,
      'valueOf(Z)Ljava/lang/Boolean;': S_((t, [v]) => { const o = t.vm.newObject('java/lang/Boolean'); o._v = v ? 1 : 0; return o; }),
      'toString(Z)Ljava/lang/String;': S_((t, [v]) => (v ? 'true' : 'false')),
    },
  });
  KP.natives['java/lang/Boolean'].clinit = (vm, c) => {
    const T = vm.newObject(c); T._v = 1; const F = vm.newObject(c); F._v = 0;
    c.statics[c.fieldsByName.get('TRUE').id] = T; c.statics[c.fieldsByName.get('FALSE').id] = F;
  };
  const fb = new DataView(new ArrayBuffer(8));
  wrapper('java/lang/Float', 'F', 'F', {
    statics: { NaN: ['F', NaN], POSITIVE_INFINITY: ['F', Infinity], NEGATIVE_INFINITY: ['F', -Infinity], MAX_VALUE: ['F', 3.4028234663852886e38], MIN_VALUE: ['F', 1.401298464324817e-45] },
    methods: Object.assign(num('F'), {
      'isNaN()Z': (t, [o]) => o._v !== o._v,
      'isInfinite()Z': (t, [o]) => o._v === Infinity || o._v === -Infinity,
      'isNaN(F)Z': S_((t, [v]) => v !== v),
      'isInfinite(F)Z': S_((t, [v]) => v === Infinity || v === -Infinity),
      'floatToIntBits(F)I': S_((t, [v]) => { fb.setFloat32(0, v); return fb.getInt32(0); }),
      'intBitsToFloat(I)F': S_((t, [v]) => { fb.setInt32(0, v); return fb.getFloat32(0); }),
      'parseFloat(Ljava/lang/String;)F': S_((t, [s]) => Math.fround(parseFloatStrict(t, s))),
      'valueOf(Ljava/lang/String;)Ljava/lang/Float;': S_((t, [s]) => { const o = t.vm.newObject('java/lang/Float'); o._v = Math.fround(parseFloatStrict(t, s)); return o; }),
      'toString(F)Ljava/lang/String;': S_((t, [v]) => fToS(v)),
      '<init>(D)V': (t, [o, v]) => { o._v = Math.fround(v); },
    }),
  });
  wrapper('java/lang/Double', 'D', 'D', {
    statics: { NaN: ['D', NaN], POSITIVE_INFINITY: ['D', Infinity], NEGATIVE_INFINITY: ['D', -Infinity], MAX_VALUE: ['D', Number.MAX_VALUE], MIN_VALUE: ['D', Number.MIN_VALUE] },
    methods: Object.assign(num('D'), {
      'isNaN()Z': (t, [o]) => o._v !== o._v,
      'isNaN(D)Z': S_((t, [v]) => v !== v),
      'isInfinite(D)Z': S_((t, [v]) => v === Infinity || v === -Infinity),
      'doubleToLongBits(D)J': S_((t, [v]) => { fb.setFloat64(0, v); return fb.getBigInt64(0); }),
      'longBitsToDouble(J)D': S_((t, [v]) => { fb.setBigInt64(0, v); return fb.getFloat64(0); }),
      'parseDouble(Ljava/lang/String;)D': S_((t, [s]) => parseFloatStrict(t, s)),
      'valueOf(Ljava/lang/String;)Ljava/lang/Double;': S_((t, [s]) => { const o = t.vm.newObject('java/lang/Double'); o._v = parseFloatStrict(t, s); return o; }),
      'toString(D)Ljava/lang/String;': S_((t, [v]) => dToS(v)),
    }),
  });

  // ---------- Throwables ----------
  def('java/lang/Throwable', {
    methods: {
      '<init>()V': (t, [o]) => { o._msg = null; o._trace = t.vm.stackTrace(t).slice(1); },
      '<init>(Ljava/lang/String;)V': (t, [o, m]) => { o._msg = m; o._trace = t.vm.stackTrace(t).slice(1); },
      'getMessage()Ljava/lang/String;': (t, [o]) => (o._msg === undefined ? null : o._msg),
      'getLocalizedMessage()Ljava/lang/String;': (t, [o]) => (o._msg === undefined ? null : o._msg),
      'toString()Ljava/lang/String;': function* (t, [o]) {
        const gm = t.vm.findVirtual(o, 'getMessage()Ljava/lang/String;');
        const msg = gm.fn ? gm.fn(t, [o]) : yield { invoke: gm, args: [o] };
        return cname(t.vm, o) + (msg !== null && msg !== undefined ? ': ' + msg : '');
      },
      'printStackTrace()V': (t, [o]) => { t.vm.log(cname(t.vm, o) + (o._msg ? ': ' + o._msg : '') + '\n    at ' + (o._trace || []).join('\n    at ')); },
    },
  });
  const ex = (name, sup) => def(name, { super: sup, methods: {} });
  ex('java/lang/Exception', 'java/lang/Throwable');
  ex('java/lang/Error', 'java/lang/Throwable');
  ex('java/lang/RuntimeException', 'java/lang/Exception');
  for (const n of ['ArithmeticException', 'ArrayStoreException', 'ClassCastException', 'IllegalArgumentException', 'IllegalMonitorStateException',
    'IllegalStateException', 'IndexOutOfBoundsException', 'NegativeArraySizeException', 'NullPointerException', 'SecurityException', 'UnsupportedOperationException']) ex('java/lang/' + n, 'java/lang/RuntimeException');
  ex('java/lang/ArrayIndexOutOfBoundsException', 'java/lang/IndexOutOfBoundsException');
  ex('java/lang/StringIndexOutOfBoundsException', 'java/lang/IndexOutOfBoundsException');
  ex('java/lang/NumberFormatException', 'java/lang/IllegalArgumentException');
  ex('java/lang/IllegalThreadStateException', 'java/lang/IllegalArgumentException');
  for (const n of ['ClassNotFoundException', 'IllegalAccessException', 'InstantiationException', 'InterruptedException', 'CloneNotSupportedException']) ex('java/lang/' + n, 'java/lang/Exception');
  ex('java/lang/VirtualMachineError', 'java/lang/Error');
  ex('java/lang/OutOfMemoryError', 'java/lang/VirtualMachineError');
  ex('java/lang/StackOverflowError', 'java/lang/VirtualMachineError');
  ex('java/lang/LinkageError', 'java/lang/Error');
  ex('java/lang/NoClassDefFoundError', 'java/lang/LinkageError');
  ex('java/lang/IncompatibleClassChangeError', 'java/lang/LinkageError');
  ex('java/lang/AbstractMethodError', 'java/lang/IncompatibleClassChangeError');
  ex('java/lang/NoSuchFieldError', 'java/lang/IncompatibleClassChangeError');
  ex('java/lang/NoSuchMethodError', 'java/lang/IncompatibleClassChangeError');
  ex('java/io/IOException', 'java/lang/Exception');
  for (const n of ['EOFException', 'UnsupportedEncodingException', 'UTFDataFormatException', 'InterruptedIOException']) ex('java/io/' + n, 'java/io/IOException');
  ex('java/util/NoSuchElementException', 'java/lang/RuntimeException');
  ex('java/util/EmptyStackException', 'java/lang/RuntimeException');
  def('java/lang/CharSequence', { isInterface: true, methods: {} });
  def('java/lang/Comparable', { isInterface: true, methods: {} });
  def('java/lang/Cloneable', { isInterface: true, methods: {} });
  def('java/io/Serializable', { isInterface: true, methods: {} });

  // ---------- java.util ----------
  def('java/util/Enumeration', { isInterface: true, methods: {} });
  def('kp/ArrayEnum', {
    interfaces: ['java/util/Enumeration'],
    methods: {
      'hasMoreElements()Z': (t, [o]) => o._i < o._a.length,
      'nextElement()Ljava/lang/Object;': (t, [o]) => { if (o._i >= o._a.length) thr(t, 'java/util/NoSuchElementException'); return o._a[o._i++]; },
    },
  });
  function arrayEnum(vm, arr) { const e = vm.newObject('kp/ArrayEnum'); e._a = arr; e._i = 0; return e; }

  const vecIndexOf = (t, o, x, from) => { for (let i = Math.max(0, from); i < o._a.length; i++) if (jequals(t, x, o._a[i])) return i; return -1; };
  const vbound = (t, o, i, max) => { if (i < 0 || i >= (max === undefined ? o._a.length : max)) thr(t, 'java/lang/ArrayIndexOutOfBoundsException', i + ' >= ' + o._a.length); };
  const vecMethods = {
    '<init>()V': (t, [o]) => { o._a = []; },
    '<init>(I)V': (t, [o]) => { o._a = []; },
    '<init>(II)V': (t, [o]) => { o._a = []; },
    'addElement(Ljava/lang/Object;)V': (t, [o, x]) => { o._a.push(x); },
    'add(Ljava/lang/Object;)Z': (t, [o, x]) => { o._a.push(x); return 1; },
    'insertElementAt(Ljava/lang/Object;I)V': (t, [o, x, i]) => { vbound(t, o, i, o._a.length + 1); o._a.splice(i, 0, x); },
    'elementAt(I)Ljava/lang/Object;': (t, [o, i]) => { vbound(t, o, i); return o._a[i]; },
    'get(I)Ljava/lang/Object;': (t, [o, i]) => { vbound(t, o, i); return o._a[i]; },
    'setElementAt(Ljava/lang/Object;I)V': (t, [o, x, i]) => { vbound(t, o, i); o._a[i] = x; },
    'set(ILjava/lang/Object;)Ljava/lang/Object;': (t, [o, i, x]) => { vbound(t, o, i); const p = o._a[i]; o._a[i] = x; return p; },
    'removeElementAt(I)V': (t, [o, i]) => { vbound(t, o, i); o._a.splice(i, 1); },
    'remove(I)Ljava/lang/Object;': (t, [o, i]) => { vbound(t, o, i); return o._a.splice(i, 1)[0]; },
    'removeElement(Ljava/lang/Object;)Z': (t, [o, x]) => { const i = vecIndexOf(t, o, x, 0); if (i < 0) return 0; o._a.splice(i, 1); return 1; },
    'removeAllElements()V': (t, [o]) => { o._a.length = 0; },
    'clear()V': (t, [o]) => { o._a.length = 0; },
    'size()I': (t, [o]) => o._a.length,
    'isEmpty()Z': (t, [o]) => o._a.length === 0,
    'capacity()I': (t, [o]) => Math.max(10, o._a.length),
    'ensureCapacity(I)V': () => {},
    'trimToSize()V': () => {},
    'setSize(I)V': (t, [o, n]) => { while (o._a.length < n) o._a.push(null); o._a.length = n; },
    'firstElement()Ljava/lang/Object;': (t, [o]) => { if (!o._a.length) thr(t, 'java/util/NoSuchElementException'); return o._a[0]; },
    'lastElement()Ljava/lang/Object;': (t, [o]) => { if (!o._a.length) thr(t, 'java/util/NoSuchElementException'); return o._a[o._a.length - 1]; },
    'contains(Ljava/lang/Object;)Z': (t, [o, x]) => vecIndexOf(t, o, x, 0) >= 0,
    'indexOf(Ljava/lang/Object;)I': (t, [o, x]) => vecIndexOf(t, o, x, 0),
    'indexOf(Ljava/lang/Object;I)I': (t, [o, x, f]) => vecIndexOf(t, o, x, f),
    'lastIndexOf(Ljava/lang/Object;)I': (t, [o, x]) => { for (let i = o._a.length - 1; i >= 0; i--) if (jequals(t, x, o._a[i])) return i; return -1; },
    'elements()Ljava/util/Enumeration;': (t, [o]) => arrayEnum(t.vm, o._a.slice()),
    'copyInto([Ljava/lang/Object;)V': (t, [o, a]) => { for (let i = 0; i < o._a.length; i++) a[i] = o._a[i]; },
    'toString()Ljava/lang/String;': function* (t, [o]) { const p = []; for (const x of o._a) p.push(yield* toJString(t, x)); return '[' + p.join(', ') + ']'; },
  };
  def('java/util/Vector', { methods: vecMethods });
  def('java/util/Stack', {
    super: 'java/util/Vector',
    methods: {
      '<init>()V': (t, [o]) => { o._a = []; },
      'push(Ljava/lang/Object;)Ljava/lang/Object;': (t, [o, x]) => { o._a.push(x); return x; },
      'pop()Ljava/lang/Object;': (t, [o]) => { if (!o._a.length) thr(t, 'java/util/EmptyStackException'); return o._a.pop(); },
      'peek()Ljava/lang/Object;': (t, [o]) => { if (!o._a.length) thr(t, 'java/util/EmptyStackException'); return o._a[o._a.length - 1]; },
      'empty()Z': (t, [o]) => o._a.length === 0,
      'search(Ljava/lang/Object;)I': (t, [o, x]) => { for (let i = o._a.length - 1; i >= 0; i--) if (jequals(t, x, o._a[i])) return o._a.length - i; return -1; },
    },
  });

  function hkey(t, k) {
    if (k === null) thr(t, 'java/lang/NullPointerException');
    if (typeof k === 'string') return 's' + k;
    if (k._v !== undefined && k.__cls && k.__cls.native) return k.__cls.name + ':' + String(k._v);
    // user objects: overridden hashCode/equals -> bucket by hash and compare
    const hm = t.vm.findVirtual(k, 'hashCode()I');
    if (hm.fn === KP.natives['java/lang/Object'].methods['hashCode()I']) return 'o' + t.vm.identityHash(k);
    return null;
  }
  function hfind(t, o, k) {
    const key = hkey(t, k);
    if (key !== null) return key;
    const h = jhash(t, k);
    for (const [kk, e] of o._m) if (kk.startsWith('h' + h + '#') && jequals(t, k, e[0])) return kk;
    return 'h' + h + '#' + (++t.vm.idHash);
  }
  def('java/util/Hashtable', {
    methods: {
      '<init>()V': (t, [o]) => { o._m = new Map(); },
      '<init>(I)V': (t, [o]) => { o._m = new Map(); },
      'put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;': (t, [o, k, v]) => {
        if (v === null) thr(t, 'java/lang/NullPointerException');
        const key = hfind(t, o, k);
        const prev = o._m.get(key);
        o._m.set(key, [k, v]);
        return prev ? prev[1] : null;
      },
      'get(Ljava/lang/Object;)Ljava/lang/Object;': (t, [o, k]) => { const e = o._m.get(hfind(t, o, k)); return e ? e[1] : null; },
      'remove(Ljava/lang/Object;)Ljava/lang/Object;': (t, [o, k]) => { const key = hfind(t, o, k); const e = o._m.get(key); o._m.delete(key); return e ? e[1] : null; },
      'containsKey(Ljava/lang/Object;)Z': (t, [o, k]) => o._m.has(hfind(t, o, k)),
      'contains(Ljava/lang/Object;)Z': (t, [o, v]) => { for (const e of o._m.values()) if (jequals(t, v, e[1])) return 1; return 0; },
      'size()I': (t, [o]) => o._m.size,
      'isEmpty()Z': (t, [o]) => o._m.size === 0,
      'clear()V': (t, [o]) => { o._m.clear(); },
      'rehash()V': () => {},
      'keys()Ljava/util/Enumeration;': (t, [o]) => arrayEnum(t.vm, Array.from(o._m.values(), (e) => e[0])),
      'elements()Ljava/util/Enumeration;': (t, [o]) => arrayEnum(t.vm, Array.from(o._m.values(), (e) => e[1])),
      'toString()Ljava/lang/String;': function* (t, [o]) { const p = []; for (const e of o._m.values()) p.push((yield* toJString(t, e[0])) + '=' + (yield* toJString(t, e[1]))); return '{' + p.join(', ') + '}'; },
    },
  });

  const MULT = 0x5DEECE66Dn, MASK = (1n << 48n) - 1n;
  function rnext(o, bits) {
    o._seed = (o._seed * MULT + 0xBn) & MASK;
    return Number(BigInt.asIntN(32, o._seed >> BigInt(48 - bits)));
  }
  let seedUniq = 8682522807148012n;
  def('java/util/Random', {
    methods: {
      '<init>()V': (t, [o]) => { seedUniq = BigInt.asIntN(64, seedUniq * 181783497276652981n); o._seed = (BigInt(Date.now()) ^ seedUniq ^ MULT) & MASK; },
      '<init>(J)V': (t, [o, s]) => { o._seed = (s ^ MULT) & MASK; },
      'setSeed(J)V': (t, [o, s]) => { o._seed = (s ^ MULT) & MASK; },
      'next(I)I': (t, [o, b]) => rnext(o, b),
      'nextInt()I': (t, [o]) => rnext(o, 32),
      'nextInt(I)I': (t, [o, n]) => {
        if (n <= 0) thr(t, 'java/lang/IllegalArgumentException', 'n must be positive');
        if ((n & -n) === n) return Number((BigInt(n) * BigInt(rnext(o, 31))) >> 31n);
        let bits, val;
        do { bits = rnext(o, 31); val = bits % n; } while (bits - val + (n - 1) < 0 || bits - val + (n - 1) > 2147483647);
        return val;
      },
      'nextLong()J': (t, [o]) => BigInt.asIntN(64, (BigInt(rnext(o, 32)) << 32n) + BigInt(rnext(o, 32))),
      'nextFloat()F': (t, [o]) => rnext(o, 24) / (1 << 24),
      'nextDouble()D': (t, [o]) => (rnext(o, 26) * 134217728 + rnext(o, 27)) / 9007199254740992,
      'nextBoolean()Z': (t, [o]) => rnext(o, 1) !== 0,
    },
  });

  def('java/util/Date', {
    methods: {
      '<init>()V': (t, [o]) => { o._t = BigInt(Date.now()); },
      '<init>(J)V': (t, [o, v]) => { o._t = v; },
      'getTime()J': (t, [o]) => o._t,
      'setTime(J)V': (t, [o, v]) => { o._t = v; },
      'equals(Ljava/lang/Object;)Z': (t, [o, x]) => x !== null && x.__cls === o.__cls && x._t === o._t,
      'hashCode()I': (t, [o]) => Number(BigInt.asIntN(32, o._t ^ (o._t >> 32n))),
      'toString()Ljava/lang/String;': (t, [o]) => new Date(Number(o._t)).toString(),
    },
  });
  def('java/util/TimeZone', {
    staticMethods: ['getDefault()Ljava/util/TimeZone;', 'getTimeZone(Ljava/lang/String;)Ljava/util/TimeZone;', 'getAvailableIDs()[Ljava/lang/String;'],
    methods: {
      'getDefault()Ljava/util/TimeZone;': (t) => { const z = t.vm.newObject('java/util/TimeZone'); z._id = 'GMT'; z._off = -new Date().getTimezoneOffset() * 60000; return z; },
      'getTimeZone(Ljava/lang/String;)Ljava/util/TimeZone;': (t, [id]) => { const z = t.vm.newObject('java/util/TimeZone'); z._id = id; z._off = id === 'GMT' || id === 'UTC' ? 0 : -new Date().getTimezoneOffset() * 60000; return z; },
      'getID()Ljava/lang/String;': (t, [z]) => z._id,
      'getRawOffset()I': (t, [z]) => z._off,
      'getOffset(IIIIII)I': (t, [z]) => z._off,
      'useDaylightTime()Z': () => 0,
      'getAvailableIDs()[Ljava/lang/String;': () => { const a = ['GMT']; a.$t = '[Ljava/lang/String;'; return a; },
    },
  });
  const CAL = { ERA: 0, YEAR: 1, MONTH: 2, WEEK_OF_YEAR: 3, WEEK_OF_MONTH: 4, DATE: 5, DAY_OF_MONTH: 5, DAY_OF_YEAR: 6, DAY_OF_WEEK: 7, DAY_OF_WEEK_IN_MONTH: 8, AM_PM: 9, HOUR: 10, HOUR_OF_DAY: 11, MINUTE: 12, SECOND: 13, MILLISECOND: 14 };
  const calStatics = {};
  for (const k in CAL) calStatics[k] = ['I', CAL[k]];
  ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'].forEach((m, i) => { calStatics[m] = ['I', i]; });
  ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].forEach((d, i) => { calStatics[d] = ['I', i + 1]; });
  calStatics.AM = ['I', 0]; calStatics.PM = ['I', 1];
  def('java/util/Calendar', {
    statics: calStatics,
    staticMethods: ['getInstance()Ljava/util/Calendar;', 'getInstance(Ljava/util/TimeZone;)Ljava/util/Calendar;'],
    methods: {
      'getInstance()Ljava/util/Calendar;': (t) => { const c = t.vm.newObject('java/util/Calendar'); c._d = new Date(); return c; },
      'getInstance(Ljava/util/TimeZone;)Ljava/util/Calendar;': (t) => { const c = t.vm.newObject('java/util/Calendar'); c._d = new Date(); return c; },
      'get(I)I': (t, [c, f]) => {
        const d = c._d;
        switch (f) {
          case 0: return 1; case 1: return d.getFullYear(); case 2: return d.getMonth(); case 5: return d.getDate();
          case 6: return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
          case 7: return d.getDay() + 1; case 9: return d.getHours() >= 12 ? 1 : 0; case 10: return d.getHours() % 12;
          case 11: return d.getHours(); case 12: return d.getMinutes(); case 13: return d.getSeconds(); case 14: return d.getMilliseconds();
          default: return 0;
        }
      },
      'set(II)V': (t, [c, f, v]) => {
        const d = c._d;
        switch (f) {
          case 1: d.setFullYear(v); break; case 2: d.setMonth(v); break; case 5: d.setDate(v); break;
          case 11: d.setHours(v); break; case 10: d.setHours((d.getHours() >= 12 ? 12 : 0) + v); break;
          case 12: d.setMinutes(v); break; case 13: d.setSeconds(v); break; case 14: d.setMilliseconds(v); break;
        }
      },
      'getTime()Ljava/util/Date;': (t, [c]) => { const o = t.vm.newObject('java/util/Date'); o._t = BigInt(c._d.getTime()); return o; },
      'setTime(Ljava/util/Date;)V': (t, [c, d]) => { c._d = new Date(Number(d._t)); },
      'getTimeInMillis()J': (t, [c]) => BigInt(c._d.getTime()),
      'setTimeInMillis(J)V': (t, [c, v]) => { c._d = new Date(Number(v)); },
      'setTimeZone(Ljava/util/TimeZone;)V': () => {},
    },
  });

  // Timer runs each scheduled task on its own green thread
  def('java/util/TimerTask', {
    interfaces: ['java/lang/Runnable'],
    methods: {
      '<init>()V': (t, [o]) => { o._cancelled = false; o._last = 0n; },
      'cancel()Z': (t, [o]) => { const was = !o._cancelled; o._cancelled = true; return was; },
      'scheduledExecutionTime()J': (t, [o]) => o._last || 0n,
    },
  });
  function timerSchedule(t, timer, task, delay, period, fixed) {
    if (timer._cancelled) thr(t, 'java/lang/IllegalStateException', 'Timer already cancelled.');
    if (task._sched) thr(t, 'java/lang/IllegalStateException', 'Task already scheduled');
    task._sched = true; task._cancelled = false;
    const vm = t.vm;
    let next = KP.now() + Math.max(0, delay);
    vm.spawnGenerator('Timer', function* () {
      for (;;) {
        yield { block: () => !(timer._cancelled || task._cancelled), wake: next };
        if (timer._cancelled || task._cancelled) return;
        task._last = BigInt(Date.now());
        try { yield { invoke: vm.findVirtual(task, 'run()V'), args: [task] }; } catch (e) { if (!(e instanceof JThrow)) throw e; vm.warn('TimerTask threw'); }
        if (!period) return;
        next = fixed ? next + period : KP.now() + period;
      }
    });
  }
  def('java/util/Timer', {
    methods: {
      '<init>()V': (t, [o]) => { o._cancelled = false; },
      'cancel()V': (t, [o]) => { o._cancelled = true; t.vm.wakeup(); },
      'schedule(Ljava/util/TimerTask;J)V': (t, [o, k, d]) => timerSchedule(t, o, k, Number(d), 0, false),
      'schedule(Ljava/util/TimerTask;JJ)V': (t, [o, k, d, p]) => timerSchedule(t, o, k, Number(d), Number(p), false),
      'scheduleAtFixedRate(Ljava/util/TimerTask;JJ)V': (t, [o, k, d, p]) => timerSchedule(t, o, k, Number(d), Number(p), true),
      'schedule(Ljava/util/TimerTask;Ljava/util/Date;)V': (t, [o, k, d]) => timerSchedule(t, o, k, Number(d._t) - Date.now(), 0, false),
      'schedule(Ljava/util/TimerTask;Ljava/util/Date;J)V': (t, [o, k, d, p]) => timerSchedule(t, o, k, Number(d._t) - Date.now(), Number(p), false),
      'scheduleAtFixedRate(Ljava/util/TimerTask;Ljava/util/Date;J)V': (t, [o, k, d, p]) => timerSchedule(t, o, k, Number(d._t) - Date.now(), Number(p), true),
    },
  });

  // ---------- java.io ----------
  // Generic byte reading from any InputStream (native fast path, else virtual read())
  function readByteFrom(t, ins) {
    if (ins._b !== undefined && ins.__cls.name === 'java/io/ByteArrayInputStream') return ins._pos < ins._count ? (ins._b[ins._pos++] & 255) : -1;
    if (ins._in !== undefined) return readByteFrom(t, ins._in);
    const m = t.vm.findVirtual(ins, 'read()I');
    return m.fn ? m.fn(t, [ins]) : t.vm.invokeSync(m, [ins]);
  }
  function readInto(t, ins, buf, off, len) {
    if (buf === null) thr(t, 'java/lang/NullPointerException');
    if (off < 0 || len < 0 || off + len > buf.length) thr(t, 'java/lang/IndexOutOfBoundsException');
    if (len === 0) return 0;
    if (ins._b !== undefined && ins.__cls.name === 'java/io/ByteArrayInputStream') {
      if (ins._pos >= ins._count) return -1;
      const n = Math.min(len, ins._count - ins._pos);
      buf.set(ins._b.subarray(ins._pos, ins._pos + n), off);
      ins._pos += n;
      return n;
    }
    if (ins._in !== undefined) return readInto(t, ins._in, buf, off, len);
    const rm = t.vm.findVirtual(ins, 'read([BII)I');
    if (rm.fn !== baseReadArr) return rm.fn ? rm.fn(t, [ins, buf, off, len]) : t.vm.invokeSync(rm, [ins, buf, off, len]);
    let i = 0;
    for (; i < len; i++) { const c = readByteFrom(t, ins); if (c < 0) break; buf[off + i] = c; }
    return i === 0 ? -1 : i;
  }
  const baseReadArr = (t, [o, b, off, len]) => readInto(t, o, b, off, len);
  KP.newBAIS = function (vm, bytes) {
    const o = vm.newObject('java/io/ByteArrayInputStream');
    const b = bytes instanceof Int8Array ? bytes : new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
    o._b = b; o._pos = 0; o._count = b.length; o._mark = 0;
    return o;
  };
  def('java/io/InputStream', {
    methods: {
      '<init>()V': () => {},
      'read()I': (t, [o]) => -1,
      'read([B)I': (t, [o, b]) => { const m = t.vm.findVirtual(o, 'read([BII)I'); return m.fn ? m.fn(t, [o, b, 0, b.length]) : t.vm.invokeSync(m, [o, b, 0, b.length]); },
      'read([BII)I': baseReadArr,
      'available()I': () => 0,
      'skip(J)J': (t, [o, n]) => { let i = 0n; while (i < n && readByteFrom(t, o) >= 0) i++; return i; },
      'close()V': () => {},
      'mark(I)V': () => {},
      'reset()V': (t) => thr(t, 'java/io/IOException', 'mark/reset not supported'),
      'markSupported()Z': () => 0,
    },
  });
  KP.natives['java/io/InputStream'].methods['read()I'].abstractish = true;
  def('java/io/ByteArrayInputStream', {
    super: 'java/io/InputStream',
    methods: {
      '<init>([B)V': (t, [o, b]) => { o._b = b; o._pos = 0; o._count = b.length; o._mark = 0; },
      '<init>([BII)V': (t, [o, b, off, len]) => { o._b = b; o._pos = off; o._count = Math.min(off + len, b.length); o._mark = off; },
      'read()I': (t, [o]) => (o._pos < o._count ? (o._b[o._pos++] & 255) : -1),
      'read([BII)I': (t, [o, b, off, len]) => readInto(t, o, b, off, len),
      'available()I': (t, [o]) => o._count - o._pos,
      'skip(J)J': (t, [o, n]) => { const k = Math.max(0, Math.min(Number(n), o._count - o._pos)); o._pos += k; return BigInt(k); },
      'mark(I)V': (t, [o]) => { o._mark = o._pos; },
      'reset()V': (t, [o]) => { o._pos = o._mark; },
      'markSupported()Z': () => 1,
      'close()V': () => {},
    },
  });
  function need(t, ins, n) {
    const r = new Array(n);
    for (let i = 0; i < n; i++) { const c = readByteFrom(t, ins); if (c < 0) thr(t, 'java/io/EOFException'); r[i] = c; }
    return r;
  }
  const dvb = new DataView(new ArrayBuffer(8));
  function readUTF(t, o) {
    const [a, b] = need(t, o, 2);
    const len = (a << 8) | b;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) { const c = readByteFrom(t, o); if (c < 0) thr(t, 'java/io/EOFException'); bytes[i] = c; }
    return KP.utf8Decode(bytes);
  }
  KP.readUTF = readUTF;
  def('java/io/DataInputStream', {
    super: 'java/io/InputStream',
    methods: {
      '<init>(Ljava/io/InputStream;)V': (t, [o, i]) => { o._in = i; },
      'read()I': (t, [o]) => readByteFrom(t, o._in),
      'read([B)I': (t, [o, b]) => readInto(t, o._in, b, 0, b.length),
      'read([BII)I': (t, [o, b, off, len]) => readInto(t, o._in, b, off, len),
      'readFully([B)V': (t, [o, b]) => { let n = 0; while (n < b.length) { const r = readInto(t, o._in, b, n, b.length - n); if (r < 0) thr(t, 'java/io/EOFException'); n += r; } },
      'readFully([BII)V': (t, [o, b, off, len]) => { let n = 0; while (n < len) { const r = readInto(t, o._in, b, off + n, len - n); if (r < 0) thr(t, 'java/io/EOFException'); n += r; } },
      'readBoolean()Z': (t, [o]) => need(t, o._in, 1)[0] !== 0,
      'readByte()B': (t, [o]) => (need(t, o._in, 1)[0] << 24) >> 24,
      'readUnsignedByte()I': (t, [o]) => need(t, o._in, 1)[0],
      'readShort()S': (t, [o]) => { const [a, b] = need(t, o._in, 2); return (((a << 8) | b) << 16) >> 16; },
      'readUnsignedShort()I': (t, [o]) => { const [a, b] = need(t, o._in, 2); return (a << 8) | b; },
      'readChar()C': (t, [o]) => { const [a, b] = need(t, o._in, 2); return (a << 8) | b; },
      'readInt()I': (t, [o]) => { const [a, b, c, d] = need(t, o._in, 4); return (a << 24) | (b << 16) | (c << 8) | d; },
      'readLong()J': (t, [o]) => { const r = need(t, o._in, 8); for (let i = 0; i < 8; i++) dvb.setUint8(i, r[i]); return dvb.getBigInt64(0); },
      'readFloat()F': (t, [o]) => { const r = need(t, o._in, 4); for (let i = 0; i < 4; i++) dvb.setUint8(i, r[i]); return dvb.getFloat32(0); },
      'readDouble()D': (t, [o]) => { const r = need(t, o._in, 8); for (let i = 0; i < 8; i++) dvb.setUint8(i, r[i]); return dvb.getFloat64(0); },
      'readUTF()Ljava/lang/String;': (t, [o]) => readUTF(t, o._in),
      'readUTF(Ljava/io/DataInput;)Ljava/lang/String;': Object.assign((t, [i]) => readUTF(t, i), { isStatic: true }),
      'skipBytes(I)I': (t, [o, n]) => { let i = 0; while (i < n && readByteFrom(t, o._in) >= 0) i++; return i; },
      'skip(J)J': (t, [o, n]) => { let i = 0n; while (i < n && readByteFrom(t, o._in) >= 0) i++; return i; },
      'available()I': (t, [o]) => { const m = t.vm.findVirtual(o._in, 'available()I'); return m.fn ? m.fn(t, [o._in]) : t.vm.invokeSync(m, [o._in]); },
      'close()V': () => {},
      'mark(I)V': (t, [o, n]) => { const m = t.vm.findVirtual(o._in, 'mark(I)V'); if (m.fn) m.fn(t, [o._in, n]); },
      'reset()V': (t, [o]) => { const m = t.vm.findVirtual(o._in, 'reset()V'); if (m.fn) m.fn(t, [o._in]); },
      'markSupported()Z': (t, [o]) => { const m = t.vm.findVirtual(o._in, 'markSupported()Z'); return m.fn ? m.fn(t, [o._in]) : 0; },
    },
  });
  def('java/io/DataInput', { isInterface: true, methods: {} });
  def('java/io/DataOutput', { isInterface: true, methods: {} });
  KP.natives['java/io/DataInputStream'].interfaces = ['java/io/DataInput'];

  // output
  function writeBytesTo(t, out, arr) {
    if (out._out !== undefined) return writeBytesTo(t, out._out, arr);
    if (out._buf !== undefined && out.__cls.name === 'java/io/ByteArrayOutputStream') {
      baosEnsure(out, arr.length);
      for (let i = 0; i < arr.length; i++) out._buf[out._n++] = arr[i];
      return;
    }
    const m = t.vm.findVirtual(out, 'write(I)V');
    for (const b of arr) (m.fn ? m.fn(t, [out, b]) : t.vm.invokeSync(m, [out, b]));
  }
  function baosEnsure(o, n) {
    if (o._n + n <= o._buf.length) return;
    let len = Math.max(32, o._buf.length * 2);
    while (len < o._n + n) len *= 2;
    const b = new Uint8Array(len); b.set(o._buf.subarray(0, o._n)); o._buf = b;
  }
  def('java/io/OutputStream', {
    methods: {
      '<init>()V': () => {},
      'write(I)V': () => {},
      'write([B)V': (t, [o, b]) => writeBytesTo(t, o, b),
      'write([BII)V': (t, [o, b, off, len]) => writeBytesTo(t, o, b.subarray(off, off + len)),
      'flush()V': () => {},
      'close()V': () => {},
    },
  });
  def('java/io/ByteArrayOutputStream', {
    super: 'java/io/OutputStream',
    methods: {
      '<init>()V': (t, [o]) => { o._buf = new Uint8Array(32); o._n = 0; },
      '<init>(I)V': (t, [o, n]) => { o._buf = new Uint8Array(Math.max(1, n)); o._n = 0; },
      'write(I)V': (t, [o, b]) => { baosEnsure(o, 1); o._buf[o._n++] = b; },
      'write([BII)V': (t, [o, b, off, len]) => { baosEnsure(o, len); for (let i = 0; i < len; i++) o._buf[o._n++] = b[off + i]; },
      'toByteArray()[B': (t, [o]) => { const a = new Int8Array(o._n); a.set(new Int8Array(o._buf.buffer, 0, o._n)); a.$t = '[B'; return a; },
      'size()I': (t, [o]) => o._n,
      'reset()V': (t, [o]) => { o._n = 0; },
      'toString()Ljava/lang/String;': (t, [o]) => decodeBytes(new Int8Array(o._buf.buffer, 0, o._n), 0, o._n, ''),
      'close()V': () => {},
    },
  });
  const be = (n, v) => { const r = []; for (let i = n - 1; i >= 0; i--) r.push((v >>> (i * 8)) & 255); return r; };
  def('java/io/DataOutputStream', {
    super: 'java/io/OutputStream',
    interfaces: ['java/io/DataOutput'],
    methods: {
      '<init>(Ljava/io/OutputStream;)V': (t, [o, out]) => { o._out = out; o._written = 0; },
      'write(I)V': (t, [o, b]) => { writeBytesTo(t, o._out, [b]); o._written++; },
      'write([BII)V': (t, [o, b, off, len]) => { writeBytesTo(t, o._out, b.subarray(off, off + len)); o._written += len; },
      'write([B)V': (t, [o, b]) => { writeBytesTo(t, o._out, b); o._written += b.length; },
      'writeBoolean(Z)V': (t, [o, v]) => { writeBytesTo(t, o._out, [v ? 1 : 0]); o._written++; },
      'writeByte(I)V': (t, [o, v]) => { writeBytesTo(t, o._out, [v & 255]); o._written++; },
      'writeShort(I)V': (t, [o, v]) => { writeBytesTo(t, o._out, be(2, v)); o._written += 2; },
      'writeChar(I)V': (t, [o, v]) => { writeBytesTo(t, o._out, be(2, v)); o._written += 2; },
      'writeInt(I)V': (t, [o, v]) => { writeBytesTo(t, o._out, be(4, v)); o._written += 4; },
      'writeLong(J)V': (t, [o, v]) => { dvb.setBigInt64(0, v); const r = []; for (let i = 0; i < 8; i++) r.push(dvb.getUint8(i)); writeBytesTo(t, o._out, r); o._written += 8; },
      'writeFloat(F)V': (t, [o, v]) => { dvb.setFloat32(0, v); writeBytesTo(t, o._out, [0, 1, 2, 3].map((i) => dvb.getUint8(i))); o._written += 4; },
      'writeDouble(D)V': (t, [o, v]) => { dvb.setFloat64(0, v); const r = []; for (let i = 0; i < 8; i++) r.push(dvb.getUint8(i)); writeBytesTo(t, o._out, r); o._written += 8; },
      'writeChars(Ljava/lang/String;)V': (t, [o, s]) => { const r = []; for (let i = 0; i < s.length; i++) r.push(...be(2, s.charCodeAt(i))); writeBytesTo(t, o._out, r); o._written += r.length; },
      'writeUTF(Ljava/lang/String;)V': (t, [o, s]) => { const u = KP.utf8Encode(s); if (u.length > 65535) thr(t, 'java/io/UTFDataFormatException'); writeBytesTo(t, o._out, be(2, u.length).concat(u)); o._written += u.length + 2; },
      'size()I': (t, [o]) => o._written,
      'flush()V': () => {},
      'close()V': () => {},
    },
  });
  function psOut(t, o, s) {
    o._buf += s;
    let i;
    while ((i = o._buf.indexOf('\n')) >= 0) { t.vm.log((o._log === 'err' ? '[err] ' : '') + o._buf.substring(0, i)); o._buf = o._buf.substring(i + 1); }
  }
  const psm = {
    '<init>(Ljava/io/OutputStream;)V': (t, [o]) => { o._log = 'out'; o._buf = ''; },
    'flush()V': () => {},
    'close()V': () => {},
    'write(I)V': (t, [o, b]) => psOut(t, o, String.fromCharCode(b & 255)),
  };
  const prims = { 'Ljava/lang/String;': (v) => (v === null ? 'null' : v), I: String, J: String, C: (c) => String.fromCharCode(c), Z: (v) => (v ? 'true' : 'false'), F: fToS, D: dToS, '[C': (a) => charsToString(a, 0, a.length) };
  for (const k in prims) {
    psm['print(' + k + ')V'] = (t, [o, v]) => psOut(t, o, prims[k](v));
    psm['println(' + k + ')V'] = (t, [o, v]) => psOut(t, o, prims[k](v) + '\n');
  }
  psm['println()V'] = (t, [o]) => psOut(t, o, '\n');
  psm['print(Ljava/lang/Object;)V'] = function* (t, [o, v]) { psOut(t, o, yield* toJString(t, v)); };
  psm['println(Ljava/lang/Object;)V'] = function* (t, [o, v]) { psOut(t, o, (yield* toJString(t, v)) + '\n'); };
  def('java/io/PrintStream', { super: 'java/io/OutputStream', methods: psm });

  def('java/io/Reader', {
    methods: {
      '<init>()V': () => {},
      'read()I': () => -1,
      'read([C)I': (t, [o, a]) => { const m = t.vm.findVirtual(o, 'read([CII)I'); return m.fn ? m.fn(t, [o, a, 0, a.length]) : t.vm.invokeSync(m, [o, a, 0, a.length]); },
      'read([CII)I': (t, [o, a, off, len]) => {
        const m = t.vm.findVirtual(o, 'read()I');
        let i = 0;
        for (; i < len; i++) { const c = m.fn ? m.fn(t, [o]) : t.vm.invokeSync(m, [o]); if (c < 0) break; a[off + i] = c; }
        return i === 0 && len > 0 ? -1 : i;
      },
      'close()V': () => {},
      'ready()Z': () => 1,
      'skip(J)J': (t, [o, n]) => n,
      'markSupported()Z': () => 0,
    },
  });
  def('java/io/InputStreamReader', {
    super: 'java/io/Reader',
    methods: {
      '<init>(Ljava/io/InputStream;)V': (t, [o, i]) => { o._in = i; o._utf = true; },
      '<init>(Ljava/io/InputStream;Ljava/lang/String;)V': (t, [o, i, e]) => { o._in = i; o._utf = /utf-?8/i.test(e || ''); o._u16 = /utf-?16/i.test(e || ''); },
      'read()I': (t, [o]) => {
        const c = readByteFrom(t, o._in);
        if (c < 0) return -1;
        if (o._u16) { const d = readByteFrom(t, o._in); return (c << 8) | Math.max(0, d); }
        if (!o._utf || c < 0x80) return c;
        if ((c & 0xe0) === 0xc0) return ((c & 0x1f) << 6) | (readByteFrom(t, o._in) & 0x3f);
        if ((c & 0xf0) === 0xe0) { const b = readByteFrom(t, o._in), d = readByteFrom(t, o._in); return ((c & 0x0f) << 12) | ((b & 0x3f) << 6) | (d & 0x3f); }
        return c;
      },
      // true only while bytes remain (games loop on `while (reader.ready())`)
      'ready()Z': (t, [o]) => {
        const ins = o._in;
        if (!ins) return 0;
        const m = t.vm.findVirtual(ins, 'available()I');
        const n = m.fn ? m.fn(t, [ins]) : t.vm.invokeSync(m, [ins]);
        return n > 0;
      },
      'close()V': () => {},
    },
  });
  def('java/io/Writer', { methods: { '<init>()V': () => {}, 'write(Ljava/lang/String;)V': () => {}, 'write(I)V': () => {}, 'flush()V': () => {}, 'close()V': () => {} } });
  def('java/io/OutputStreamWriter', {
    super: 'java/io/Writer',
    methods: {
      '<init>(Ljava/io/OutputStream;)V': (t, [o, out]) => { o._out = out; },
      '<init>(Ljava/io/OutputStream;Ljava/lang/String;)V': (t, [o, out]) => { o._out = out; },
      'write(Ljava/lang/String;)V': (t, [o, s]) => writeBytesTo(t, o._out, KP.utf8Encode(s)),
      'write(I)V': (t, [o, c]) => writeBytesTo(t, o._out, KP.utf8Encode(String.fromCharCode(c))),
      'write([CII)V': (t, [o, a, off, len]) => writeBytesTo(t, o._out, KP.utf8Encode(charsToString(a, off, len))),
    },
  });

  KP.readByteFrom = readByteFrom;
  KP.readInto = readInto;
  KP.writeBytesTo = writeBytesTo;
  KP.arrayEnum = arrayEnum;
})(globalThis.KP = globalThis.KP || {});
