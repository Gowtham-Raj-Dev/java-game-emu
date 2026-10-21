/* JavaPlay engine – javax.microedition.lcdui.game: Layer, Sprite, TiledLayer, LayerManager. */
(function (KP) {
  'use strict';
  const def = KP.native;
  const thr = (t, n, m) => t.vm.throwNew(n, m);
  const G = 'javax/microedition/lcdui/game/';

  // transformed point (MIDP RI semantics), frame size w x h
  function tx(x, y, tr, w, h) {
    switch (tr) {
      case 0: return x; case 2: return w - x - 1; case 5: return h - y - 1; case 3: return w - x - 1;
      case 6: return y; case 7: return h - y - 1; case 1: return x; case 4: return y;
    }
    return x;
  }
  function ty(x, y, tr, w, h) {
    switch (tr) {
      case 0: return y; case 2: return y; case 5: return x; case 3: return h - y - 1;
      case 6: return w - x - 1; case 7: return w - x - 1; case 1: return h - y - 1; case 4: return x;
    }
    return y;
  }
  const swaps = (tr) => tr === 5 || tr === 6 || tr === 7 || tr === 4;

  function layerInit(o) { o._x = 0; o._y = 0; o._visible = true; }
  def(G + 'Layer', {
    methods: {
      'getX()I': (t, [o]) => o._x, 'getY()I': (t, [o]) => o._y,
      'getWidth()I': (t, [o]) => o._w, 'getHeight()I': (t, [o]) => o._h,
      'setPosition(II)V': (t, [o, x, y]) => { o._x = x; o._y = y; },
      'move(II)V': (t, [o, dx, dy]) => { o._x += dx; o._y += dy; },
      'isVisible()Z': (t, [o]) => o._visible,
      'setVisible(Z)V': (t, [o, v]) => { o._visible = !!v; },
      'paint(Ljavax/microedition/lcdui/Graphics;)V': () => {},
    },
  });

  // ---------- Sprite ----------
  function setImage(o, im, fw, fh) {
    o._img = im; o._fw = fw; o._fh = fh;
    o._cols = Math.floor(im._w / fw);
    o._raw = o._cols * Math.floor(im._h / fh);
  }
  function updateSize(o) {
    const sw = swaps(o._tr);
    o._w = sw ? o._fh : o._fw;
    o._h = sw ? o._fw : o._fh;
  }
  function defaultSeq(o) { o._seq = null; o._si = 0; }
  function frameOf(o) { return o._seq ? o._seq[o._si] : o._si; }
  function seqLen(o) { return o._seq ? o._seq.length : o._raw; }

  function spriteInit(t, o, im, fw, fh) {
    if (im === null) thr(t, 'java/lang/NullPointerException');
    if (fw <= 0 || fh <= 0 || im._w % fw !== 0 || im._h % fh !== 0) thr(t, 'java/lang/IllegalArgumentException', 'bad frame size');
    layerInit(o);
    setImage(o, im, fw, fh);
    o._tr = 0; o._refX = 0; o._refY = 0;
    o._cx = 0; o._cy = 0; o._cw = fw; o._ch = fh;
    defaultSeq(o);
    updateSize(o);
  }

  function collisionRect(o) {
    // collision rectangle in screen coords after transform
    const fw = o._fw, fh = o._fh, tr = o._tr;
    const x1 = tx(o._cx, o._cy, tr, fw, fh), y1 = ty(o._cx, o._cy, tr, fw, fh);
    const x2 = tx(o._cx + o._cw - 1, o._cy + o._ch - 1, tr, fw, fh), y2 = ty(o._cx + o._cw - 1, o._cy + o._ch - 1, tr, fw, fh);
    const l = Math.min(x1, x2), tp = Math.min(y1, y2);
    return [o._x + l, o._y + tp, Math.abs(x2 - x1) + 1, Math.abs(y2 - y1) + 1];
  }

  // alpha mask of the current (transformed) frame, cached per image/frame/transform
  function spriteMask(o) {
    const key = frameOf(o) + ':' + o._tr;
    o._img._masks = o._img._masks || new Map();
    let m = o._img._masks.get(key);
    if (m) return m;
    const f = frameOf(o);
    const sx = (f % o._cols) * o._fw, sy = Math.floor(f / o._cols) * o._fh;
    const c = KP.makeCanvas(o._w, o._h);
    const ctx = KP.ctxOf(c);
    ctx.clearRect(0, 0, o._w, o._h);
    KP.drawRegionRaw(ctx, o._img._c, sx, sy, o._fw, o._fh, o._tr, 0, 0);
    const d = ctx.getImageData(0, 0, o._w, o._h).data;
    m = new Uint8Array(o._w * o._h);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 0 ? 1 : 0;
    m.w = o._w; m.h = o._h;
    o._img._masks.set(key, m);
    return m;
  }
  function imageMask(im) {
    if (im._mask) return im._mask;
    const d = KP.ctxOf(im._c).getImageData(0, 0, im._w, im._h).data;
    const m = new Uint8Array(im._w * im._h);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 0 ? 1 : 0;
    im._mask = m;
    return m;
  }
  function intersect(a, b) {
    const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
    const x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
    return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
  }
  function pixelHit(maskA, ax, ay, maskB, bx, by, r) {
    for (let y = r[1]; y < r[1] + r[3]; y++) {
      for (let x = r[0]; x < r[0] + r[2]; x++) {
        if (maskA[(y - ay) * maskA.w + (x - ax)] && maskB[(y - by) * maskB.w + (x - bx)]) return true;
      }
    }
    return false;
  }

  def(G + 'Sprite', {
    super: G + 'Layer',
    statics: { TRANS_NONE: ['I', 0], TRANS_ROT90: ['I', 5], TRANS_ROT180: ['I', 3], TRANS_ROT270: ['I', 6], TRANS_MIRROR: ['I', 2], TRANS_MIRROR_ROT90: ['I', 7], TRANS_MIRROR_ROT180: ['I', 1], TRANS_MIRROR_ROT270: ['I', 4] },
    methods: {
      '<init>(Ljavax/microedition/lcdui/Image;)V': (t, [o, im]) => spriteInit(t, o, im, im ? im._w : 1, im ? im._h : 1),
      '<init>(Ljavax/microedition/lcdui/Image;II)V': (t, [o, im, fw, fh]) => spriteInit(t, o, im, fw, fh),
      '<init>(Ljavax/microedition/lcdui/game/Sprite;)V': (t, [o, s]) => {
        if (s === null) thr(t, 'java/lang/NullPointerException');
        for (const k of ['_x', '_y', '_visible', '_img', '_fw', '_fh', '_cols', '_raw', '_tr', '_refX', '_refY', '_cx', '_cy', '_cw', '_ch', '_si', '_w', '_h']) o[k] = s[k];
        o._seq = s._seq ? s._seq.slice() : null;
      },
      'setFrame(I)V': (t, [o, i]) => { if (i < 0 || i >= seqLen(o)) thr(t, 'java/lang/IndexOutOfBoundsException'); o._si = i; },
      'getFrame()I': (t, [o]) => o._si,
      'getRawFrameCount()I': (t, [o]) => o._raw,
      'getFrameSequenceLength()I': (t, [o]) => seqLen(o),
      'nextFrame()V': (t, [o]) => { o._si = (o._si + 1) % seqLen(o); },
      'prevFrame()V': (t, [o]) => { o._si = (o._si - 1 + seqLen(o)) % seqLen(o); },
      'setFrameSequence([I)V': (t, [o, seq]) => {
        if (seq === null) { defaultSeq(o); return; }
        if (!seq.length) thr(t, 'java/lang/IllegalArgumentException');
        for (const f of seq) if (f < 0 || f >= o._raw) thr(t, 'java/lang/ArrayIndexOutOfBoundsException');
        o._seq = Array.from(seq); o._si = 0;
      },
      'setImage(Ljavax/microedition/lcdui/Image;II)V': (t, [o, im, fw, fh]) => {
        const oldRaw = o._raw;
        const rx = o._x + tx(o._refX, o._refY, o._tr, o._fw, o._fh), ry = o._y + ty(o._refX, o._refY, o._tr, o._fw, o._fh);
        setImage(o, im, fw, fh);
        if (o._raw < oldRaw) defaultSeq(o);
        o._cx = 0; o._cy = 0; o._cw = fw; o._ch = fh;
        updateSize(o);
        o._x = rx - tx(o._refX, o._refY, o._tr, fw, fh); o._y = ry - ty(o._refX, o._refY, o._tr, fw, fh);
      },
      'defineReferencePixel(II)V': (t, [o, x, y]) => { o._refX = x; o._refY = y; },
      'setRefPixelPosition(II)V': (t, [o, x, y]) => { o._x = x - tx(o._refX, o._refY, o._tr, o._fw, o._fh); o._y = y - ty(o._refX, o._refY, o._tr, o._fw, o._fh); },
      'getRefPixelX()I': (t, [o]) => o._x + tx(o._refX, o._refY, o._tr, o._fw, o._fh),
      'getRefPixelY()I': (t, [o]) => o._y + ty(o._refX, o._refY, o._tr, o._fw, o._fh),
      'setTransform(I)V': (t, [o, tr]) => {
        const rx = o._x + tx(o._refX, o._refY, o._tr, o._fw, o._fh), ry = o._y + ty(o._refX, o._refY, o._tr, o._fw, o._fh);
        o._tr = tr; updateSize(o);
        o._x = rx - tx(o._refX, o._refY, tr, o._fw, o._fh); o._y = ry - ty(o._refX, o._refY, tr, o._fw, o._fh);
      },
      'defineCollisionRectangle(IIII)V': (t, [o, x, y, w, h]) => { if (w < 0 || h < 0) thr(t, 'java/lang/IllegalArgumentException'); o._cx = x; o._cy = y; o._cw = w; o._ch = h; },
      'collidesWith(Ljavax/microedition/lcdui/game/Sprite;Z)Z': (t, [o, s, px]) => {
        if (s === null) thr(t, 'java/lang/NullPointerException');
        if (!o._visible || !s._visible) return false;
        const r = intersect(collisionRect(o), collisionRect(s));
        if (!r) return false;
        if (!px) return true;
        return pixelHit(spriteMask(o), o._x, o._y, spriteMask(s), s._x, s._y, r);
      },
      'collidesWith(Ljavax/microedition/lcdui/game/TiledLayer;Z)Z': (t, [o, tl, px]) => {
        if (tl === null) thr(t, 'java/lang/NullPointerException');
        if (!o._visible || !tl._visible) return false;
        const r = intersect(collisionRect(o), [tl._x, tl._y, tl._w, tl._h]);
        if (!r) return false;
        const c0 = Math.floor((r[0] - tl._x) / tl._tw), c1 = Math.floor((r[0] + r[2] - 1 - tl._x) / tl._tw);
        const r0 = Math.floor((r[1] - tl._y) / tl._th), r1 = Math.floor((r[1] + r[3] - 1 - tl._y) / tl._th);
        const mask = px ? spriteMask(o) : null;
        for (let row = r0; row <= r1; row++) {
          for (let col = c0; col <= c1; col++) {
            let tile = tl._cells[row * tl._cols + col];
            if (tile < 0) tile = tl._anim[-tile - 1];
            if (!tile) continue;
            const cr = intersect(r, [tl._x + col * tl._tw, tl._y + row * tl._th, tl._tw, tl._th]);
            if (!cr) continue;
            if (!px) return true;
            const tm = imageMask(tl._img);
            const tsx = ((tile - 1) % tl._tcols) * tl._tw, tsy = Math.floor((tile - 1) / tl._tcols) * tl._th;
            for (let y = cr[1]; y < cr[1] + cr[3]; y++) {
              for (let x = cr[0]; x < cr[0] + cr[2]; x++) {
                if (!mask[(y - o._y) * mask.w + (x - o._x)]) continue;
                const ix = tsx + (x - tl._x - col * tl._tw), iy = tsy + (y - tl._y - row * tl._th);
                if (tm[iy * tl._img._w + ix]) return true;
              }
            }
          }
        }
        return false;
      },
      'collidesWith(Ljavax/microedition/lcdui/Image;IIZ)Z': (t, [o, im, x, y, px]) => {
        if (im === null) thr(t, 'java/lang/NullPointerException');
        if (!o._visible) return false;
        const r = intersect(collisionRect(o), [x, y, im._w, im._h]);
        if (!r) return false;
        if (!px) return true;
        const m = imageMask(im); m.w = im._w;
        return pixelHit(spriteMask(o), o._x, o._y, m, x, y, r);
      },
      'paint(Ljavax/microedition/lcdui/Graphics;)V': (t, [o, g]) => {
        if (g === null) thr(t, 'java/lang/NullPointerException');
        if (!o._visible) return;
        const f = frameOf(o);
        const sx = (f % o._cols) * o._fw, sy = Math.floor(f / o._cols) * o._fh;
        KP.drawRegionRaw(KP.gPrep(g), o._img._c, sx, sy, o._fw, o._fh, o._tr, o._x + g._tx, o._y + g._ty);
      },
    },
  });

  // ---------- TiledLayer ----------
  def(G + 'TiledLayer', {
    super: G + 'Layer',
    methods: {
      '<init>(IILjavax/microedition/lcdui/Image;II)V': (t, [o, cols, rows, im, tw, th]) => {
        if (im === null) thr(t, 'java/lang/NullPointerException');
        if (cols <= 0 || rows <= 0 || tw <= 0 || th <= 0 || im._w % tw || im._h % th) thr(t, 'java/lang/IllegalArgumentException');
        layerInit(o);
        o._cols = cols; o._rows = rows; o._tw = tw; o._th = th;
        o._cells = new Int32Array(cols * rows);
        o._anim = [];
        o._img = im; o._tcols = im._w / tw; o._tcount = o._tcols * (im._h / th);
        o._w = cols * tw; o._h = rows * th;
      },
      'setCell(III)V': (t, [o, c, r, v]) => {
        if (c < 0 || c >= o._cols || r < 0 || r >= o._rows) thr(t, 'java/lang/IndexOutOfBoundsException');
        o._cells[r * o._cols + c] = v;
      },
      'getCell(II)I': (t, [o, c, r]) => {
        if (c < 0 || c >= o._cols || r < 0 || r >= o._rows) thr(t, 'java/lang/IndexOutOfBoundsException');
        return o._cells[r * o._cols + c];
      },
      'fillCells(IIIII)V': (t, [o, c, r, nc, nr, v]) => {
        if (nc < 0 || nr < 0 || c < 0 || r < 0 || c + nc > o._cols || r + nr > o._rows) thr(t, 'java/lang/IndexOutOfBoundsException');
        for (let y = r; y < r + nr; y++) for (let x = c; x < c + nc; x++) o._cells[y * o._cols + x] = v;
      },
      'createAnimatedTile(I)I': (t, [o, v]) => { o._anim.push(v); return -o._anim.length; },
      'setAnimatedTile(II)V': (t, [o, i, v]) => { if (-i - 1 >= o._anim.length || i >= 0) thr(t, 'java/lang/IndexOutOfBoundsException'); o._anim[-i - 1] = v; },
      'getAnimatedTile(I)I': (t, [o, i]) => { if (-i - 1 >= o._anim.length || i >= 0) thr(t, 'java/lang/IndexOutOfBoundsException'); return o._anim[-i - 1]; },
      'setStaticTileSet(Ljavax/microedition/lcdui/Image;II)V': (t, [o, im, tw, th]) => {
        const n = (im._w / tw) * (im._h / th);
        o._img = im; o._tw = tw; o._th = th; o._tcols = im._w / tw;
        if (n < o._tcount) { o._cells.fill(0); o._anim = []; }
        o._tcount = n;
        o._w = o._cols * tw; o._h = o._rows * th;
      },
      'getCellWidth()I': (t, [o]) => o._tw,
      'getCellHeight()I': (t, [o]) => o._th,
      'getColumns()I': (t, [o]) => o._cols,
      'getRows()I': (t, [o]) => o._rows,
      'paint(Ljavax/microedition/lcdui/Graphics;)V': (t, [o, g]) => {
        if (!o._visible) return;
        const c = KP.gPrep(g);
        const ox = o._x + g._tx, oy = o._y + g._ty;
        const c0 = Math.max(0, Math.floor((g._cx - ox) / o._tw)), c1 = Math.min(o._cols - 1, Math.floor((g._cx + g._cw - 1 - ox) / o._tw));
        const r0 = Math.max(0, Math.floor((g._cy - oy) / o._th)), r1 = Math.min(o._rows - 1, Math.floor((g._cy + g._ch - 1 - oy) / o._th));
        const src = o._img._c;
        for (let r = r0; r <= r1; r++) {
          for (let col = c0; col <= c1; col++) {
            let tile = o._cells[r * o._cols + col];
            if (tile < 0) tile = o._anim[-tile - 1] || 0;
            if (!tile) continue;
            const sx = ((tile - 1) % o._tcols) * o._tw, sy = Math.floor((tile - 1) / o._tcols) * o._th;
            c.drawImage(src, sx, sy, o._tw, o._th, ox + col * o._tw, oy + r * o._th, o._tw, o._th);
          }
        }
      },
    },
  });

  // ---------- LayerManager ----------
  def(G + 'LayerManager', {
    methods: {
      '<init>()V': (t, [o]) => { o._layers = []; o._vx = 0; o._vy = 0; o._vw = 0x7fffffff; o._vh = 0x7fffffff; },
      'append(Ljavax/microedition/lcdui/game/Layer;)V': (t, [o, l]) => { if (l === null) thr(t, 'java/lang/NullPointerException'); o._layers = o._layers.filter((x) => x !== l); o._layers.push(l); },
      'insert(Ljavax/microedition/lcdui/game/Layer;I)V': (t, [o, l, i]) => {
        if (l === null) thr(t, 'java/lang/NullPointerException');
        o._layers = o._layers.filter((x) => x !== l);
        if (i < 0 || i > o._layers.length) thr(t, 'java/lang/IndexOutOfBoundsException');
        o._layers.splice(i, 0, l);
      },
      'remove(Ljavax/microedition/lcdui/game/Layer;)V': (t, [o, l]) => { o._layers = o._layers.filter((x) => x !== l); },
      'getLayerAt(I)Ljavax/microedition/lcdui/game/Layer;': (t, [o, i]) => { if (i < 0 || i >= o._layers.length) thr(t, 'java/lang/IndexOutOfBoundsException'); return o._layers[i]; },
      'getSize()I': (t, [o]) => o._layers.length,
      'setViewWindow(IIII)V': (t, [o, x, y, w, h]) => { o._vx = x; o._vy = y; o._vw = w; o._vh = h; },
      'paint(Ljavax/microedition/lcdui/Graphics;II)V': function* (t, [o, g, x, y]) {
        if (g === null) thr(t, 'java/lang/NullPointerException');
        const vm = t.vm;
        const save = [g._tx, g._ty, g._cx, g._cy, g._cw, g._ch, g._clipKey];
        // clip to view window placed at (x,y), then translate so the window origin lands there
        const gm = vm.loadClass('javax/microedition/lcdui/Graphics').methods;
        gm.get('clipRect(IIII)V').fn(t, [g, x, y, Math.min(o._vw, 0x3fffffff), Math.min(o._vh, 0x3fffffff)]);
        g._tx += x - o._vx; g._ty += y - o._vy;
        try {
          for (let i = o._layers.length - 1; i >= 0; i--) {
            const l = o._layers[i];
            if (!l._visible) continue;
            const m = vm.findVirtual(l, 'paint(Ljavax/microedition/lcdui/Graphics;)V');
            if (m.fn && !m.isGen) m.fn(t, [l, g]);
            else yield { invoke: m, args: [l, g] };
          }
        } finally {
          [g._tx, g._ty, g._cx, g._cy, g._cw, g._ch] = save;
          g._clipKey = 'c' + (++vm.idHash);
        }
      },
    },
  });
})(globalThis.KP = globalThis.KP || {});
