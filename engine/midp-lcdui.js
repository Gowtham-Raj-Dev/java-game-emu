/* KeyPlay engine – MIDP 2.0 LCDUI core: Display, Displayable, Canvas, GameCanvas, Graphics, Image, Font, Command. */
(function (KP) {
  'use strict';
  const def = KP.native;
  const S_ = (f) => Object.assign(f, { isStatic: true });
  const thr = (t, n, m) => t.vm.throwNew(n, m);
  const P = 'javax/microedition/lcdui/';

  // ---------- canvas factory (browser: OffscreenCanvas / <canvas>; Node: no-op stub) ----------
  function stubCtx(c) {
    const noop = () => {};
    return new Proxy({ canvas: c, measureText: (s) => ({ width: s.length * 6 }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) }, {
      get(tg, k) { return k in tg ? tg[k] : noop; },
      set(tg, k, v) { tg[k] = v; return true; },
    });
  }
  KP.makeCanvas = KP.makeCanvas || function (w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
    if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
    const c = { width: w, height: h };
    c.getContext = () => c._ctx || (c._ctx = stubCtx(c));
    return c;
  };
  function ctxOf(c) {
    if (!c._ctx2) {
      c._ctx2 = c.getContext('2d', { willReadFrequently: false });
      c._ctx2.imageSmoothingEnabled = false;
      c._ctx2.save();
    }
    return c._ctx2;
  }
  KP.ctxOf = ctxOf;

  const rgb = (c) => '#' + ((c & 0xffffff) | 0x1000000).toString(16).substring(1);
  KP.cssColor = rgb;

  // ---------- Font ----------
  const FACE_SYSTEM = 0, FACE_MONOSPACE = 32, FACE_PROPORTIONAL = 64;
  const STYLE_PLAIN = 0, STYLE_BOLD = 1, STYLE_ITALIC = 2, STYLE_UNDERLINED = 4;
  const SIZE_SMALL = 8, SIZE_MEDIUM = 0, SIZE_LARGE = 16;
  let measureCtx = null;
  function fontPx(vm, size) {
    const w = vm.host.screen ? Math.min(vm.host.screen.w, vm.host.screen.h) : 240;
    const table = w <= 128 ? [11, 12, 14] : w <= 176 ? [12, 14, 17] : w <= 240 ? [14, 16, 19] : [16, 19, 23];
    return size === SIZE_SMALL ? table[0] : size === SIZE_LARGE ? table[2] : table[1];
  }
  function makeFont(vm, face, style, size) {
    const key = face + ':' + style + ':' + size;
    vm.fonts = vm.fonts || new Map();
    let f = vm.fonts.get(key);
    if (f) return f;
    f = vm.newObject(P + 'Font');
    f._face = face; f._style = style; f._size = size;
    f._px = fontPx(vm, size);
    const fam = face === FACE_MONOSPACE ? '"Courier New", monospace' : 'Arial, "Helvetica Neue", sans-serif';
    f._css = ((style & STYLE_ITALIC) ? 'italic ' : '') + ((style & STYLE_BOLD) ? 'bold ' : '') + f._px + 'px ' + fam;
    f._ascent = Math.round(f._px * 0.86);
    f._height = Math.round(f._px * 1.18);
    f._wcache = new Map();
    vm.fonts.set(key, f);
    return f;
  }
  function textWidth(f, s) {
    if (s.length === 1) {
      let w = f._wcache.get(s);
      if (w !== undefined) return w;
      w = measure(f, s); f._wcache.set(s, w); return w;
    }
    if (s.length < 32) {
      let w = f._wcache.get(s);
      if (w !== undefined) return w;
      w = measure(f, s); if (f._wcache.size < 4000) f._wcache.set(s, w); return w;
    }
    return measure(f, s);
  }
  function measure(f, s) {
    if (!measureCtx) measureCtx = ctxOf(KP.makeCanvas(4, 4));
    measureCtx.font = f._css;
    return Math.round(measureCtx.measureText(s).width);
  }
  KP.makeFont = makeFont; KP.textWidth = textWidth;

  def(P + 'Font', {
    statics: {
      FACE_SYSTEM: ['I', 0], FACE_MONOSPACE: ['I', 32], FACE_PROPORTIONAL: ['I', 64],
      STYLE_PLAIN: ['I', 0], STYLE_BOLD: ['I', 1], STYLE_ITALIC: ['I', 2], STYLE_UNDERLINED: ['I', 4],
      SIZE_SMALL: ['I', 8], SIZE_MEDIUM: ['I', 0], SIZE_LARGE: ['I', 16],
      FONT_STATIC_TEXT: ['I', 0], FONT_INPUT_TEXT: ['I', 1],
    },
    methods: {
      'getFont(III)Ljavax/microedition/lcdui/Font;': S_((t, [face, style, size]) => makeFont(t.vm, face, style, size)),
      'getFont(I)Ljavax/microedition/lcdui/Font;': S_((t) => makeFont(t.vm, 0, 0, 0)),
      'getDefaultFont()Ljavax/microedition/lcdui/Font;': S_((t) => makeFont(t.vm, 0, 0, 0)),
      'getHeight()I': (t, [f]) => f._height,
      'getBaselinePosition()I': (t, [f]) => f._ascent,
      'charWidth(C)I': (t, [f, c]) => textWidth(f, String.fromCharCode(c)),
      'charsWidth([CII)I': (t, [f, a, o, n]) => textWidth(f, KP.charsToString(a, o, n)),
      'stringWidth(Ljava/lang/String;)I': (t, [f, s]) => { if (s === null) thr(t, 'java/lang/NullPointerException'); return textWidth(f, s); },
      'substringWidth(Ljava/lang/String;II)I': (t, [f, s, o, n]) => textWidth(f, s.substr(o, n)),
      'getFace()I': (t, [f]) => f._face,
      'getStyle()I': (t, [f]) => f._style,
      'getSize()I': (t, [f]) => f._size,
      'isPlain()Z': (t, [f]) => f._style === 0,
      'isBold()Z': (t, [f]) => !!(f._style & 1),
      'isItalic()Z': (t, [f]) => !!(f._style & 2),
      'isUnderlined()Z': (t, [f]) => !!(f._style & 4),
    },
  });

  // ---------- Image ----------
  function newImage(vm, w, h, mutable) {
    const im = vm.newObject(P + 'Image');
    im._w = w; im._h = h; im._mutable = mutable;
    im._c = KP.makeCanvas(w, h);
    if (mutable) { const c = ctxOf(im._c); c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); }
    return im;
  }
  function imageFromRGBA(vm, w, h, data) {
    const im = newImage(vm, w, h, false);
    const c = ctxOf(im._c);
    const id = c.createImageData(w, h);
    id.data.set(data);
    c.putImageData(id, 0, 0);
    return im;
  }
  KP.newImage = newImage; KP.imageFromRGBA = imageFromRGBA;

  function sniffSize(b, off, len) {
    // JPEG SOF / GIF / BMP dimensions for async decoding
    const u = (i) => b[off + i] & 255;
    if (u(0) === 0x47 && u(1) === 0x49 && u(2) === 0x46) return { w: u(6) | (u(7) << 8), h: u(8) | (u(9) << 8), type: 'image/gif' };
    if (u(0) === 0x42 && u(1) === 0x4d) return { w: u(18) | (u(19) << 8), h: Math.abs((u(22) | (u(23) << 8) | (u(24) << 16) | (u(25) << 24)) | 0), type: 'image/bmp' };
    if (u(0) === 0xff && u(1) === 0xd8) {
      let p = 2;
      while (p + 9 < len) {
        if (u(p) !== 0xff) { p++; continue; }
        const mk = u(p + 1);
        const sl = (u(p + 2) << 8) | u(p + 3);
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { h: (u(p + 5) << 8) | u(p + 6), w: (u(p + 7) << 8) | u(p + 8), type: 'image/jpeg' };
        p += 2 + sl;
      }
    }
    return null;
  }

  function decodeImageBytes(t, bytes, off, len) {
    const vm = t.vm;
    const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset + off, len);
    if (KP.isPng(u8)) {
      let d;
      try { d = KP.decodePng(u8); } catch (e) { thr(t, 'java/lang/IllegalArgumentException', 'Bad PNG: ' + e.message); }
      return imageFromRGBA(vm, d.width, d.height, d.data);
    }
    const sz = sniffSize(u8, 0, len);
    if (!sz || !sz.w || !sz.h) thr(t, 'java/lang/IllegalArgumentException', 'Unsupported image data');
    const im = newImage(vm, sz.w, sz.h, false);
    // decode asynchronously (JPEG/GIF/BMP); pixels appear once ready
    if (typeof createImageBitmap !== 'undefined') {
      createImageBitmap(new Blob([u8.slice()], { type: sz.type })).then((bmp) => { ctxOf(im._c).drawImage(bmp, 0, 0); if (vm.host.present) vm.host.present(); }).catch(() => {});
    }
    return im;
  }
  KP.decodeImageBytes = decodeImageBytes;

  function loadResourceImage(t, name) {
    if (name === null) thr(t, 'java/lang/NullPointerException');
    const vm = t.vm;
    const path = name.replace(/^\/+/, '');
    vm.imageCache = vm.imageCache || new Map();
    const cached = vm.imageCache.get(path);
    if (cached) return cached;
    const bytes = vm.jar.get(path);
    if (!bytes) thr(t, 'java/io/IOException', 'Image not found: ' + name);
    const im = decodeImageBytes(t, bytes, 0, bytes.length);
    vm.imageCache.set(path, im);
    return im;
  }

  function regionImage(vm, src, x, y, w, h, transform) {
    const swap = transform === 5 || transform === 6 || transform === 7 || transform === 4;
    const im = newImage(vm, swap ? h : w, swap ? w : h, false);
    const c = ctxOf(im._c);
    c.clearRect(0, 0, im._w, im._h);
    drawRegionRaw(c, src._c, x, y, w, h, transform, 0, 0);
    return im;
  }

  // draw source region with MIDP transform at dest top-left (dx,dy)
  function drawRegionRaw(c, srcCanvas, sx, sy, w, h, tr, dx, dy) {
    if (w <= 0 || h <= 0) return;
    if (tr === 0) { c.drawImage(srcCanvas, sx, sy, w, h, dx, dy, w, h); return; }
    let m;
    switch (tr) {
      case 2: m = [-1, 0, 0, 1, dx + w, dy]; break;          // MIRROR
      case 3: m = [-1, 0, 0, -1, dx + w, dy + h]; break;     // ROT180
      case 1: m = [1, 0, 0, -1, dx, dy + h]; break;          // MIRROR_ROT180
      case 5: m = [0, 1, -1, 0, dx + h, dy]; break;          // ROT90
      case 6: m = [0, -1, 1, 0, dx, dy + w]; break;          // ROT270
      case 7: m = [0, -1, -1, 0, dx + h, dy + w]; break;     // MIRROR_ROT90
      case 4: m = [0, 1, 1, 0, dx, dy]; break;               // MIRROR_ROT270
      default: m = [1, 0, 0, 1, dx, dy];
    }
    c.save();
    c.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    c.drawImage(srcCanvas, sx, sy, w, h, 0, 0, w, h);
    c.restore();
  }
  KP.drawRegionRaw = drawRegionRaw;

  function getRGB(t, im, out, off, scan, x, y, w, h) {
    if (out === null) thr(t, 'java/lang/NullPointerException');
    if (x < 0 || y < 0 || x + w > im._w || y + h > im._h) thr(t, 'java/lang/IllegalArgumentException', 'getRGB out of bounds');
    if (w <= 0 || h <= 0) return;
    const d = ctxOf(im._c).getImageData(x, y, w, h).data;
    for (let j = 0; j < h; j++) {
      let p = off + j * scan, q = j * w * 4;
      for (let i = 0; i < w; i++, q += 4) out[p + i] = (d[q + 3] << 24) | (d[q] << 16) | (d[q + 1] << 8) | d[q + 2];
    }
  }
  KP.imageGetRGB = getRGB;

  def(P + 'Image', {
    staticMethods: [],
    methods: {
      'createImage(Ljava/lang/String;)Ljavax/microedition/lcdui/Image;': S_((t, [name]) => loadResourceImage(t, name)),
      'createImage([BII)Ljavax/microedition/lcdui/Image;': S_((t, [b, off, len]) => {
        if (b === null) thr(t, 'java/lang/NullPointerException');
        if (off < 0 || len < 0 || off + len > b.length) thr(t, 'java/lang/ArrayIndexOutOfBoundsException');
        return decodeImageBytes(t, b, off, len);
      }),
      'createImage(II)Ljavax/microedition/lcdui/Image;': S_((t, [w, h]) => { if (w <= 0 || h <= 0) thr(t, 'java/lang/IllegalArgumentException'); return newImage(t.vm, w, h, true); }),
      'createImage(Ljavax/microedition/lcdui/Image;)Ljavax/microedition/lcdui/Image;': S_((t, [src]) => {
        if (!src._mutable) return src;
        const im = newImage(t.vm, src._w, src._h, false);
        const c = ctxOf(im._c); c.clearRect(0, 0, src._w, src._h); c.drawImage(src._c, 0, 0);
        return im;
      }),
      'createImage(Ljavax/microedition/lcdui/Image;IIIII)Ljavax/microedition/lcdui/Image;': S_((t, [src, x, y, w, h, tr]) => {
        if (x < 0 || y < 0 || x + w > src._w || y + h > src._h || w <= 0 || h <= 0) thr(t, 'java/lang/IllegalArgumentException');
        return regionImage(t.vm, src, x, y, w, h, tr);
      }),
      'createImage(Ljava/io/InputStream;)Ljavax/microedition/lcdui/Image;': S_((t, [ins]) => {
        if (ins === null) thr(t, 'java/lang/NullPointerException');
        const chunks = []; let total = 0;
        const buf = KP.newByteArray(8192);
        for (;;) { const n = KP.readInto(t, ins, buf, 0, buf.length); if (n <= 0) break; chunks.push(buf.slice(0, n)); total += n; }
        const all = new Int8Array(total); let p = 0;
        for (const c of chunks) { all.set(c, p); p += c.length; }
        try { return decodeImageBytes(t, all, 0, total); } catch (e) { if (e instanceof KP.JThrow) thr(t, 'java/io/IOException', 'Bad image data'); throw e; }
      }),
      'createRGBImage([IIIZ)Ljavax/microedition/lcdui/Image;': S_((t, [rgb, w, h, alpha]) => {
        if (rgb === null) thr(t, 'java/lang/NullPointerException');
        if (w <= 0 || h <= 0) thr(t, 'java/lang/IllegalArgumentException');
        if (w * h > rgb.length) thr(t, 'java/lang/ArrayIndexOutOfBoundsException');
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0, q = 0; i < w * h; i++, q += 4) {
          const v = rgb[i];
          data[q] = (v >> 16) & 255; data[q + 1] = (v >> 8) & 255; data[q + 2] = v & 255; data[q + 3] = alpha ? (v >>> 24) : 255;
        }
        return imageFromRGBA(t.vm, w, h, data);
      }),
      'getGraphics()Ljavax/microedition/lcdui/Graphics;': (t, [im]) => {
        if (!im._mutable) thr(t, 'java/lang/IllegalStateException', 'Image is immutable');
        return KP.newGraphics(t.vm, im._c, im._w, im._h, im);
      },
      'getWidth()I': (t, [im]) => im._w,
      'getHeight()I': (t, [im]) => im._h,
      'isMutable()Z': (t, [im]) => im._mutable,
      'getRGB([IIIIIII)V': (t, [im, out, off, scan, x, y, w, h]) => getRGB(t, im, out, off, scan, x, y, w, h),
    },
  });

  // ---------- Graphics ----------
  const HCENTER = 1, VCENTER = 2, LEFT = 4, RIGHT = 8, TOP = 16, BOTTOM = 32, BASELINE = 64;
  function newGraphics(vm, canvas, w, h, image) {
    const g = vm.newObject(P + 'Graphics');
    g._canvas = canvas; g._ctx = ctxOf(canvas);
    g._w = w; g._h = h; g._image = image || null;
    g._tx = 0; g._ty = 0;
    g._cx = 0; g._cy = 0; g._cw = w; g._ch = h;
    g._color = 0; g._css = '#000000';
    g._font = makeFont(vm, 0, 0, 0);
    g._stroke = 0;
    g._clipKey = 'c' + (++vm.idHash);
    return g;
  }
  KP.newGraphics = newGraphics;

  // make the shared 2D context match this Graphics' clip
  function prep(g) {
    const c = g._ctx;
    if (c.$clip !== g._clipKey) {
      c.restore(); c.save();
      if (!(g._cx === 0 && g._cy === 0 && g._cw >= g._w && g._ch >= g._h)) {
        c.beginPath(); c.rect(g._cx, g._cy, Math.max(0, g._cw), Math.max(0, g._ch)); c.clip();
      }
      c.$clip = g._clipKey;
      c.imageSmoothingEnabled = false;
    }
    return c;
  }
  function setClip(g, x, y, w, h) {
    // stored in absolute (untranslated) coordinates, intersected with the surface
    let x0 = x + g._tx, y0 = y + g._ty, x1 = x0 + w, y1 = y0 + h;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(g._w, x1); y1 = Math.min(g._h, y1);
    g._cx = x0; g._cy = y0; g._cw = Math.max(0, x1 - x0); g._ch = Math.max(0, y1 - y0);
    g._clipKey = 'c' + (++g.__cls.vm.idHash);
  }
  function fill(g) { const c = prep(g); if (c.fillStyle !== g._css) c.fillStyle = g._css; return c; }
  function stroke(g) { const c = prep(g); if (c.strokeStyle !== g._css) c.strokeStyle = g._css; c.lineWidth = 1; c.setLineDash(g._stroke ? [2, 2] : []); return c; }

  function anchorXY(anchor, x, y, w, h, baseline) {
    if (anchor & HCENTER) x -= w >> 1; else if (anchor & RIGHT) x -= w;
    if (anchor & VCENTER) y -= h >> 1; else if (anchor & BOTTOM) y -= h; else if (anchor & BASELINE) y -= baseline;
    return [x, y];
  }

  function drawLine(g, x1, y1, x2, y2) {
    x1 += g._tx; y1 += g._ty; x2 += g._tx; y2 += g._ty;
    const c = fill(g);
    if (y1 === y2) { c.fillRect(Math.min(x1, x2), y1, Math.abs(x2 - x1) + 1, 1); return; }
    if (x1 === x2) { c.fillRect(x1, Math.min(y1, y2), 1, Math.abs(y2 - y1) + 1); return; }
    // Bresenham with 1px rects (crisp like a phone LCD)
    const dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1), sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
    let err = dx + dy, n = 0;
    for (;;) {
      if (!g._stroke || ((n++ >> 1) & 1) === 0) c.fillRect(x1, y1, 1, 1);
      if (x1 === x2 && y1 === y2) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x1 += sx; }
      if (e2 <= dx) { err += dx; y1 += sy; }
    }
  }

  function arcPath(c, x, y, w, h, start, arc, pie) {
    const cx = x + w / 2, cy = y + h / 2;
    c.beginPath();
    if (arc >= 360 || arc <= -360) { c.ellipse(cx, cy, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2); return; }
    const a0 = -start * Math.PI / 180, a1 = -(start + arc) * Math.PI / 180;
    if (pie) c.moveTo(cx, cy);
    c.ellipse(cx, cy, Math.max(0, w / 2), Math.max(0, h / 2), 0, a0, a1, arc > 0);
    if (pie) c.closePath();
  }

  function drawStringAt(g, s, x, y, anchor) {
    if (s === null) return;
    const f = g._font;
    const w = textWidth(f, s);
    if (anchor === 0) anchor = TOP | LEFT;
    let [ax, ay] = anchorXY(anchor, x + g._tx, y + g._ty, w, f._height, f._ascent);
    const c = fill(g);
    if (c.font !== f._css) c.font = f._css;
    c.textBaseline = 'alphabetic';
    c.fillText(s, ax, ay + f._ascent);
    if (f._style & STYLE_UNDERLINED) c.fillRect(ax, ay + f._ascent + 1, w, 1);
  }

  function drawImageAt(g, im, x, y, anchor) {
    if (im === null) g.__cls.vm.throwNew('java/lang/NullPointerException');
    if (anchor === 0) anchor = TOP | LEFT;
    const [ax, ay] = anchorXY(anchor, x + g._tx, y + g._ty, im._w, im._h, im._h);
    prep(g).drawImage(im._c, ax, ay);
  }

  let rgbTmp = null;
  function drawRGB(g, data, off, scan, x, y, w, h, alpha) {
    if (w <= 0 || h <= 0) return;
    if (!rgbTmp || rgbTmp.width < w || rgbTmp.height < h) rgbTmp = KP.makeCanvas(Math.max(w, rgbTmp ? rgbTmp.width : 0), Math.max(h, rgbTmp ? rgbTmp.height : 0));
    const tc = ctxOf(rgbTmp);
    const id = tc.createImageData(w, h);
    const d = id.data;
    for (let j = 0; j < h; j++) {
      let p = off + j * scan, q = j * w * 4;
      for (let i = 0; i < w; i++, q += 4) {
        const v = data[p + i];
        d[q] = (v >> 16) & 255; d[q + 1] = (v >> 8) & 255; d[q + 2] = v & 255; d[q + 3] = alpha ? (v >>> 24) : 255;
      }
    }
    tc.putImageData(id, 0, 0);
    prep(g).drawImage(rgbTmp, 0, 0, w, h, x + g._tx, y + g._ty, w, h);
  }
  KP.gDrawRGB = drawRGB; KP.gPrep = prep; KP.gFill = fill; KP.gStroke = stroke; KP.gAnchor = anchorXY; KP.gDrawLine = drawLine;

  def(P + 'Graphics', {
    statics: {
      HCENTER: ['I', 1], VCENTER: ['I', 2], LEFT: ['I', 4], RIGHT: ['I', 8], TOP: ['I', 16], BOTTOM: ['I', 32], BASELINE: ['I', 64],
      SOLID: ['I', 0], DOTTED: ['I', 1],
    },
    methods: {
      'setColor(I)V': (t, [g, c]) => { g._color = c & 0xffffff; g._css = rgb(c); },
      'setColor(III)V': (t, [g, r, gg, b]) => {
        if ((r | gg | b) & ~255) thr(t, 'java/lang/IllegalArgumentException');
        g._color = (r << 16) | (gg << 8) | b; g._css = rgb(g._color);
      },
      'getColor()I': (t, [g]) => g._color,
      'getRedComponent()I': (t, [g]) => (g._color >> 16) & 255,
      'getGreenComponent()I': (t, [g]) => (g._color >> 8) & 255,
      'getBlueComponent()I': (t, [g]) => g._color & 255,
      'setGrayScale(I)V': (t, [g, v]) => { g._color = (v << 16) | (v << 8) | v; g._css = rgb(g._color); },
      'getGrayScale()I': (t, [g]) => (((g._color >> 16) & 255) * 77 + ((g._color >> 8) & 255) * 151 + (g._color & 255) * 28) >> 8,
      'getDisplayColor(I)I': (t, [g, c]) => c & 0xffffff,
      'setFont(Ljavax/microedition/lcdui/Font;)V': (t, [g, f]) => { g._font = f || makeFont(t.vm, 0, 0, 0); },
      'getFont()Ljavax/microedition/lcdui/Font;': (t, [g]) => g._font,
      'setStrokeStyle(I)V': (t, [g, s]) => { g._stroke = s; },
      'getStrokeStyle()I': (t, [g]) => g._stroke,
      'translate(II)V': (t, [g, x, y]) => { g._tx += x; g._ty += y; },
      'getTranslateX()I': (t, [g]) => g._tx,
      'getTranslateY()I': (t, [g]) => g._ty,
      'setClip(IIII)V': (t, [g, x, y, w, h]) => setClip(g, x, y, w, h),
      'clipRect(IIII)V': (t, [g, x, y, w, h]) => {
        const ax0 = Math.max(g._cx, x + g._tx), ay0 = Math.max(g._cy, y + g._ty);
        const ax1 = Math.min(g._cx + g._cw, x + g._tx + w), ay1 = Math.min(g._cy + g._ch, y + g._ty + h);
        setClip(g, ax0 - g._tx, ay0 - g._ty, ax1 - ax0, ay1 - ay0);
      },
      'getClipX()I': (t, [g]) => g._cx - g._tx,
      'getClipY()I': (t, [g]) => g._cy - g._ty,
      'getClipWidth()I': (t, [g]) => g._cw,
      'getClipHeight()I': (t, [g]) => g._ch,
      'drawLine(IIII)V': (t, [g, a, b, c, d]) => drawLine(g, a, b, c, d),
      'fillRect(IIII)V': (t, [g, x, y, w, h]) => { if (w > 0 && h > 0) fill(g).fillRect(x + g._tx, y + g._ty, w, h); },
      'drawRect(IIII)V': (t, [g, x, y, w, h]) => {
        if (w < 0 || h < 0) return;
        x += g._tx; y += g._ty;
        const c = fill(g);
        if (w === 0 || h === 0) { c.fillRect(x, y, w + 1, h + 1); return; }
        c.fillRect(x, y, w + 1, 1); c.fillRect(x, y + h, w + 1, 1);
        c.fillRect(x, y + 1, 1, h - 1); c.fillRect(x + w, y + 1, 1, h - 1);
      },
      'fillRoundRect(IIIIII)V': (t, [g, x, y, w, h, aw, ah]) => {
        if (w <= 0 || h <= 0) return;
        const c = fill(g); c.beginPath();
        roundRectPath(c, x + g._tx, y + g._ty, w, h, Math.min(aw / 2, w / 2), Math.min(ah / 2, h / 2)); c.fill();
      },
      'drawRoundRect(IIIIII)V': (t, [g, x, y, w, h, aw, ah]) => {
        if (w < 0 || h < 0) return;
        const c = stroke(g); c.beginPath();
        roundRectPath(c, x + g._tx + 0.5, y + g._ty + 0.5, w, h, Math.min(aw / 2, w / 2), Math.min(ah / 2, h / 2)); c.stroke();
      },
      'fillArc(IIIIII)V': (t, [g, x, y, w, h, s, a]) => { if (w <= 0 || h <= 0 || a === 0) return; const c = fill(g); arcPath(c, x + g._tx, y + g._ty, w, h, s, a, true); c.fill(); },
      'drawArc(IIIIII)V': (t, [g, x, y, w, h, s, a]) => { if (w < 0 || h < 0 || a === 0) return; const c = stroke(g); arcPath(c, x + g._tx + 0.5, y + g._ty + 0.5, w, h, s, a, false); c.stroke(); },
      'fillTriangle(IIIIII)V': (t, [g, x1, y1, x2, y2, x3, y3]) => {
        const c = fill(g); c.beginPath();
        c.moveTo(x1 + g._tx, y1 + g._ty); c.lineTo(x2 + g._tx, y2 + g._ty); c.lineTo(x3 + g._tx, y3 + g._ty); c.closePath(); c.fill();
      },
      'drawString(Ljava/lang/String;III)V': (t, [g, s, x, y, a]) => { if (s === null) thr(t, 'java/lang/NullPointerException'); drawStringAt(g, s, x, y, a); },
      'drawSubstring(Ljava/lang/String;IIIII)V': (t, [g, s, o, n, x, y, a]) => drawStringAt(g, s.substr(o, n), x, y, a),
      'drawChar(CIII)V': (t, [g, ch, x, y, a]) => drawStringAt(g, String.fromCharCode(ch), x, y, a),
      'drawChars([CIIIII)V': (t, [g, cs, o, n, x, y, a]) => drawStringAt(g, KP.charsToString(cs, o, n), x, y, a),
      'drawImage(Ljavax/microedition/lcdui/Image;III)V': (t, [g, im, x, y, a]) => drawImageAt(g, im, x, y, a),
      'drawRegion(Ljavax/microedition/lcdui/Image;IIIIIIII)V': (t, [g, im, sx, sy, w, h, tr, dx, dy, a]) => {
        if (im === null) thr(t, 'java/lang/NullPointerException');
        if (sx < 0 || sy < 0 || sx + w > im._w || sy + h > im._h) thr(t, 'java/lang/IllegalArgumentException', 'region out of bounds');
        const swap = tr === 5 || tr === 6 || tr === 7 || tr === 4;
        const dw = swap ? h : w, dh = swap ? w : h;
        if (a === 0) a = TOP | LEFT;
        const [ax, ay] = anchorXY(a, dx + g._tx, dy + g._ty, dw, dh, dh);
        drawRegionRaw(prep(g), im._c, sx, sy, w, h, tr, ax, ay);
      },
      'drawRGB([IIIIIIIZ)V': (t, [g, d, off, scan, x, y, w, h, al]) => { if (d === null) thr(t, 'java/lang/NullPointerException'); drawRGB(g, d, off, scan, x, y, w, h, al); },
      'copyArea(IIIIIII)V': (t, [g, sx, sy, w, h, dx, dy, a]) => {
        if (w <= 0 || h <= 0) return;
        const tmp = KP.makeCanvas(w, h);
        ctxOf(tmp).drawImage(g._canvas, sx + g._tx, sy + g._ty, w, h, 0, 0, w, h);
        const [ax, ay] = anchorXY(a || (TOP | LEFT), dx + g._tx, dy + g._ty, w, h, h);
        prep(g).drawImage(tmp, ax, ay);
      },
    },
  });
  function roundRectPath(c, x, y, w, h, rx, ry) {
    rx = Math.max(0, rx); ry = Math.max(0, ry);
    c.moveTo(x + rx, y);
    c.lineTo(x + w - rx, y); c.ellipse(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
    c.lineTo(x + w, y + h - ry); c.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2);
    c.lineTo(x + rx, y + h); c.ellipse(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI);
    c.lineTo(x, y + ry); c.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
    c.closePath();
  }

  // ---------- Command ----------
  def(P + 'Command', {
    statics: { SCREEN: ['I', 1], BACK: ['I', 2], CANCEL: ['I', 3], OK: ['I', 4], HELP: ['I', 5], STOP: ['I', 6], EXIT: ['I', 7], ITEM: ['I', 8] },
    methods: {
      '<init>(Ljava/lang/String;II)V': (t, [c, l, ty, p]) => { c._label = l; c._long = null; c._type = ty; c._prio = p; },
      '<init>(Ljava/lang/String;Ljava/lang/String;II)V': (t, [c, l, ll, ty, p]) => { c._label = l; c._long = ll; c._type = ty; c._prio = p; },
      'getLabel()Ljava/lang/String;': (t, [c]) => c._label,
      'getLongLabel()Ljava/lang/String;': (t, [c]) => c._long,
      'getCommandType()I': (t, [c]) => c._type,
      'getPriority()I': (t, [c]) => c._prio,
    },
  });
  def(P + 'CommandListener', { isInterface: true, methods: {} });

  // ---------- Display & event dispatch ----------
  function display(vm) {
    if (!vm.display) {
      const d = vm.newObject(P + 'Display');
      d._current = null; d._queue = []; d._repaint = false; d._painting = false;
      vm.display = d;
      vm.spawnGenerator('EventDispatch', (t) => eventLoop(t, d));
    }
    return vm.display;
  }
  KP.display = display;

  function post(vm, ev) {
    const d = display(vm);
    d._queue.push(ev);
    vm.wakeup();
  }
  KP.postEvent = post;

  function isCanvas(vm, o) { return o && vm.isInstance(o, vm.loadClass(P + 'Canvas')); }
  KP.isCanvas = isCanvas;

  function* paintCanvas(t, d, cv) {
    const vm = t.vm, host = vm.host;
    if (!host.screen) return;
    d._repaint = false;
    const g = newGraphics(vm, host.screen.canvas, host.screen.w, host.screen.h, null);
    g._font = makeFont(vm, 0, 0, 0);
    if (cv._rx !== undefined && cv._rx !== null) { setClip(g, cv._rx, cv._ry, cv._rw, cv._rh); cv._rx = null; }
    d._painting = true;
    try {
      yield { invoke: vm.findVirtual(cv, 'paint(Ljavax/microedition/lcdui/Graphics;)V'), args: [cv, g] };
    } catch (e) {
      if (!(e instanceof KP.JThrow)) throw e;
      vm.warn('paint() threw ' + vm.classOf(e.ex).name + (e.ex._msg ? ': ' + e.ex._msg : '') + '\n  at ' + (e.ex._trace || []).join('\n  at '));
    } finally { d._painting = false; }
    host.present();
  }
  KP.paintCanvas = paintCanvas;

  function* eventLoop(t, d) {
    const vm = t.vm;
    for (;;) {
      if (!d._queue.length && !d._repaint) {
        yield { block: () => !d._queue.length && !d._repaint };
        continue;
      }
      const ev = d._queue.length ? d._queue.shift() : { type: 'paint' };
      const cur = d._current;
      try {
        switch (ev.type) {
          case 'paint':
            if (cur && isCanvas(vm, cur)) { if (cur._shown) yield* paintCanvas(t, d, cur); else d._repaint = false; }
            else if (cur && cur._screen) { d._repaint = false; KP.paintScreen(vm, cur); }
            else d._repaint = false;
            break;
          case 'key': {
            if (!cur) break;
            if (isCanvas(vm, cur)) {
              if (ev.kind === 'press' && (yield* softKey(t, cur, ev.code))) break;
              KP.updateKeyStates(cur, ev.code, ev.kind);
              if (cur._suppressKeys && KP.gameActionOf(ev.code)) break;
              const name = ev.kind === 'press' ? 'keyPressed(I)V' : ev.kind === 'release' ? 'keyReleased(I)V' : 'keyRepeated(I)V';
              yield { invoke: vm.findVirtual(cur, name), args: [cur, ev.code] };
            } else if (cur._screen) {
              if (ev.kind === 'press' || ev.kind === 'repeat') yield* KP.screenKey(t, cur, ev.code);
            }
            break;
          }
          case 'pointer': {
            if (!cur) break;
            if (isCanvas(vm, cur)) {
              const name = ev.kind === 'press' ? 'pointerPressed(II)V' : ev.kind === 'release' ? 'pointerReleased(II)V' : 'pointerDragged(II)V';
              yield { invoke: vm.findVirtual(cur, name), args: [cur, ev.x, ev.y] };
            } else if (cur._screen && ev.kind === 'press') yield* KP.screenPointer(t, cur, ev.x, ev.y);
            break;
          }
          case 'serial':
            yield { invoke: vm.findVirtual(ev.r, 'run()V'), args: [ev.r] };
            break;
          case 'command':
            if (ev.listener) {
              const m = vm.findVirtual(ev.listener, ev.item ? 'commandAction(Ljavax/microedition/lcdui/Command;Ljavax/microedition/lcdui/Item;)V' : 'commandAction(Ljavax/microedition/lcdui/Command;Ljavax/microedition/lcdui/Displayable;)V');
              yield { invoke: m, args: [ev.listener, ev.cmd, ev.item || ev.disp] };
            }
            break;
          case 'invoke':
            yield { invoke: ev.m, args: ev.args };
            break;
          case 'call':
            ev.fn();
            break;
        }
      } catch (e) {
        if (!(e instanceof KP.JThrow)) throw e;
        vm.warn('Event handler threw ' + vm.classOf(e.ex).name + (e.ex._msg ? ': ' + e.ex._msg : '') + '\n  at ' + (e.ex._trace || []).join('\n  at '));
      }
    }
  }

  // soft keys on a Canvas with Commands (when the game does not handle them itself)
  function* softKey(t, cur, code) {
    if (code !== -6 && code !== -7) return false;
    const cmds = cur._cmds || [];
    if (!cmds.length || !cur._listener) return false;
    const vm = t.vm;
    const [left, right] = KP.softCommands(cmds);
    const pick = code === -6 ? left : right;
    if (!pick) return false;
    if (Array.isArray(pick)) {
      if (vm.host.showMenu) vm.host.showMenu(pick.map((c) => c._label), (i) => { if (i >= 0) post(vm, { type: 'command', listener: cur._listener, cmd: pick[i], disp: cur }); });
      return true;
    }
    yield { invoke: vm.findVirtual(cur._listener, 'commandAction(Ljavax/microedition/lcdui/Command;Ljavax/microedition/lcdui/Displayable;)V'), args: [cur._listener, pick, cur] };
    return true;
  }

  // left soft: positive commands (menu if several); right soft: first negative (BACK/EXIT/CANCEL/STOP)
  KP.softCommands = function (cmds) {
    const neg = cmds.filter((c) => c._type === 2 || c._type === 3 || c._type === 6 || c._type === 7).sort((a, b) => a._prio - b._prio);
    const pos = cmds.filter((c) => neg.indexOf(c) < 0).sort((a, b) => a._prio - b._prio);
    let right = neg[0] || null;
    let leftList = pos.concat(neg.slice(1));
    if (!right && leftList.length > 1) right = leftList.pop();
    const left = leftList.length === 0 ? null : leftList.length === 1 ? leftList[0] : leftList;
    return [left, right];
  };

  function updateSoftLabels(vm) {
    const d = vm.display; if (!d || !vm.host.setSoftLabels) return;
    const cur = d._current;
    if (!cur) { vm.host.setSoftLabels('', ''); return; }
    const cmds = cur._cmds || [];
    const [l, r] = KP.softCommands(cmds);
    let ll = l ? (Array.isArray(l) ? 'Options' : l._label) : '';
    let rl = r ? r._label : '';
    if (cur._screen && cur._screen === 'list' && cur._listType === 3 && !ll) ll = 'Select';
    vm.host.setSoftLabels(ll, rl);
  }
  KP.updateSoftLabels = updateSoftLabels;

  function setCurrent(t, d, next) {
    const vm = t.vm;
    const prev = d._current;
    if (next === prev) { if (next) d._repaint = true; vm.wakeup(); return; }
    if (prev) {
      prev._shown = false;
      if (isCanvas(vm, prev)) post(vm, { type: 'invoke', m: vm.findVirtual(prev, 'hideNotify()V'), args: [prev] });
    }
    d._current = next;
    if (next) {
      next._shown = true;
      if (isCanvas(vm, next)) {
        post(vm, { type: 'invoke', m: vm.findVirtual(next, 'showNotify()V'), args: [next] });
        if (vm.host.onCanvasShown) vm.host.onCanvasShown(next);
      } else if (vm.host.onScreenShown) vm.host.onScreenShown(next);
      d._repaint = true;
    }
    updateSoftLabels(vm);
    vm.wakeup();
  }
  KP.setCurrent = setCurrent;

  def(P + 'Display', {
    statics: { LIST_ELEMENT: ['I', 1], CHOICE_GROUP_ELEMENT: ['I', 2], ALERT: ['I', 3], COLOR_BACKGROUND: ['I', 0], COLOR_FOREGROUND: ['I', 1], COLOR_HIGHLIGHTED_BACKGROUND: ['I', 2], COLOR_HIGHLIGHTED_FOREGROUND: ['I', 3], COLOR_BORDER: ['I', 4], COLOR_HIGHLIGHTED_BORDER: ['I', 5] },
    methods: {
      'getDisplay(Ljavax/microedition/midlet/MIDlet;)Ljavax/microedition/lcdui/Display;': S_((t) => display(t.vm)),
      'getCurrent()Ljavax/microedition/lcdui/Displayable;': (t, [d]) => d._current,
      'setCurrent(Ljavax/microedition/lcdui/Displayable;)V': (t, [d, n]) => {
        if (n && n._screen === 'alert') { n._next = d._current; KP.armAlert(t.vm, n); }
        setCurrent(t, d, n);
      },
      'setCurrent(Ljavax/microedition/lcdui/Alert;Ljavax/microedition/lcdui/Displayable;)V': (t, [d, a, n]) => { a._next = n; KP.armAlert(t.vm, a); setCurrent(t, d, a); },
      'setCurrentItem(Ljavax/microedition/lcdui/Item;)V': () => {},
      'isColor()Z': () => 1,
      'numColors()I': () => 16777216,
      'numAlphaLevels()I': () => 256,
      'vibrate(I)Z': (t, [d, ms]) => { if (t.vm.host.vibrate) t.vm.host.vibrate(ms); return 1; },
      'flashBacklight(I)Z': () => 1,
      'callSerially(Ljava/lang/Runnable;)V': (t, [d, r]) => post(t.vm, { type: 'serial', r }),
      'getColor(I)I': (t, [d, w]) => [0xffffff, 0x000000, 0x1e88e5, 0xffffff, 0x000000, 0x1e88e5][w] || 0,
      'getBorderStyle(Z)I': () => 0,
      'getBestImageWidth(I)I': () => 16,
      'getBestImageHeight(I)I': () => 16,
    },
  });

  def(P + 'Displayable', {
    methods: {
      '<init>()V': (t, [o]) => { o._cmds = []; o._listener = null; o._title = null; },
      'addCommand(Ljavax/microedition/lcdui/Command;)V': (t, [o, c]) => {
        if (c === null) thr(t, 'java/lang/NullPointerException');
        o._cmds = o._cmds || [];
        if (o._cmds.indexOf(c) < 0) o._cmds.push(c);
        if (t.vm.display && t.vm.display._current === o) updateSoftLabels(t.vm);
      },
      'removeCommand(Ljavax/microedition/lcdui/Command;)V': (t, [o, c]) => {
        o._cmds = (o._cmds || []).filter((x) => x !== c);
        if (t.vm.display && t.vm.display._current === o) updateSoftLabels(t.vm);
      },
      'setCommandListener(Ljavax/microedition/lcdui/CommandListener;)V': (t, [o, l]) => { o._listener = l; },
      'getWidth()I': (t) => t.vm.host.screen.w,
      'getHeight()I': (t) => t.vm.host.screen.h,
      'isShown()Z': (t, [o]) => !!o._shown,
      'setTitle(Ljava/lang/String;)V': (t, [o, s]) => { o._title = s; if (o._shown) { display(t.vm)._repaint = true; t.vm.wakeup(); } },
      'getTitle()Ljava/lang/String;': (t, [o]) => o._title || null,
      'setTicker(Ljavax/microedition/lcdui/Ticker;)V': (t, [o, k]) => { o._ticker = k; },
      'getTicker()Ljavax/microedition/lcdui/Ticker;': (t, [o]) => o._ticker || null,
      'sizeChanged(II)V': () => {},
    },
  });

  // ---------- Canvas ----------
  const KEY = { UP: -1, DOWN: -2, LEFT: -3, RIGHT: -4, FIRE: -5 };
  KP.KEY = KEY;
  function gameActionOf(code) {
    switch (code) {
      case -1: case 50: return 1;  // UP
      case -2: case 56: return 6;  // DOWN
      case -3: case 52: return 2;  // LEFT
      case -4: case 54: return 5;  // RIGHT
      case -5: case 53: return 8;  // FIRE
      case 49: return 9; case 51: return 10; case 55: return 11; case 57: return 12; // GAME_A..D
      default: return 0;
    }
  }
  KP.gameActionOf = gameActionOf;
  KP.updateKeyStates = function (cv, code, kind) {
    const ga = gameActionOf(code);
    if (!ga) return;
    const bit = 1 << ga;
    cv._held = cv._held || 0;
    cv._latched = cv._latched || 0;
    if (kind === 'press') { cv._held |= bit; cv._latched |= bit; }
    else if (kind === 'release') cv._held &= ~bit;
  };

  def(P + 'Canvas', {
    super: P + 'Displayable',
    statics: {
      UP: ['I', 1], DOWN: ['I', 6], LEFT: ['I', 2], RIGHT: ['I', 5], FIRE: ['I', 8], GAME_A: ['I', 9], GAME_B: ['I', 10], GAME_C: ['I', 11], GAME_D: ['I', 12],
      KEY_NUM0: ['I', 48], KEY_NUM1: ['I', 49], KEY_NUM2: ['I', 50], KEY_NUM3: ['I', 51], KEY_NUM4: ['I', 52], KEY_NUM5: ['I', 53],
      KEY_NUM6: ['I', 54], KEY_NUM7: ['I', 55], KEY_NUM8: ['I', 56], KEY_NUM9: ['I', 57], KEY_STAR: ['I', 42], KEY_POUND: ['I', 35],
    },
    methods: {
      '<init>()V': (t, [o]) => { o._cmds = []; o._listener = null; o._full = false; o._held = 0; o._latched = 0; },
      'paint(Ljavax/microedition/lcdui/Graphics;)V': () => {},
      'repaint()V': (t, [o]) => { if (o._shown) { const d = display(t.vm); d._repaint = true; o._rx = null; t.vm.wakeup(); } },
      'repaint(IIII)V': (t, [o]) => { if (o._shown) { const d = display(t.vm); d._repaint = true; o._rx = null; t.vm.wakeup(); } },
      'serviceRepaints()V': function* (t, [o]) {
        const d = display(t.vm);
        if (d._repaint && !d._painting && d._current === o && o._shown) yield* paintCanvas(t, d, o);
      },
      'getGameAction(I)I': (t, [o, k]) => gameActionOf(k),
      'getKeyCode(I)I': (t, [o, a]) => ({ 1: -1, 6: -2, 2: -3, 5: -4, 8: -5, 9: 49, 10: 51, 11: 55, 12: 57 }[a] || 0),
      'getKeyName(I)Ljava/lang/String;': (t, [o, k]) => (k >= 48 && k <= 57 ? String.fromCharCode(k) : k === 42 ? '*' : k === 35 ? '#' : ({ '-1': 'Up', '-2': 'Down', '-3': 'Left', '-4': 'Right', '-5': 'Select', '-6': 'Soft1', '-7': 'Soft2', '-8': 'Clear' }[k] || 'Key' + k)),
      'hasPointerEvents()Z': (t) => (t.vm.host.touch ? 1 : 0),
      'hasPointerMotionEvents()Z': (t) => (t.vm.host.touch ? 1 : 0),
      'hasRepeatEvents()Z': () => 1,
      'isDoubleBuffered()Z': () => 1,
      'setFullScreenMode(Z)V': (t, [o, f]) => { o._full = !!f; if (t.vm.host.onFullScreen) t.vm.host.onFullScreen(o, !!f); },
      'keyPressed(I)V': () => {}, 'keyReleased(I)V': () => {}, 'keyRepeated(I)V': () => {},
      'pointerPressed(II)V': () => {}, 'pointerReleased(II)V': () => {}, 'pointerDragged(II)V': () => {},
      'showNotify()V': () => {}, 'hideNotify()V': () => {},
      'sizeChanged(II)V': () => {},
      'getWidth()I': (t) => t.vm.host.screen.w,
      'getHeight()I': (t) => t.vm.host.screen.h,
    },
  });

  // ---------- GameCanvas ----------
  def(P + 'game/GameCanvas', {
    super: P + 'Canvas',
    statics: { UP_PRESSED: ['I', 2], DOWN_PRESSED: ['I', 64], LEFT_PRESSED: ['I', 4], RIGHT_PRESSED: ['I', 32], FIRE_PRESSED: ['I', 256], GAME_A_PRESSED: ['I', 512], GAME_B_PRESSED: ['I', 1024], GAME_C_PRESSED: ['I', 2048], GAME_D_PRESSED: ['I', 4096] },
    methods: {
      '<init>(Z)V': (t, [o, suppress]) => {
        o._cmds = []; o._listener = null; o._held = 0; o._latched = 0;
        o._suppressKeys = !!suppress;
        const s = t.vm.host.screen;
        o._buf = KP.makeCanvas(s.w, s.h);
        const c = ctxOf(o._buf); c.fillStyle = '#ffffff'; c.fillRect(0, 0, s.w, s.h);
        o._bw = s.w; o._bh = s.h;
      },
      'getGraphics()Ljavax/microedition/lcdui/Graphics;': (t, [o]) => newGraphics(t.vm, o._buf, o._bw, o._bh, null),
      'getKeyStates()I': (t, [o]) => { const v = (o._held | o._latched) & ~1; o._latched = 0; return v; },
      'paint(Ljavax/microedition/lcdui/Graphics;)V': (t, [o, g]) => { prep(g).drawImage(o._buf, g._tx, g._ty); },
      'flushGraphics()V': (t, [o]) => flushGC(t, o, 0, 0, o._bw, o._bh),
      'flushGraphics(IIII)V': (t, [o, x, y, w, h]) => flushGC(t, o, x, y, w, h),
    },
  });
  function flushGC(t, o, x, y, w, h) {
    const vm = t.vm, host = vm.host;
    if (!o._shown || !host.screen) return;
    const d = display(vm);
    if (d._current !== o) return;
    const c = ctxOf(host.screen.canvas);
    c.restore(); c.save(); c.$clip = null;
    if (x === 0 && y === 0 && w >= o._bw && h >= o._bh) c.drawImage(o._buf, 0, 0);
    else if (w > 0 && h > 0) c.drawImage(o._buf, x, y, w, h, x, y, w, h);
    host.present();
  }

  KP.P = P;
})(globalThis.KP = globalThis.KP || {});
