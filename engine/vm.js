/* JavaPlay engine – Java bytecode VM: class loading, interpreter, green threads, monitors, exceptions. */
(function (KP) {
  'use strict';

  const ACC_STATIC = 0x0008, ACC_SYNC = 0x0020, ACC_NATIVE = 0x0100, ACC_INTERFACE = 0x0200, ACC_ABSTRACT = 0x0400;

  // ---------- descriptors ----------
  const descCache = new Map();
  function parseDesc(desc) {
    let d = descCache.get(desc);
    if (d) return d;
    const args = [];
    let i = 1;
    while (desc[i] !== ')') {
      const c = desc[i];
      if (c === 'L') { i = desc.indexOf(';', i) + 1; args.push('L'); }
      else if (c === '[') { while (desc[i] === '[') i++; if (desc[i] === 'L') i = desc.indexOf(';', i) + 1; else i++; args.push('L'); }
      else { args.push(c); i++; }
    }
    let ret = desc[i + 1];
    if (ret === '[') ret = 'L';
    let slots = 0;
    for (const a of args) slots += (a === 'J' || a === 'D') ? 2 : 1;
    d = { args, ret, slots };
    descCache.set(desc, d);
    return d;
  }

  function defaultValue(desc) {
    switch (desc[0]) {
      case 'J': return 0n;
      case 'L': case '[': return null;
      default: return 0;
    }
  }

  // ---------- errors ----------
  class JThrow {
    constructor(ex) { this.ex = ex; }
  }

  // ---------- class / method / field ----------
  let fieldCounter = 0;

  class FieldInfo {
    constructor(cls, name, desc, access) {
      this.cls = cls; this.name = name; this.desc = desc; this.access = access;
      this.isStatic = !!(access & ACC_STATIC);
      this.id = 'f' + (++fieldCounter) + '_' + name.replace(/[^A-Za-z0-9_$]/g, '_');
      this.wide = desc === 'J' || desc === 'D';
      this.def = defaultValue(desc);
    }
  }

  class MethodInfo {
    constructor(cls, name, desc, access) {
      this.cls = cls; this.name = name; this.desc = desc; this.key = name + desc; this.access = access;
      this.isStatic = !!(access & ACC_STATIC);
      this.isSync = !!(access & ACC_SYNC);
      this.isAbstract = !!(access & ACC_ABSTRACT);
      const d = parseDesc(desc);
      this.argTypes = d.args;
      this.ret = d.ret;
      this.argSlots = d.slots + (this.isStatic ? 0 : 1);
      this.fn = null; this.isGen = false;
      this.code = null; this.maxLocals = 0; this.handlers = null; this.lines = null;
    }
    toString() { return this.cls.name.replace(/\//g, '.') + '.' + this.name; }
  }

  class ClassInfo {
    constructor(vm, name) {
      this.vm = vm; this.name = name;
      this.superClass = null; this.interfaces = [];
      this.isInterface = false; this.isArray = name[0] === '[';
      this.fields = new Map();     // name:desc -> FieldInfo (declared here)
      this.fieldsByName = new Map(); // name -> FieldInfo (declared here, last wins)
      this.methods = new Map();    // key -> MethodInfo (declared here)
      this.vcache = new Map();
      this.statics = {};
      this.state = 0; this.initThread = null;
      this.cp = null; this.rc = null;
      this.native = null;
      this.ctor = null;
      this.jclass = null;
      this.instanceFields = [];
      this.lenient = false;
    }

    isSubclassOf(other) {
      for (let c = this; c; c = c.superClass) if (c === other) return true;
      return false;
    }

    implementsInterface(iface) {
      for (let c = this; c; c = c.superClass) {
        for (const i of c.interfaces) if (i === iface || i.implementsInterface(iface)) return true;
      }
      return false;
    }

    findMethod(key) {
      for (let c = this; c; c = c.superClass) {
        const m = c.methods.get(key);
        if (m) return m;
      }
      // interfaces (abstract declarations)
      for (let c = this; c; c = c.superClass) for (const i of c.interfaces) { const m = i.findMethod(key); if (m) return m; }
      return null;
    }

    findField(name, desc) {
      for (let c = this; c; c = c.superClass) {
        const f = c.fields.get(name + ':' + desc) || (desc ? null : c.fieldsByName.get(name));
        if (f) return f;
        for (const i of c.interfaces) { const g = i.findField(name, desc); if (g) return g; }
      }
      // tolerate desc mismatch on native classes
      for (let c = this; c; c = c.superClass) { const f = c.fieldsByName.get(name); if (f) return f; }
      return null;
    }

    resolveVirtual(key) {
      let m = this.vcache.get(key);
      if (m) return m;
      for (let c = this; c; c = c.superClass) {
        const x = c.methods.get(key);
        if (x && !x.isAbstract) { m = x; break; }
      }
      if (!m) m = this.findMethod(key); // abstract / interface
      if (m) this.vcache.set(key, m);
      return m;
    }

    buildCtor() {
      const fields = [];
      for (let c = this; c; c = c.superClass) for (const f of c.instanceFields) fields.push(f);
      const body = fields.map((f, i) => 'this.' + f.id + '=' + (f.desc === 'J' ? '0n' : (f.def === null ? 'null' : '0')) + ';').join('');
      // eslint-disable-next-line no-new-func
      const ctor = new Function(body);
      ctor.prototype.__cls = this;
      this.ctor = ctor;
    }
  }

  // ---------- threads ----------
  const RUN = 0, DEAD = 2;
  let threadIds = 0;

  class JThread {
    constructor(vm, name) {
      this.vm = vm; this.id = ++threadIds; this.name = name || ('Thread-' + this.id);
      this.frames = [];
      this.state = RUN;
      this.blocker = null; this.wakeAt = 0;
      this.yieldNow = false;
      this.javaThread = null;
      this.result = undefined;
      this.interrupted = false;
      this.sync = false; // nested synchronous run
    }
    get top() { return this.frames[this.frames.length - 1]; }
  }

  // ---------- monitors ----------
  const primMonitors = new Map();
  function monitorOf(o) {
    if (typeof o === 'object' && o !== null) return o.$mon || (o.$mon = { owner: null, count: 0 });
    let m = primMonitors.get(o);
    if (!m) { m = { owner: null, count: 0 }; primMonitors.set(o, m); }
    return m;
  }
  function tryEnter(t, o) {
    const m = monitorOf(o);
    if (m.owner === null || m.owner === t || m.owner.state === DEAD || t.sync) { m.owner = t; m.count++; return true; }
    return false;
  }
  function exitMon(t, o) {
    const m = monitorOf(o);
    if (m.owner === t || t.sync) { if (--m.count <= 0) { m.count = 0; m.owner = null; } }
  }

  // ---------- VM ----------
  class VM {
    constructor(opts) {
      this.jar = opts.jar;
      this.props = opts.props || {};
      this.sysProps = Object.assign({
        'microedition.platform': 'JavaPlay', 'microedition.encoding': 'ISO-8859-1', 'microedition.configuration': 'CLDC-1.1',
        'microedition.profiles': 'MIDP-2.0', 'microedition.locale': 'en-US', 'microedition.media.version': '1.1',
        'supports.mixing': 'true', 'supports.audio.capture': 'false', 'supports.video.capture': 'false',
        'com.nokia.mid.ui.version': '1.1',
      }, opts.sysProps || {});
      this.log = opts.log || ((s) => console.log(s));
      this.warn = opts.warn || ((s) => console.warn(s));
      this.classes = new Map();
      this.threads = [];
      this.running = false;
      this.timer = null;
      this.idHash = 0;
      this.warned = new Set();
      this.host = opts.host || {};
      this.onError = opts.onError || null;
      this.sliceMs = 10;
      this.stopped = false;
      this.instructionCount = 0;
    }

    // ----- classes -----
    loadClass(name, strict) {
      let c = this.classes.get(name);
      if (c) return c;
      if (name[0] === '[') return this.arrayClass(name);
      const def = KP.natives[name];
      if (def) return this.defineNative(name, def);
      const bytes = this.jar ? this.jar.get(name + '.class') : null;
      if (bytes) return this.defineClass(KP.parseClass(bytes));
      if (strict) return null;
      // unknown platform class (e.g. vendor API): create a lenient stub
      if (!this.warned.has('class:' + name)) { this.warned.add('class:' + name); this.warn('Missing class stubbed: ' + name); }
      return this.defineNative(name, { lenient: true });
    }

    arrayClass(name) {
      let c = this.classes.get(name);
      if (c) return c;
      c = new ClassInfo(this, name);
      c.superClass = this.loadClass('java/lang/Object');
      c.state = 2;
      c.native = {};
      this.classes.set(name, c);
      return c;
    }

    defineNative(name, def) {
      const c = new ClassInfo(this, name);
      this.classes.set(name, c);
      c.native = def;
      c.lenient = !!def.lenient || name.startsWith('com/') || name.startsWith('javax/') || name.startsWith('java/');
      c.isInterface = !!def.isInterface;
      const sup = def.super === undefined ? (name === 'java/lang/Object' ? null : 'java/lang/Object') : def.super;
      if (sup) c.superClass = this.loadClass(sup);
      if (def.interfaces) c.interfaces = def.interfaces.map((i) => this.loadClass(i));
      if (def.statics) {
        for (const k in def.statics) {
          const [desc, value] = def.statics[k];
          const f = new FieldInfo(c, k, desc, ACC_STATIC);
          c.fields.set(k + ':' + desc, f); c.fieldsByName.set(k, f);
          c.statics[f.id] = value;
        }
      }
      if (def.fields) {
        for (const k in def.fields) {
          const f = new FieldInfo(c, k, def.fields[k], 0);
          c.fields.set(k + ':' + def.fields[k], f); c.fieldsByName.set(k, f);
          c.instanceFields.push(f);
        }
      }
      if (def.methods) {
        for (const key in def.methods) {
          const p = key.indexOf('(');
          const mname = key.substring(0, p), desc = key.substring(p);
          const fn = def.methods[key];
          const isStatic = (def.staticMethods && def.staticMethods.indexOf(key) >= 0) || !!fn.isStatic;
          const m = new MethodInfo(c, mname, desc, (isStatic ? ACC_STATIC : 0) | ACC_NATIVE);
          m.fn = fn;
          m.isGen = fn.constructor && fn.constructor.name === 'GeneratorFunction';
          if (name === 'java/lang/String' && mname === '<init>') m.replacesReceiver = true;
          c.methods.set(m.key, m);
        }
      }
      c.buildCtor();
      c.state = 2;
      if (def.clinit) def.clinit(this, c);
      return c;
    }

    defineClass(cf) {
      const c = new ClassInfo(this, cf.name);
      this.classes.set(cf.name, c);
      c.isInterface = !!(cf.access & ACC_INTERFACE);
      c.cp = cf.cp;
      c.rc = new Array(cf.cp.length);
      if (cf.superName) c.superClass = this.loadClass(cf.superName);
      c.interfaces = cf.interfaces.map((i) => this.loadClass(i));
      for (const fd of cf.fields) {
        const f = new FieldInfo(c, fd.name, fd.desc, fd.access);
        c.fields.set(fd.name + ':' + fd.desc, f);
        c.fieldsByName.set(fd.name, f);
        if (f.isStatic) {
          let v = fd.constant !== undefined ? fd.constant : f.def;
          if (fd.desc === 'J' && typeof v !== 'bigint') v = BigInt(v);
          c.statics[f.id] = v;
        } else c.instanceFields.push(f);
      }
      for (const md of cf.methods) {
        const m = new MethodInfo(c, md.name, md.desc, md.access);
        if (md.code) {
          m.code = md.code.code; m.maxLocals = md.code.maxLocals; m.maxStack = md.code.maxStack;
          m.handlers = md.code.handlers; m.lines = md.code.lines;
        } else if (md.access & ACC_NATIVE) {
          m.fn = () => { throw new Error('native method ' + m + ' not available'); };
        }
        c.methods.set(m.key, m);
      }
      c.buildCtor();
      c.state = c.methods.has('<clinit>()V') ? 0 : 1; // 1 = needs only super init
      if (c.state === 1) c.state = 0;
      return c;
    }

    // Ensure class initialized. Returns true if ready; otherwise frames were pushed / thread blocked.
    ensureInit(t, c) {
      if (c.state === 2) return true;
      if (c.state === 1) {
        if (c.initThread === t) return true;
        t.blocker = () => c.state === 1; t.wakeAt = 0;
        return false;
      }
      c.state = 1; c.initThread = t;
      const vm = this;
      const clinit = c.methods.get('<clinit>()V');
      const initGen = {
        cls: c, name: '<init-wrapper>', ret: 'V', isSync: false, isStatic: true, toString() { return c.name + '.<clinit>'; },
      };
      const gen = (function* () {
        try {
          if (clinit) yield { invoke: clinit, args: [] };
        } catch (e) {
          c.state = 3;
          throw e;
        }
        c.state = 2; c.initThread = null;
      })();
      t.frames.push({ gen, m: initGen, last: undefined, pendingThrow: null });
      if (c.superClass && c.superClass.state !== 2) this.ensureInit(t, c.superClass);
      void vm;
      return false;
    }

    classOf(v) {
      if (typeof v === 'string') return this.loadClass('java/lang/String');
      if (v.__cls) return v.__cls;
      if (v.$t) return this.arrayClass(v.$t);
      return this.loadClass('java/lang/Object');
    }

    isAssignable(from, to) {
      if (from === to) return true;
      if (to.name === 'java/lang/Object') return true;
      if (from.isArray) {
        if (!to.isArray) return false;
        const fc = from.name.substring(1), tc = to.name.substring(1);
        if (fc === tc) return true;
        if (fc[0] === 'L' && tc[0] === 'L') return this.isAssignable(this.loadClass(fc.slice(1, -1)), this.loadClass(tc.slice(1, -1)));
        if (fc[0] === '[' && tc[0] === '[') return this.isAssignable(this.arrayClass(fc), this.arrayClass(tc));
        if (fc[0] === '[' && tc === 'Ljava/lang/Object;') return true;
        return false;
      }
      if (to.isInterface) return from.implementsInterface(to);
      return from.isSubclassOf(to);
    }

    isInstance(v, cls) {
      if (v === null || v === undefined) return false;
      return this.isAssignable(this.classOf(v), cls);
    }

    newObject(cls) {
      if (typeof cls === 'string') cls = this.loadClass(cls);
      return new cls.ctor();
    }

    newArray(type, n) {
      // type: element descriptor ('I', 'B', 'Ljava/lang/String;', '[I'...)
      if (n < 0) this.throwNew('java/lang/NegativeArraySizeException', String(n));
      let a;
      switch (type) {
        case 'Z': case 'B': a = new Int8Array(n); break;
        case 'C': a = new Uint16Array(n); break;
        case 'S': a = new Int16Array(n); break;
        case 'I': a = new Int32Array(n); break;
        case 'F': a = new Float32Array(n); break;
        case 'D': a = new Float64Array(n); break;
        case 'J': a = new BigInt64Array(n); break;
        default: a = new Array(n).fill(null);
      }
      a.$t = '[' + type;
      return a;
    }

    newMultiArray(desc, dims, d) {
      d = d || 0;
      const elem = desc.substring(1);
      const a = this.newArray(elem, dims[d]);
      if (d + 1 < dims.length) for (let i = 0; i < a.length; i++) a[i] = this.newMultiArray(elem, dims, d + 1);
      return a;
    }

    jclass(c) {
      if (!c.jclass) {
        const o = this.newObject('java/lang/Class');
        o._cls = c;
        c.jclass = o;
      }
      return c.jclass;
    }

    identityHash(o) {
      if (typeof o === 'string') return KP.stringHash(o);
      if (o.$h === undefined) o.$h = (++this.idHash * 0x9E3779B1) & 0x7fffffff;
      return o.$h;
    }

    // Create and throw a Java exception
    newThrowable(name, msg) {
      const ex = this.newObject(this.loadClass(name));
      ex._msg = msg === undefined ? null : msg;
      return ex;
    }
    throwNew(name, msg) { throw new JThrow(this.newThrowable(name, msg)); }

    findVirtual(obj, key) {
      return this.classOf(obj).resolveVirtual(key);
    }

    warnOnce(key, msg) {
      if (this.warned.has(key)) return;
      this.warned.add(key);
      this.warn(msg);
    }

    // ----- invocation helpers -----
    // push a frame (or run native) with logical args
    pushInvoke(t, m, args) {
      if (m.fn) {
        if (m.isGen) { t.frames.push({ gen: m.fn(t, args), m, last: undefined, pendingThrow: null }); return; }
        const r = m.fn(t, args);
        this.deliverReturn(t, m, r);
        return;
      }
      if (!m.code) {
        if (m.isAbstract) this.throwNew('java/lang/AbstractMethodError', String(m));
        this.deliverReturn(t, m, defaultValue(m.ret));
        return;
      }
      const l = new Array(m.maxLocals);
      let k = 0;
      if (!m.isStatic) l[k++] = args[0];
      const types = m.argTypes;
      for (let i = 0; i < types.length; i++) {
        l[k++] = args[i + (m.isStatic ? 0 : 1)];
        if (types[i] === 'J' || types[i] === 'D') l[k++] = undefined;
      }
      const f = { m, cls: m.cls, code: m.code, pc: 0, l, s: new Array(m.maxStack + 2), sp: 0, inCall: false, lock: null };
      if (m.isSync) {
        const lockObj = m.isStatic ? this.jclass(m.cls) : args[0];
        if (!tryEnter(t, lockObj)) {
          // block until available, then retry by a tiny generator
          const vm = this;
          t.frames.push({
            gen: (function* () {
              yield { block: () => !tryEnterCheck(t, lockObj) };
              return yield { invoke: m, args };
            })(), m: { cls: m.cls, name: '<sync-wait>', ret: m.ret, toString() { return String(m); } }, last: undefined, pendingThrow: null,
          });
          void vm;
          return;
        }
        f.lock = lockObj;
      }
      t.frames.push(f);
    }

    deliverReturn(t, m, r) {
      const ret = m.ret;
      if (ret === 'Z') r = r ? 1 : 0;
      else if (ret === 'J') { if (typeof r !== 'bigint') r = BigInt(Math.trunc(r || 0)); }
      else if (ret === 'I' || ret === 'B' || ret === 'S' || ret === 'C') r = r | 0;
      else if (ret === 'L' && r === undefined) r = null;
      const caller = t.top;
      if (!caller) { t.result = r; return; }
      if (caller.gen) { caller.last = r; return; }
      if (ret === 'V') return;
      caller.s[caller.sp++] = r;
      if (ret === 'J' || ret === 'D') caller.s[caller.sp++] = undefined;
    }

    // ----- threads -----
    newThread(name) {
      const t = new JThread(this, name);
      this.threads.push(t);
      return t;
    }

    startThread(t) {
      if (!this.threads.includes(t)) this.threads.push(t);
      this.schedule();
    }

    // Spawn a VM thread running a JS generator (used by the event dispatcher)
    spawnGenerator(name, genFn) {
      const t = this.newThread(name);
      const m = { cls: null, name, ret: 'V', isSync: false, toString() { return name; } };
      t.frames.push({ gen: genFn(t), m, last: undefined, pendingThrow: null });
      this.schedule();
      return t;
    }

    // Run a method synchronously to completion (used by natives needing a quick Java callback)
    invokeSync(m, args) {
      const t = new JThread(this, 'sync');
      t.sync = true;
      this.pushInvoke(t, m, args);
      let guard = 0;
      while (t.frames.length) {
        t.blocker = null; t.yieldNow = false;
        this.execute(t, 100000);
        if (++guard > 2000) throw new Error('invokeSync did not finish: ' + m);
      }
      if (t.uncaught) throw new JThrow(t.uncaught);
      return t.result;
    }

    schedule() {
      if (this.stopped || this.timer !== null) return;
      this.timer = setTimeout(() => { this.timer = null; this.tick(); }, 0);
    }

    wakeup() {
      if (this.stopped) return;
      if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
      this.schedule();
    }

    tick() {
      if (this.stopped) return;
      const start = KP.now();
      let ranAny = true;
      while (ranAny && KP.now() - start < this.sliceMs) {
        ranAny = false;
        for (let i = 0; i < this.threads.length; i++) {
          const t = this.threads[i];
          if (t.state === DEAD) continue;
          if (t.blocker) {
            if (t.blocker() && !(t.wakeAt && KP.now() >= t.wakeAt)) continue;
            t.blocker = null; t.wakeAt = 0;
          }
          t.yieldNow = false;
          this.execute(t, 20000);
          ranAny = true;
          if (!t.frames.length) t.state = DEAD;
        }
        this.threads = this.threads.filter((t) => t.state !== DEAD);
      }
      if (!this.threads.length) return;
      // compute next wake
      let next = Infinity, runnable = false;
      const now = KP.now();
      for (const t of this.threads) {
        if (!t.blocker) { runnable = true; break; }
        if (!t.blocker()) { runnable = true; break; }
        if (t.wakeAt) next = Math.min(next, t.wakeAt);
      }
      if (runnable) this.schedule();
      else if (next !== Infinity) this.timer = setTimeout(() => { this.timer = null; this.tick(); }, Math.max(0, Math.min(next - now, 1000)));
      else this.timer = setTimeout(() => { this.timer = null; this.tick(); }, 50); // poll for external events
    }

    stop() {
      this.stopped = true;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.threads = [];
    }

    // ----- execution -----
    execute(t, budget) {
      while (t.frames.length && !t.blocker && !t.yieldNow && budget > 0) {
        const f = t.top;
        try {
          if (f.gen) { this.stepGen(t, f, false); budget -= 20; }
          else budget = this.interp(t, f, budget);
        } catch (e) {
          this.handleError(t, e);
        }
      }
    }

    stepGen(t, f, unused) {
      let r;
      try {
        if (f.pendingThrow) { const p = f.pendingThrow; f.pendingThrow = null; r = f.gen.throw(p); }
        else { const v = f.last; f.last = undefined; r = f.gen.next(v); }
      } catch (e) {
        t.frames.pop();
        throw e;
      }
      if (r.done) {
        t.frames.pop();
        this.deliverReturn(t, f.m, r.value);
        return;
      }
      const req = r.value;
      if (!req) { t.yieldNow = true; return; }
      if (req.invoke) this.pushInvoke(t, req.invoke, req.args);
      else if (req.block) {
        if (t.sync) return; // synchronous runs never block
        t.blocker = req.block; t.wakeAt = req.wake || 0;
      } else if (req.yieldNow) t.yieldNow = true;
    }

    handleError(t, e) {
      let jt = e;
      if (!(e instanceof JThrow)) {
        // JS error inside engine/native: surface as Java exception
        let name = 'java/lang/RuntimeException';
        const msg = e && e.message ? e.message : String(e);
        if (e instanceof TypeError && /null|undefined/.test(msg)) name = 'java/lang/NullPointerException';
        if (e instanceof RangeError && /Invalid array length/.test(msg)) name = 'java/lang/OutOfMemoryError';
        if (!(e && e.__reported)) { this.warn('Engine error in ' + this.where(t) + ': ' + msg + (e && e.stack ? '\n' + e.stack.split('\n').slice(0, 4).join('\n') : '')); }
        jt = new JThrow(this.newThrowable(name, msg));
      }
      const ex = jt.ex;
      if (!ex._trace) ex._trace = this.stackTrace(t);
      while (t.frames.length) {
        const f = t.top;
        if (f.gen) { f.pendingThrow = jt; return; }
        const pc = f.inCall ? f.pc - 1 : f.pc;
        const hs = f.m.handlers;
        if (hs) {
          for (let i = 0; i < hs.length; i++) {
            const h = hs[i];
            if (pc < h.start || pc >= h.end) continue;
            if (h.catchType) {
              const cc = this.loadClass(h.catchType, true);
              if (!cc || !this.isInstance(ex, cc)) continue;
            }
            f.sp = 0; f.s[f.sp++] = ex; f.pc = h.handler; f.inCall = false;
            return;
          }
        }
        if (f.lock !== null && f.lock !== undefined) exitMon(t, f.lock);
        t.frames.pop();
      }
      // uncaught
      t.uncaught = ex;
      const cname = this.classOf(ex).name.replace(/\//g, '.');
      const msg = cname + (ex._msg ? ': ' + ex._msg : '');
      this.warn('Uncaught ' + msg + '\n    at ' + (ex._trace || []).join('\n    at '));
      if (this.onError && !t.sync) this.onError(msg, ex);
    }

    stackTrace(t) {
      const out = [];
      for (let i = t.frames.length - 1; i >= 0 && out.length < 12; i--) {
        const f = t.frames[i];
        let line = '';
        if (f.m && f.m.lines && f.m.lines.length) {
          const pc = f.inCall ? f.pc - 1 : f.pc;
          for (const [s, l] of f.m.lines) if (s <= pc) line = ':' + l;
        }
        out.push((f.m ? String(f.m) : '?') + (f.gen ? '' : '(pc ' + f.pc + line + ')'));
      }
      return out;
    }

    where(t) { const f = t.top; return f && f.m ? String(f.m) : '?'; }

    // ----- constant pool resolution -----
    resolveClassRef(cls, idx) {
      let r = cls.rc[idx];
      if (r) return r;
      const name = cls.cp[idx].name;
      r = name[0] === '[' ? this.arrayClass(name) : this.loadClass(name);
      cls.rc[idx] = r;
      return r;
    }

    resolveFieldRef(cls, idx) {
      let r = cls.rc[idx];
      if (r) return r;
      const e = cls.cp[idx];
      const owner = this.loadClass(e.className);
      let f = owner.findField(e.name, e.desc);
      if (!f) {
        // unknown field on a stubbed/native class: create it lazily
        this.warnOnce('field:' + e.className + '.' + e.name, 'Missing field ' + e.className + '.' + e.name + ' ' + e.desc);
        f = new FieldInfo(owner, e.name, e.desc, 0);
        owner.fields.set(e.name + ':' + e.desc, f); owner.fieldsByName.set(e.name, f);
        f.isStatic = true; owner.statics[f.id] = f.def;
      }
      cls.rc[idx] = f;
      return f;
    }

    resolveMethodRef(cls, idx) {
      let r = cls.rc[idx];
      if (r) return r;
      const e = cls.cp[idx];
      const d = parseDesc(e.desc);
      r = { className: e.className, name: e.name, desc: e.desc, key: e.name + e.desc, ret: d.ret, argTypes: d.args, slots: d.slots, method: null, owner: null };
      cls.rc[idx] = r;
      return r;
    }

    // resolve static/special target
    resolveDirect(ref) {
      if (ref.method) return ref.method;
      const owner = this.loadClass(ref.className);
      ref.owner = owner;
      let m = owner.findMethod(ref.key);
      if (!m) m = this.missingMethod(owner, ref, ref.name === '<init>' ? false : null);
      ref.method = m;
      return m;
    }

    missingMethod(owner, ref, isStatic) {
      this.warnOnce('method:' + owner.name + '.' + ref.key, 'Missing method ' + owner.name.replace(/\//g, '.') + '.' + ref.name + ref.desc + ' (returns default)');
      const m = new MethodInfo(owner, ref.name, ref.desc, (isStatic ? ACC_STATIC : 0) | ACC_NATIVE);
      const dv = defaultValue(m.ret);
      m.fn = () => dv;
      owner.methods.set(m.key, m);
      owner.vcache.clear();
      return m;
    }

    ldc(cls, idx) {
      let r = cls.rc[idx];
      if (r !== undefined) return r;
      const e = cls.cp[idx];
      if (e.tag === 7) r = this.jclass(this.resolveClassRef(cls, idx));
      else r = e.value;
      if (e.tag !== 7) cls.rc[idx] = r;
      return r;
    }

    // ----- the interpreter -----
    interp(t, f, budget) {
      const vm = this;
      const code = f.code;
      const l = f.l, s = f.s;
      const cls = f.cls;
      let pc = f.pc, sp = f.sp;
      f.inCall = false;

      const npe = () => vm.throwNew('java/lang/NullPointerException');
      const aioobe = (i) => vm.throwNew('java/lang/ArrayIndexOutOfBoundsException', String(i));

      try {
        for (;;) {
          if (--budget <= 0) { f.pc = pc; f.sp = sp; return 0; }
          f.pc = pc;
          const op = code[pc];
          switch (op) {
            case 0x00: pc++; break;
            case 0x01: s[sp++] = null; pc++; break;
            case 0x02: case 0x03: case 0x04: case 0x05: case 0x06: case 0x07: case 0x08:
              s[sp++] = op - 3; pc++; break;
            case 0x09: s[sp++] = 0n; s[sp++] = undefined; pc++; break;
            case 0x0a: s[sp++] = 1n; s[sp++] = undefined; pc++; break;
            case 0x0b: s[sp++] = 0; pc++; break;
            case 0x0c: s[sp++] = 1; pc++; break;
            case 0x0d: s[sp++] = 2; pc++; break;
            case 0x0e: s[sp++] = 0; s[sp++] = undefined; pc++; break;
            case 0x0f: s[sp++] = 1; s[sp++] = undefined; pc++; break;
            case 0x10: s[sp++] = (code[pc + 1] << 24) >> 24; pc += 2; break;
            case 0x11: s[sp++] = ((code[pc + 1] << 24) >> 16) | code[pc + 2]; pc += 3; break;
            case 0x12: s[sp++] = vm.ldc(cls, code[pc + 1]); pc += 2; break;
            case 0x13: s[sp++] = vm.ldc(cls, (code[pc + 1] << 8) | code[pc + 2]); pc += 3; break;
            case 0x14: s[sp++] = cls.cp[(code[pc + 1] << 8) | code[pc + 2]].value; s[sp++] = undefined; pc += 3; break;
            case 0x15: case 0x17: case 0x19: s[sp++] = l[code[pc + 1]]; pc += 2; break;
            case 0x16: case 0x18: s[sp++] = l[code[pc + 1]]; s[sp++] = undefined; pc += 2; break;
            case 0x1a: case 0x1b: case 0x1c: case 0x1d: s[sp++] = l[op - 0x1a]; pc++; break;
            case 0x1e: case 0x1f: case 0x20: case 0x21: s[sp++] = l[op - 0x1e]; s[sp++] = undefined; pc++; break;
            case 0x22: case 0x23: case 0x24: case 0x25: s[sp++] = l[op - 0x22]; pc++; break;
            case 0x26: case 0x27: case 0x28: case 0x29: s[sp++] = l[op - 0x26]; s[sp++] = undefined; pc++; break;
            case 0x2a: case 0x2b: case 0x2c: case 0x2d: s[sp++] = l[op - 0x2a]; pc++; break;
            // array loads
            case 0x2e: case 0x30: case 0x32: case 0x33: case 0x34: case 0x35: {
              const i = s[--sp], a = s[--sp];
              if (a === null) npe();
              if (i < 0 || i >= a.length) aioobe(i);
              s[sp++] = a[i]; pc++; break;
            }
            case 0x2f: case 0x31: {
              const i = s[--sp], a = s[--sp];
              if (a === null) npe();
              if (i < 0 || i >= a.length) aioobe(i);
              s[sp++] = a[i]; s[sp++] = undefined; pc++; break;
            }
            // stores
            case 0x36: case 0x38: case 0x3a: l[code[pc + 1]] = s[--sp]; pc += 2; break;
            case 0x37: case 0x39: sp--; l[code[pc + 1]] = s[--sp]; pc += 2; break;
            case 0x3b: case 0x3c: case 0x3d: case 0x3e: l[op - 0x3b] = s[--sp]; pc++; break;
            case 0x3f: case 0x40: case 0x41: case 0x42: sp--; l[op - 0x3f] = s[--sp]; pc++; break;
            case 0x43: case 0x44: case 0x45: case 0x46: l[op - 0x43] = s[--sp]; pc++; break;
            case 0x47: case 0x48: case 0x49: case 0x4a: sp--; l[op - 0x47] = s[--sp]; pc++; break;
            case 0x4b: case 0x4c: case 0x4d: case 0x4e: l[op - 0x4b] = s[--sp]; pc++; break;
            // array stores
            case 0x4f: case 0x51: case 0x53: case 0x54: case 0x55: case 0x56: {
              const v = s[--sp], i = s[--sp], a = s[--sp];
              if (a === null) npe();
              if (i < 0 || i >= a.length) aioobe(i);
              a[i] = v; pc++; break;
            }
            case 0x50: case 0x52: {
              sp--; const v = s[--sp], i = s[--sp], a = s[--sp];
              if (a === null) npe();
              if (i < 0 || i >= a.length) aioobe(i);
              a[i] = v; pc++; break;
            }
            // stack
            case 0x57: sp--; pc++; break;
            case 0x58: sp -= 2; pc++; break;
            case 0x59: s[sp] = s[sp - 1]; sp++; pc++; break;
            case 0x5a: { const v1 = s[sp - 1], v2 = s[sp - 2]; s[sp - 2] = v1; s[sp - 1] = v2; s[sp] = v1; sp++; pc++; break; }
            case 0x5b: { const v1 = s[sp - 1], v2 = s[sp - 2], v3 = s[sp - 3]; s[sp - 3] = v1; s[sp - 2] = v3; s[sp - 1] = v2; s[sp] = v1; sp++; pc++; break; }
            case 0x5c: s[sp] = s[sp - 2]; s[sp + 1] = s[sp - 1]; sp += 2; pc++; break;
            case 0x5d: { const v1 = s[sp - 1], v2 = s[sp - 2], v3 = s[sp - 3]; s[sp - 3] = v2; s[sp - 2] = v1; s[sp - 1] = v3; s[sp] = v2; s[sp + 1] = v1; sp += 2; pc++; break; }
            case 0x5e: { const v1 = s[sp - 1], v2 = s[sp - 2], v3 = s[sp - 3], v4 = s[sp - 4]; s[sp - 4] = v2; s[sp - 3] = v1; s[sp - 2] = v4; s[sp - 1] = v3; s[sp] = v2; s[sp + 1] = v1; sp += 2; pc++; break; }
            case 0x5f: { const v = s[sp - 1]; s[sp - 1] = s[sp - 2]; s[sp - 2] = v; pc++; break; }
            // arithmetic
            case 0x60: { const b = s[--sp]; s[sp - 1] = (s[sp - 1] + b) | 0; pc++; break; }
            case 0x61: { sp--; const b = s[--sp]; s[sp - 2] = BigInt.asIntN(64, s[sp - 2] + b); pc++; break; }
            case 0x62: { const b = s[--sp]; s[sp - 1] = Math.fround(s[sp - 1] + b); pc++; break; }
            case 0x63: { sp--; const b = s[--sp]; s[sp - 2] = s[sp - 2] + b; pc++; break; }
            case 0x64: { const b = s[--sp]; s[sp - 1] = (s[sp - 1] - b) | 0; pc++; break; }
            case 0x65: { sp--; const b = s[--sp]; s[sp - 2] = BigInt.asIntN(64, s[sp - 2] - b); pc++; break; }
            case 0x66: { const b = s[--sp]; s[sp - 1] = Math.fround(s[sp - 1] - b); pc++; break; }
            case 0x67: { sp--; const b = s[--sp]; s[sp - 2] = s[sp - 2] - b; pc++; break; }
            case 0x68: { const b = s[--sp]; s[sp - 1] = Math.imul(s[sp - 1], b); pc++; break; }
            case 0x69: { sp--; const b = s[--sp]; s[sp - 2] = BigInt.asIntN(64, s[sp - 2] * b); pc++; break; }
            case 0x6a: { const b = s[--sp]; s[sp - 1] = Math.fround(s[sp - 1] * b); pc++; break; }
            case 0x6b: { sp--; const b = s[--sp]; s[sp - 2] = s[sp - 2] * b; pc++; break; }
            case 0x6c: { const b = s[--sp]; if (b === 0) vm.throwNew('java/lang/ArithmeticException', '/ by zero'); s[sp - 1] = (s[sp - 1] / b) | 0; pc++; break; }
            case 0x6d: { sp--; const b = s[--sp]; if (b === 0n) vm.throwNew('java/lang/ArithmeticException', '/ by zero'); s[sp - 2] = BigInt.asIntN(64, s[sp - 2] / b); pc++; break; }
            case 0x6e: { const b = s[--sp]; s[sp - 1] = Math.fround(s[sp - 1] / b); pc++; break; }
            case 0x6f: { sp--; const b = s[--sp]; s[sp - 2] = s[sp - 2] / b; pc++; break; }
            case 0x70: { const b = s[--sp]; if (b === 0) vm.throwNew('java/lang/ArithmeticException', '/ by zero'); s[sp - 1] = (s[sp - 1] % b) | 0; pc++; break; }
            case 0x71: { sp--; const b = s[--sp]; if (b === 0n) vm.throwNew('java/lang/ArithmeticException', '/ by zero'); s[sp - 2] = BigInt.asIntN(64, s[sp - 2] % b); pc++; break; }
            case 0x72: { const b = s[--sp]; s[sp - 1] = Math.fround(s[sp - 1] % b); pc++; break; }
            case 0x73: { sp--; const b = s[--sp]; s[sp - 2] = s[sp - 2] % b; pc++; break; }
            case 0x74: s[sp - 1] = (-s[sp - 1]) | 0; pc++; break;
            case 0x75: s[sp - 2] = BigInt.asIntN(64, -s[sp - 2]); pc++; break;
            case 0x76: s[sp - 1] = -s[sp - 1]; pc++; break;
            case 0x77: s[sp - 2] = -s[sp - 2]; pc++; break;
            case 0x78: { const b = s[--sp]; s[sp - 1] = s[sp - 1] << (b & 31); pc++; break; }
            case 0x79: { const b = s[--sp]; s[sp - 2] = BigInt.asIntN(64, s[sp - 2] << BigInt(b & 63)); pc++; break; }
            case 0x7a: { const b = s[--sp]; s[sp - 1] = s[sp - 1] >> (b & 31); pc++; break; }
            case 0x7b: { const b = s[--sp]; s[sp - 2] = s[sp - 2] >> BigInt(b & 63); pc++; break; }
            case 0x7c: { const b = s[--sp]; s[sp - 1] = (s[sp - 1] >>> (b & 31)) | 0; pc++; break; }
            case 0x7d: { const b = s[--sp]; s[sp - 2] = BigInt.asIntN(64, BigInt.asUintN(64, s[sp - 2]) >> BigInt(b & 63)); pc++; break; }
            case 0x7e: { const b = s[--sp]; s[sp - 1] &= b; pc++; break; }
            case 0x7f: { sp--; const b = s[--sp]; s[sp - 2] = s[sp - 2] & b; pc++; break; }
            case 0x80: { const b = s[--sp]; s[sp - 1] |= b; pc++; break; }
            case 0x81: { sp--; const b = s[--sp]; s[sp - 2] = s[sp - 2] | b; pc++; break; }
            case 0x82: { const b = s[--sp]; s[sp - 1] ^= b; pc++; break; }
            case 0x83: { sp--; const b = s[--sp]; s[sp - 2] = s[sp - 2] ^ b; pc++; break; }
            case 0x84: { const i = code[pc + 1]; l[i] = (l[i] + ((code[pc + 2] << 24) >> 24)) | 0; pc += 3; break; }
            // conversions
            case 0x85: s[sp - 1] = BigInt(s[sp - 1]); s[sp++] = undefined; pc++; break;
            case 0x86: s[sp - 1] = Math.fround(s[sp - 1]); pc++; break;
            case 0x87: s[sp++] = undefined; pc++; break;
            case 0x88: sp--; s[sp - 1] = Number(BigInt.asIntN(32, s[sp - 1])); pc++; break;
            case 0x89: sp--; s[sp - 1] = Math.fround(Number(s[sp - 1])); pc++; break;
            case 0x8a: s[sp - 2] = Number(s[sp - 2]); pc++; break;
            case 0x8b: s[sp - 1] = f2i(s[sp - 1]); pc++; break;
            case 0x8c: s[sp - 1] = f2l(s[sp - 1]); s[sp++] = undefined; pc++; break;
            case 0x8d: s[sp++] = undefined; pc++; break;
            case 0x8e: sp--; s[sp - 1] = f2i(s[sp - 1]); pc++; break;
            case 0x8f: s[sp - 2] = f2l(s[sp - 2]); pc++; break;
            case 0x90: sp--; s[sp - 1] = Math.fround(s[sp - 1]); pc++; break;
            case 0x91: s[sp - 1] = (s[sp - 1] << 24) >> 24; pc++; break;
            case 0x92: s[sp - 1] = s[sp - 1] & 0xffff; pc++; break;
            case 0x93: s[sp - 1] = (s[sp - 1] << 16) >> 16; pc++; break;
            // comparisons
            case 0x94: { sp--; const b = s[--sp]; sp--; const a = s[--sp]; s[sp++] = a < b ? -1 : a > b ? 1 : 0; pc++; break; }
            case 0x95: case 0x96: { const b = s[--sp], a = s[--sp]; s[sp++] = a > b ? 1 : a === b ? 0 : a < b ? -1 : (op === 0x96 ? 1 : -1); pc++; break; }
            case 0x97: case 0x98: { sp--; const b = s[--sp]; sp--; const a = s[--sp]; s[sp++] = a > b ? 1 : a === b ? 0 : a < b ? -1 : (op === 0x98 ? 1 : -1); pc++; break; }
            case 0x99: pc = s[--sp] === 0 ? pc + br16(code, pc) : pc + 3; break;
            case 0x9a: pc = s[--sp] !== 0 ? pc + br16(code, pc) : pc + 3; break;
            case 0x9b: pc = s[--sp] < 0 ? pc + br16(code, pc) : pc + 3; break;
            case 0x9c: pc = s[--sp] >= 0 ? pc + br16(code, pc) : pc + 3; break;
            case 0x9d: pc = s[--sp] > 0 ? pc + br16(code, pc) : pc + 3; break;
            case 0x9e: pc = s[--sp] <= 0 ? pc + br16(code, pc) : pc + 3; break;
            case 0x9f: { const b = s[--sp], a = s[--sp]; pc = a === b ? pc + br16(code, pc) : pc + 3; break; }
            case 0xa0: { const b = s[--sp], a = s[--sp]; pc = a !== b ? pc + br16(code, pc) : pc + 3; break; }
            case 0xa1: { const b = s[--sp], a = s[--sp]; pc = a < b ? pc + br16(code, pc) : pc + 3; break; }
            case 0xa2: { const b = s[--sp], a = s[--sp]; pc = a >= b ? pc + br16(code, pc) : pc + 3; break; }
            case 0xa3: { const b = s[--sp], a = s[--sp]; pc = a > b ? pc + br16(code, pc) : pc + 3; break; }
            case 0xa4: { const b = s[--sp], a = s[--sp]; pc = a <= b ? pc + br16(code, pc) : pc + 3; break; }
            case 0xa5: { const b = s[--sp], a = s[--sp]; pc = a === b ? pc + br16(code, pc) : pc + 3; break; }
            case 0xa6: { const b = s[--sp], a = s[--sp]; pc = a !== b ? pc + br16(code, pc) : pc + 3; break; }
            case 0xa7: pc += br16(code, pc); break;
            case 0xa8: s[sp++] = pc + 3; pc += br16(code, pc); break;
            case 0xa9: pc = l[code[pc + 1]]; break;
            case 0xaa: {
              const base = pc;
              let q = (pc + 4) & ~3;
              const def = rd32(code, q), lo = rd32(code, q + 4), hi = rd32(code, q + 8);
              const k = s[--sp];
              pc = base + ((k < lo || k > hi) ? def : rd32(code, q + 12 + (k - lo) * 4));
              break;
            }
            case 0xab: {
              const base = pc;
              let q = (pc + 4) & ~3;
              const def = rd32(code, q), n = rd32(code, q + 4);
              const k = s[--sp];
              let target = def;
              // binary search
              let lo = 0, hi = n - 1;
              while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const mk = rd32(code, q + 8 + mid * 8);
                if (mk === k) { target = rd32(code, q + 12 + mid * 8); break; }
                if (mk < k) lo = mid + 1; else hi = mid - 1;
              }
              pc = base + target;
              break;
            }
            // returns
            case 0xac: case 0xae: case 0xb0: case 0xad: case 0xaf: case 0xb1: {
              let rv;
              if (op === 0xad || op === 0xaf) { sp--; rv = s[--sp]; }
              else if (op !== 0xb1) rv = s[--sp];
              if (f.lock !== null && f.lock !== undefined) exitMon(t, f.lock);
              t.frames.pop();
              const caller = t.top;
              if (!caller) { t.result = rv; return budget; }
              if (caller.gen) { caller.last = rv; return budget; }
              if (op !== 0xb1) {
                caller.s[caller.sp++] = rv;
                if (op === 0xad || op === 0xaf) caller.s[caller.sp++] = undefined;
              }
              return budget;
            }
            // fields
            case 0xb2: {
              const fi = vm.resolveFieldRef(cls, (code[pc + 1] << 8) | code[pc + 2]);
              if (fi.cls.state !== 2 && !vm.ensureInit(t, fi.cls)) { f.sp = sp; return budget; }
              let v = fi.cls.statics[fi.id];
              if (v === undefined) v = fi.def;
              s[sp++] = v; if (fi.wide) s[sp++] = undefined;
              pc += 3; break;
            }
            case 0xb3: {
              const fi = vm.resolveFieldRef(cls, (code[pc + 1] << 8) | code[pc + 2]);
              if (fi.cls.state !== 2 && !vm.ensureInit(t, fi.cls)) { f.sp = sp; return budget; }
              if (fi.wide) sp--;
              fi.cls.statics[fi.id] = s[--sp];
              pc += 3; break;
            }
            case 0xb4: {
              const fi = vm.resolveFieldRef(cls, (code[pc + 1] << 8) | code[pc + 2]);
              const o = s[sp - 1];
              if (o === null) npe();
              let v = o[fi.id];
              if (v === undefined) v = fi.def;
              s[sp - 1] = v; if (fi.wide) s[sp++] = undefined;
              pc += 3; break;
            }
            case 0xb5: {
              const fi = vm.resolveFieldRef(cls, (code[pc + 1] << 8) | code[pc + 2]);
              if (fi.wide) sp--;
              const v = s[--sp], o = s[--sp];
              if (o === null) npe();
              o[fi.id] = v;
              pc += 3; break;
            }
            // invocations
            case 0xb6: case 0xb7: case 0xb8: case 0xb9: {
              const ref = vm.resolveMethodRef(cls, (code[pc + 1] << 8) | code[pc + 2]);
              const next = pc + (op === 0xb9 ? 5 : 3);
              let m;
              const isStatic = op === 0xb8;
              const nslots = ref.slots + (isStatic ? 0 : 1);
              if (isStatic) {
                m = ref.method || vm.resolveDirect(ref);
                if (m.cls.state !== 2 && !vm.ensureInit(t, m.cls)) { f.sp = sp; return budget; }
              } else {
                const recv = s[sp - nslots];
                if (recv === null || recv === undefined) npe();
                if (op === 0xb7) m = ref.method || vm.resolveDirect(ref);
                else {
                  const rc = typeof recv === 'string' ? vm.loadClass('java/lang/String') : (recv.__cls || vm.classOf(recv));
                  m = rc.vcache.get(ref.key) || rc.resolveVirtual(ref.key) || vm.missingMethod(rc, ref, false);
                }
              }
              // gather args
              const base = sp - nslots;
              if (m.fn) {
                const args = [];
                let k = base;
                if (!isStatic) args.push(s[k++]);
                const at = ref.argTypes;
                for (let i = 0; i < at.length; i++) { args.push(s[k++]); if (at[i] === 'J' || at[i] === 'D') k++; }
                sp = base;
                f.pc = next; f.sp = sp; f.inCall = true;
                if (m.isGen) { t.frames.push({ gen: m.fn(t, args), m, last: undefined, pendingThrow: null }); return budget; }
                const r = m.fn(t, args);
                f.inCall = false;
                if (m.replacesReceiver) {
                  // new String(...): swap the placeholder object for the JS string everywhere in this frame
                  const ph = args[0];
                  for (let i = 0; i < sp; i++) if (s[i] === ph) s[i] = r;
                  for (let i = 0; i < l.length; i++) if (l[i] === ph) l[i] = r;
                  pc = next;
                  break;
                }
                if (t.top !== f) { return budget; } // native pushed frames (e.g. clinit)
                const ret = m.ret;
                if (ret !== 'V') {
                  let v = r;
                  if (ret === 'Z') v = r ? 1 : 0;
                  else if (ret === 'I' || ret === 'B' || ret === 'S' || ret === 'C') v = r | 0;
                  else if (ret === 'J') { if (typeof v !== 'bigint') v = BigInt(Math.trunc(v || 0)); }
                  else if (ret === 'L' && v === undefined) v = null;
                  s[sp++] = v;
                  if (ret === 'J' || ret === 'D') s[sp++] = undefined;
                }
                pc = next;
                if (t.blocker || t.yieldNow) { f.pc = pc; f.sp = sp; return budget; }
                break;
              }
              if (!m.code) {
                if (m.isAbstract) vm.throwNew('java/lang/AbstractMethodError', String(m));
                sp = base; pc = next;
                if (m.ret !== 'V') { s[sp++] = defaultValue(m.ret); if (m.ret === 'J' || m.ret === 'D') s[sp++] = undefined; }
                break;
              }
              let lock = null;
              if (m.isSync) {
                lock = m.isStatic ? vm.jclass(m.cls) : s[base];
                if (!tryEnter(t, lock)) {
                  t.blocker = () => !tryEnterCheck(t, lock);
                  f.sp = sp; return budget; // retry this invoke later
                }
              }
              const nl = new Array(m.maxLocals);
              for (let i = 0; i < nslots; i++) nl[i] = s[base + i];
              sp = base;
              f.pc = next; f.sp = sp; f.inCall = true;
              t.frames.push({ m, cls: m.cls, code: m.code, pc: 0, l: nl, s: new Array(m.maxStack + 2), sp: 0, inCall: false, lock });
              return budget;
            }
            case 0xba: vm.throwNew('java/lang/UnsupportedOperationException', 'invokedynamic'); break;
            case 0xbb: {
              const c = vm.resolveClassRef(cls, (code[pc + 1] << 8) | code[pc + 2]);
              if (c.state !== 2 && !vm.ensureInit(t, c)) { f.sp = sp; return budget; }
              s[sp++] = new c.ctor();
              pc += 3; break;
            }
            case 0xbc: {
              const n = s[--sp];
              s[sp++] = vm.newArray('????ZCFDBSIJ'[code[pc + 1]], n);
              pc += 2; break;
            }
            case 0xbd: {
              const n = s[--sp];
              const c = vm.resolveClassRef(cls, (code[pc + 1] << 8) | code[pc + 2]);
              s[sp++] = vm.newArray(c.isArray ? c.name : 'L' + c.name + ';', n);
              pc += 3; break;
            }
            case 0xbe: { const a = s[sp - 1]; if (a === null) npe(); s[sp - 1] = a.length; pc++; break; }
            case 0xbf: { const ex = s[--sp]; if (ex === null) npe(); throw new JThrow(ex); }
            case 0xc0: {
              const o = s[sp - 1];
              if (o !== null) {
                const c = vm.resolveClassRef(cls, (code[pc + 1] << 8) | code[pc + 2]);
                if (!vm.isInstance(o, c)) vm.throwNew('java/lang/ClassCastException', vm.classOf(o).name.replace(/\//g, '.') + ' cannot be cast to ' + c.name.replace(/\//g, '.'));
              }
              pc += 3; break;
            }
            case 0xc1: {
              const o = s[sp - 1];
              s[sp - 1] = o === null ? 0 : (vm.isInstance(o, vm.resolveClassRef(cls, (code[pc + 1] << 8) | code[pc + 2])) ? 1 : 0);
              pc += 3; break;
            }
            case 0xc2: {
              const o = s[sp - 1];
              if (o === null) npe();
              if (!tryEnter(t, o)) { t.blocker = () => !tryEnterCheck(t, o); f.sp = sp; return budget; }
              sp--; pc++; break;
            }
            case 0xc3: { const o = s[--sp]; if (o === null) npe(); exitMon(t, o); pc++; break; }
            case 0xc4: {
              const wop = code[pc + 1], idx = (code[pc + 2] << 8) | code[pc + 3];
              switch (wop) {
                case 0x15: case 0x17: case 0x19: s[sp++] = l[idx]; break;
                case 0x16: case 0x18: s[sp++] = l[idx]; s[sp++] = undefined; break;
                case 0x36: case 0x38: case 0x3a: l[idx] = s[--sp]; break;
                case 0x37: case 0x39: sp--; l[idx] = s[--sp]; break;
                case 0xa9: pc = l[idx]; continue;
                case 0x84: l[idx] = (l[idx] + (((code[pc + 4] << 24) >> 16) | code[pc + 5])) | 0; pc += 2; break;
                default: throw new Error('bad wide op ' + wop);
              }
              pc += 4; break;
            }
            case 0xc5: {
              const c = vm.resolveClassRef(cls, (code[pc + 1] << 8) | code[pc + 2]);
              const dims = code[pc + 3];
              const counts = [];
              for (let i = 0; i < dims; i++) counts.unshift(s[--sp]);
              s[sp++] = vm.newMultiArray(c.name, counts);
              pc += 4; break;
            }
            case 0xc6: pc = s[--sp] === null ? pc + br16(code, pc) : pc + 3; break;
            case 0xc7: pc = s[--sp] !== null ? pc + br16(code, pc) : pc + 3; break;
            case 0xc8: pc += rd32(code, pc + 1); break;
            case 0xc9: s[sp++] = pc + 5; pc += rd32(code, pc + 1); break;
            default:
              throw new Error('Unknown opcode 0x' + op.toString(16) + ' in ' + f.m);
          }
        }
      } catch (e) {
        f.sp = sp;
        throw e;
      }
    }
  }

  function tryEnterCheck(t, o) {
    // called by blocker: returns true once the monitor was acquired
    return tryEnter(t, o) ? (exitMon(t, o), true) : false;
  }

  function br16(code, pc) { return ((code[pc + 1] << 24) >> 16) | code[pc + 2]; }
  function rd32(code, q) { return (code[q] << 24) | (code[q + 1] << 16) | (code[q + 2] << 8) | code[q + 3]; }
  function f2i(v) {
    if (v !== v) return 0;
    if (v >= 2147483647) return 2147483647;
    if (v <= -2147483648) return -2147483648;
    return v < 0 ? Math.ceil(v) | 0 : Math.floor(v) | 0;
  }
  function f2l(v) {
    if (v !== v) return 0n;
    if (v >= 9223372036854775807) return 9223372036854775807n;
    if (v <= -9223372036854775808) return -9223372036854775808n;
    return BigInt(Math.trunc(v));
  }

  KP.now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();
  KP.stringHash = function (s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h;
  };
  KP.natives = KP.natives || {};
  KP.native = function (name, def) { KP.natives[name] = def; };
  KP.VM = VM;
  KP.JThrow = JThrow;
  KP.parseDesc = parseDesc;
  KP.defaultValue = defaultValue;
  KP.monitorOf = monitorOf;
  KP.tryEnter = tryEnter;
  KP.exitMon = exitMon;
  KP.ACC = { STATIC: ACC_STATIC };
})(globalThis.KP = globalThis.KP || {});
