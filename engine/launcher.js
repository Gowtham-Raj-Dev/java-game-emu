/* KeyPlay engine – game launcher: profile detection (resolution / orientation / touch) and MIDlet boot. */
(function (KP) {
  'use strict';

  const SIZES = [
    [128, 128], [128, 160], [132, 176], [176, 208], [176, 220], [208, 208], [240, 320], [320, 240],
    [240, 400], [400, 240], [352, 416], [360, 640], [640, 360], [480, 800], [800, 480], [320, 480], [480, 320],
  ];

  function matchSize(s) {
    const m = /(\d{3})\s*[x×*,]\s*(\d{3})/i.exec(s || '');
    if (!m) return null;
    const w = +m[1], h = +m[2];
    if (w < 96 || h < 96 || w > 1024 || h > 1024) return null;
    return [w, h];
  }

  // Work out the screen size a game was built for, plus orientation and touch support.
  KP.detectProfile = function (jar, props, fileName) {
    const out = { w: 240, h: 320, touch: false, reason: 'default' };
    const keys = ['Nokia-MIDlet-Original-Display-Size', 'Nokia-MIDlet-Target-Display-Size', 'MIDlet-Display-Size', 'Display-Size', 'MIDlet-Screen-Size'];
    let found = null;
    for (const k of keys) { if (props[k]) { found = matchSize(props[k].replace(/\s/g, '').replace(',', 'x')); if (found) { out.reason = k; break; } } }
    if (!found && props['MIDlet-ScreenWidth'] && props['MIDlet-ScreenHeight']) { found = [+props['MIDlet-ScreenWidth'], +props['MIDlet-ScreenHeight']]; out.reason = 'MIDlet-Screen'; }
    if (!found) { found = matchSize(fileName) || matchSize(props['MIDlet-Name']) || matchSize(props['MIDlet-Description']); if (found) out.reason = 'name'; }
    if (!found) {
      // look at the game's images: full-screen splash/background images reveal the screen size
      const score = new Map();
      for (const n of jar.names()) {
        if (!/\.(png)$/i.test(n) && n.indexOf('.') >= 0) continue;
        let b;
        try { b = jar.get(n); } catch (e) { continue; }
        if (!b || !KP.isPng(b)) continue;
        const sz = KP.pngSize(b);
        if (!sz) continue;
        for (const [w, h] of SIZES) {
          const k = w + 'x' + h;
          let s = 0;
          if (sz.width === w && sz.height === h) s = 6;
          else if (sz.width === w && sz.height >= h * 0.5 && sz.height <= h) s = 2;
          else if (sz.width === w) s = 1;
          if (s) score.set(k, (score.get(k) || 0) + s);
        }
      }
      let best = null, bestScore = 1;
      for (const [k, s] of score) if (s > bestScore) { best = k; bestScore = s; }
      if (best) { found = best.split('x').map(Number); out.reason = 'images'; }
    }
    if (found) { out.w = found[0]; out.h = found[1]; }
    const orient = (props['Nokia-MIDlet-App-Orientation'] || props['MIDlet-Orientation'] || '').toLowerCase();
    if (orient === 'landscape' && out.w < out.h) { const t = out.w; out.w = out.h; out.h = t; }
    out.landscape = out.w > out.h;
    const touchProp = (props['MIDlet-Touch-Support'] || '').toLowerCase() === 'true' || (props['Nokia-MIDlet-On-Screen-Keypad'] || '').toLowerCase() === 'no';
    out.touch = touchProp;
    return out;
  };

  class Emulator {
    constructor(opts) {
      this.opts = opts;
      this.jar = new KP.Jar(opts.jarBytes);
      let jadProps = opts.jadText ? KP.parseManifest(opts.jadText) : {};
      this.props = Object.assign({}, KP.parseManifest(this.jar.text('META-INF/MANIFEST.MF') || ''), jadProps);
      this.profile = Object.assign(KP.detectProfile(this.jar, this.props, opts.fileName || ''), opts.profile || {});
      const w = this.profile.w, h = this.profile.h;
      const screenCanvas = KP.makeCanvas(w, h);
      const c = KP.ctxOf(screenCanvas); c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      this.host = Object.assign({
        screen: { w, h, canvas: screenCanvas },
        present: () => {},
        touch: true,
        muted: false,
      }, opts.host || {});
      this.host.screen = { w, h, canvas: screenCanvas };
      this.vm = new KP.VM({
        jar: this.jar, props: this.props, host: this.host,
        log: opts.log || ((s) => console.log('[game] ' + s)),
        warn: opts.warn || ((s) => console.warn('[kp] ' + s)),
        onError: opts.onError || null,
      });
      this.midletClass = null;
      this.held = new Set();
    }

    get name() { return this.props['MIDlet-Name'] || 'Game'; }

    midletEntry() {
      const m1 = this.props['MIDlet-1'];
      if (!m1) {
        // fall back to the first class extending MIDlet
        for (const n of this.jar.names()) {
          if (!n.endsWith('.class')) continue;
          try { const cf = KP.parseClass(this.jar.get(n)); if (cf.superName === 'javax/microedition/midlet/MIDlet') return cf.name; } catch (e) { /* skip */ }
        }
        throw new Error('No MIDlet found in this JAR');
      }
      const parts = m1.split(',');
      return parts[parts.length - 1].trim().replace(/\./g, '/');
    }

    start() {
      const vm = this.vm;
      const main = this.midletEntry();
      const self = this;
      vm.spawnGenerator('main', function* (t) {
        const cls = vm.loadClass(main, true);
        if (!cls) throw new Error('MIDlet class not found: ' + main);
        self.midletClass = cls;
        while (cls.state !== 2) {
          if (!vm.ensureInit(t, cls)) yield { yieldNow: true };
          if (cls.state === 3) return;
        }
        const obj = new cls.ctor();
        self.midlet = obj;
        yield { invoke: cls.findMethod('<init>()V'), args: [obj] };
        yield { invoke: vm.findVirtual(obj, 'startApp()V'), args: [obj] };
      });
    }

    // MIDP key codes: -1 up, -2 down, -3 left, -4 right, -5 fire, -6/-7 soft keys, 48..57 digits, 42 *, 35 #
    keyDown(code) {
      if (this.held.has(code)) { KP.postEvent(this.vm, { type: 'key', kind: 'repeat', code }); return; }
      this.held.add(code);
      KP.postEvent(this.vm, { type: 'key', kind: 'press', code });
    }
    keyUp(code) {
      if (!this.held.has(code)) return;
      this.held.delete(code);
      KP.postEvent(this.vm, { type: 'key', kind: 'release', code });
    }
    pointer(kind, x, y) { KP.postEvent(this.vm, { type: 'pointer', kind, x: Math.round(x), y: Math.round(y) }); }

    pause() {
      if (this.paused) return;
      this.paused = true;
      this.vm.stopped = true;
      if (this.vm.timer !== null) { clearTimeout(this.vm.timer); this.vm.timer = null; }
      KP.audio.stopAll();
    }
    resume() {
      if (!this.paused) return;
      this.paused = false;
      this.vm.stopped = false;
      const d = this.vm.display;
      if (d) d._repaint = true;
      this.vm.wakeup();
    }
    stop() { this.vm.stop(); KP.audio.stopAll(); }
  }

  KP.Emulator = Emulator;
})(globalThis.KP = globalThis.KP || {});
