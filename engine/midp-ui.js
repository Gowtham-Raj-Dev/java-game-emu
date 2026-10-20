/* KeyPlay engine – MIDP high-level UI (List, Form, Alert, TextBox, Items), rendered phone-style into the screen. */
(function (KP) {
  'use strict';
  const def = KP.native;
  const S_ = (f) => Object.assign(f, { isStatic: true });
  const thr = (t, n, m) => t.vm.throwNew(n, m);
  const P = 'javax/microedition/lcdui/';

  const C = { bg: '#f4f6fa', title: '#1d2533', titleFg: '#ffffff', fg: '#1d2533', sub: '#5b6577', sel: '#ff8a1f', selFg: '#1a1206', line: '#d9dee8', bar: '#1d2533' };

  function repaint(vm) { const d = KP.display(vm); d._repaint = true; vm.wakeup(); }

  // ---------- painting ----------
  function wrapText(f, text, width) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const cand = line ? line + ' ' + word : word;
        if (KP.textWidth(f, cand) <= width || !line) {
          if (KP.textWidth(f, cand) > width && !line) {
            // break long word
            let part = '';
            for (const ch of word) { if (KP.textWidth(f, part + ch) > width && part) { lines.push(part); part = ''; } part += ch; }
            line = part;
          } else line = cand;
        } else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  }

  KP.paintScreen = function (vm, s) {
    const host = vm.host;
    if (!host.screen) return;
    const W = host.screen.w, H = host.screen.h;
    const c = KP.ctxOf(host.screen.canvas);
    c.restore(); c.save(); c.$clip = null;
    const f = KP.makeFont(vm, 0, 0, 0), fb = KP.makeFont(vm, 0, 1, 0), fs = KP.makeFont(vm, 0, 0, 8);
    c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
    const pad = Math.max(3, Math.round(W / 40));
    // title
    let y = 0;
    const title = s._screen === 'alert' ? (s._title || '') : s._title;
    if (title) {
      const th = fb._height + pad;
      c.fillStyle = C.title; c.fillRect(0, 0, W, th);
      c.fillStyle = C.titleFg; c.font = fb._css; c.textBaseline = 'alphabetic';
      c.fillText(title, pad, Math.round(pad / 2) + fb._ascent, W - pad * 2);
      y = th;
    }
    // soft bar
    const barH = fs._height + pad;
    const [l, r] = KP.softCommands(s._cmds || []);
    let ll = l ? (Array.isArray(l) ? 'Options' : l._label) : '';
    const rl = r ? r._label : '';
    if (s._screen === 'list' && s._listType === 3 && !ll && s._items.length) ll = 'Select';
    if (s._screen === 'textbox' && !ll) ll = 'Edit';
    const top = y, bottom = H - barH;
    c.save();
    c.beginPath(); c.rect(0, top, W, bottom - top); c.clip();
    if (s._screen === 'list') paintList(vm, c, s, top, bottom, W, f, pad);
    else if (s._screen === 'form') paintForm(vm, c, s, top, bottom, W, f, fb, pad);
    else if (s._screen === 'alert') paintAlert(vm, c, s, top, bottom, W, f, pad);
    else if (s._screen === 'textbox') paintTextBox(vm, c, s, top, bottom, W, f, pad);
    c.restore();
    c.fillStyle = C.bar; c.fillRect(0, bottom, W, barH);
    c.fillStyle = C.titleFg; c.font = fs._css;
    c.fillText(ll, pad, bottom + Math.round(pad / 2) + fs._ascent, W / 2 - pad);
    const rw = KP.textWidth(fs, rl);
    c.fillText(rl, W - pad - rw, bottom + Math.round(pad / 2) + fs._ascent);
    host.present();
  };

  function paintList(vm, c, s, top, bottom, W, f, pad) {
    const rowH = Math.max(f._height + pad, 18);
    const n = s._items.length;
    const visible = Math.max(1, Math.floor((bottom - top) / rowH));
    if (s._focus < s._scroll) s._scroll = s._focus;
    if (s._focus >= s._scroll + visible) s._scroll = s._focus - visible + 1;
    let y = top;
    for (let i = s._scroll; i < n && y < bottom; i++, y += rowH) {
      const it = s._items[i];
      const focused = i === s._focus;
      if (focused) { c.fillStyle = C.sel; c.fillRect(0, y, W, rowH); }
      let x = pad;
      if (s._listType === 1 || s._listType === 2) {
        const bx = rowH * 0.28, bs = rowH * 0.44;
        c.strokeStyle = focused ? C.selFg : C.sub; c.lineWidth = 1.5;
        c.beginPath();
        if (s._listType === 1) c.arc(x + bs / 2, y + rowH / 2, bs / 2, 0, Math.PI * 2); else c.rect(x, y + bx, bs, bs);
        c.stroke();
        if (it.sel) { c.fillStyle = focused ? C.selFg : C.fg; c.beginPath(); if (s._listType === 1) c.arc(x + bs / 2, y + rowH / 2, bs / 4, 0, Math.PI * 2); else c.rect(x + 3, y + bx + 3, bs - 6, bs - 6); c.fill(); }
        x += bs + pad;
      }
      if (it.img) { c.drawImage(it.img._c, x, y + Math.round((rowH - it.img._h) / 2)); x += it.img._w + pad; }
      c.fillStyle = focused ? C.selFg : C.fg; c.font = f._css; c.textBaseline = 'alphabetic';
      c.fillText(it.str, x, y + Math.round((rowH - f._height) / 2) + f._ascent);
    }
  }

  function itemHeight(vm, it, W, f, fb, pad) {
    const lab = it._label ? f._height : 0;
    switch (it._kind) {
      case 'string': return lab + wrapText(it._font || f, it._text || '', W - pad * 2).length * f._height + 2;
      case 'image': return lab + (it._img ? it._img._h + 2 : 0);
      case 'text': return lab + f._height + pad + 2;
      case 'gauge': return lab + 14;
      case 'choice': return lab + it._items.length * (f._height + 2) + 2;
      case 'spacer': return it._h || 4;
      default: return lab + f._height;
    }
  }

  function paintForm(vm, c, s, top, bottom, W, f, fb, pad) {
    // compute layout
    let y = top + pad - s._scrollY;
    s._layout = [];
    c.textBaseline = 'alphabetic';
    for (let i = 0; i < s._items.length; i++) {
      const it = s._items[i];
      const h = itemHeight(vm, it, W, f, fb, pad);
      s._layout.push({ y: y + s._scrollY, h });
      const focused = i === s._focus && isInteractive(it);
      if (focused) { c.fillStyle = 'rgba(255,138,31,0.18)'; c.fillRect(0, y - 2, W, h + 4); }
      let yy = y;
      if (it._label) { c.font = fb._css; c.fillStyle = C.sub; c.fillText(it._label, pad, yy + fb._ascent); yy += f._height; }
      c.font = (it._font || f)._css; c.fillStyle = C.fg;
      switch (it._kind) {
        case 'string':
          for (const line of wrapText(it._font || f, it._text || '', W - pad * 2)) { c.fillText(line, pad, yy + f._ascent); yy += f._height; }
          break;
        case 'image':
          if (it._img) { let x = pad; if (it._layout & 3) x = (W - it._img._w) >> 1; c.drawImage(it._img._c, x, yy); }
          break;
        case 'text': {
          c.strokeStyle = focused ? C.sel : C.line; c.lineWidth = 1; c.strokeRect(pad + 0.5, yy + 0.5, W - pad * 2, f._height + pad - 2);
          const txt = (it._constraints & 0x10000) ? '*'.repeat((it._text || '').length) : (it._text || '');
          c.fillStyle = C.fg; c.fillText(txt, pad + 3, yy + Math.round((pad - 2) / 2) + f._ascent, W - pad * 2 - 6);
          break;
        }
        case 'gauge': {
          const gw = W - pad * 2;
          c.fillStyle = C.line; c.fillRect(pad, yy + 3, gw, 8);
          c.fillStyle = C.sel; c.fillRect(pad, yy + 3, it._max > 0 ? Math.round(gw * it._value / it._max) : 0, 8);
          break;
        }
        case 'choice':
          it._items.forEach((e, k) => {
            const fy = yy + k * (f._height + 2);
            const foc = focused && k === it._focus;
            if (foc) { c.fillStyle = C.sel; c.fillRect(pad, fy, W - pad * 2, f._height + 2); }
            c.fillStyle = foc ? C.selFg : C.fg;
            const mark = it._type === 2 ? (e.sel ? '[x] ' : '[ ] ') : (e.sel ? '(o) ' : '( ) ');
            c.fillText(mark + e.str, pad + 2, fy + 1 + f._ascent);
          });
          break;
      }
      y += h + pad;
    }
    s._contentH = y + s._scrollY - top;
  }

  function paintAlert(vm, c, s, top, bottom, W, f, pad) {
    let y = top + pad;
    if (s._img) { c.drawImage(s._img._c, (W - s._img._w) >> 1, y); y += s._img._h + pad; }
    c.fillStyle = C.fg; c.font = f._css; c.textBaseline = 'alphabetic';
    for (const line of wrapText(f, s._text || '', W - pad * 2)) { c.fillText(line, pad, y + f._ascent); y += f._height; }
  }

  function paintTextBox(vm, c, s, top, bottom, W, f, pad) {
    c.strokeStyle = C.line; c.lineWidth = 1; c.strokeRect(pad + 0.5, top + pad + 0.5, W - pad * 2, bottom - top - pad * 2);
    c.fillStyle = C.fg; c.font = f._css; c.textBaseline = 'alphabetic';
    let y = top + pad * 2;
    for (const line of wrapText(f, s._text || '', W - pad * 4)) { c.fillText(line, pad * 2, y + f._ascent); y += f._height; }
  }

  function isInteractive(it) { return it._kind === 'text' || it._kind === 'choice' || (it._kind === 'gauge' && it._interactive) || (it._cmds && it._cmds.length); }

  // ---------- input ----------
  function* fireCommand(t, s, cmd, item) {
    const vm = t.vm;
    if (cmd === s._dismiss && s._screen === 'alert' && !s._listener) { dismissAlert(t, s); return; }
    const listener = item ? item._itemListener : s._listener;
    if (!listener) { if (s._screen === 'alert') dismissAlert(t, s); return; }
    const key = item ? 'commandAction(Ljavax/microedition/lcdui/Command;Ljavax/microedition/lcdui/Item;)V' : 'commandAction(Ljavax/microedition/lcdui/Command;Ljavax/microedition/lcdui/Displayable;)V';
    yield { invoke: vm.findVirtual(listener, key), args: [listener, cmd, item || s] };
  }

  function* stateChanged(t, s, item) {
    if (!s._stateListener) return;
    yield { invoke: t.vm.findVirtual(s._stateListener, 'itemStateChanged(Ljavax/microedition/lcdui/Item;)V'), args: [s._stateListener, item] };
  }

  function editText(t, target, title, onDone) {
    const vm = t.vm;
    if (!vm.host.textInput) return;
    vm.host.textInput(title || '', target._text || '', target._max || 256, (txt) => {
      if (txt === null) return;
      target._text = txt.substring(0, target._max || 256);
      KP.postEvent(vm, { type: 'call', fn: () => { repaint(vm); if (onDone) onDone(); } });
    });
  }

  KP.screenKey = function* (t, s, code) {
    const vm = t.vm;
    const ga = KP.gameActionOf(code);
    if (code === -6 || code === -7) {
      const [l, r] = KP.softCommands(s._cmds || []);
      let pick = code === -6 ? l : r;
      if (!pick && code === -6) {
        if (s._screen === 'list' && s._listType === 3) pick = s._selectCmd;
        else if (s._screen === 'textbox') { editText(t, s, s._title); return; }
      }
      if (!pick) return;
      if (Array.isArray(pick)) {
        if (vm.host.showMenu) vm.host.showMenu(pick.map((c) => c._label), (i) => { if (i >= 0) KP.postEvent(vm, { type: 'command', listener: s._listener, cmd: pick[i], disp: s }); });
        return;
      }
      yield* fireCommand(t, s, pick, null);
      return;
    }
    if (s._screen === 'list') {
      const n = s._items.length;
      if (!n) return;
      if (ga === 1) s._focus = (s._focus - 1 + n) % n;
      else if (ga === 6) s._focus = (s._focus + 1) % n;
      else if (ga === 8) {
        if (s._listType === 3) { s._items.forEach((it, i) => { it.sel = i === s._focus; }); if (s._selectCmd) yield* fireCommand(t, s, s._selectCmd, null); }
        else if (s._listType === 1 || s._listType === 4) s._items.forEach((it, i) => { it.sel = i === s._focus; });
        else s._items[s._focus].sel = !s._items[s._focus].sel;
      }
      if (s._listType === 3) s._items.forEach((it, i) => { it.sel = i === s._focus; });
      repaint(vm);
    } else if (s._screen === 'form') {
      const inter = s._items.map((it, i) => (isInteractive(it) ? i : -1)).filter((i) => i >= 0);
      const it = s._items[s._focus];
      if (ga === 1 || ga === 6) {
        if (it && it._kind === 'choice' && ((ga === 6 && it._focus < it._items.length - 1) || (ga === 1 && it._focus > 0))) { it._focus += ga === 6 ? 1 : -1; repaint(vm); return; }
        const pos = inter.indexOf(s._focus);
        if (inter.length && ((ga === 6 && pos < inter.length - 1) || (ga === 1 && pos > 0))) {
          s._focus = inter[pos + (ga === 6 ? 1 : -1)];
          const nit = s._items[s._focus];
          if (nit._kind === 'choice') nit._focus = ga === 6 ? 0 : nit._items.length - 1;
        } else s._scrollY = Math.max(0, s._scrollY + (ga === 6 ? 20 : -20));
        // keep focused item visible
        const L = s._layout && s._layout[s._focus];
        if (L) {
          const H = vm.host.screen.h;
          if (L.y - s._scrollY > H * 0.7) s._scrollY = L.y - H * 0.4;
          if (L.y - s._scrollY < 20) s._scrollY = Math.max(0, L.y - 30);
        }
        repaint(vm);
      } else if (it && (ga === 2 || ga === 5) && it._kind === 'gauge' && it._interactive) {
        it._value = Math.max(0, Math.min(it._max, it._value + (ga === 5 ? 1 : -1)));
        repaint(vm); yield* stateChanged(t, s, it);
      } else if (it && ga === 8) {
        if (it._kind === 'text') editText(t, it, it._label, () => KP.postEvent(vm, { type: 'call', fn: () => {} }));
        else if (it._kind === 'choice') {
          const e = it._items[it._focus];
          if (it._type === 2) e.sel = !e.sel; else it._items.forEach((x, k) => { x.sel = k === it._focus; });
          repaint(vm); yield* stateChanged(t, s, it);
        } else if (it._defaultCmd) yield* fireCommand(t, s, it._defaultCmd, it);
      }
    } else if (s._screen === 'alert') {
      if (ga === 8) dismissAlert(t, s);
    } else if (s._screen === 'textbox') {
      if (ga === 8) editText(t, s, s._title);
    }
  };

  KP.screenPointer = function* (t, s, x, y) {
    const vm = t.vm;
    if (s._screen === 'list') {
      const f = KP.makeFont(vm, 0, 0, 0);
      const pad = Math.max(3, Math.round(vm.host.screen.w / 40));
      const rowH = Math.max(f._height + pad, 18);
      const top = s._title ? KP.makeFont(vm, 0, 1, 0)._height + pad : 0;
      const i = s._scroll + Math.floor((y - top) / rowH);
      if (i >= 0 && i < s._items.length) { s._focus = i; yield* KP.screenKey(t, s, -5); }
    } else if (s._screen === 'alert') dismissAlert(t, s);
    else yield* KP.screenKey(t, s, -5);
  };

  function dismissAlert(t, a) {
    const d = KP.display(t.vm);
    if (d._current !== a) return;
    KP.setCurrent(t, d, a._next || null);
  }

  KP.armAlert = function (vm, a) {
    if (a._timer) clearTimeout(a._timer);
    if (a._timeout > 0 && !(a._cmds && a._cmds.length > (a._dismiss ? 1 : 0))) {
      a._timer = setTimeout(() => {
        KP.postEvent(vm, { type: 'call', fn: () => { const d = KP.display(vm); if (d._current === a) KP.setCurrent({ vm }, d, a._next || null); } });
      }, a._timeout);
    }
  };

  // ---------- classes ----------
  def(P + 'Screen', { super: P + 'Displayable', methods: {} });
  def(P + 'Choice', { isInterface: true, statics: { EXCLUSIVE: ['I', 1], MULTIPLE: ['I', 2], IMPLICIT: ['I', 3], POPUP: ['I', 4], TEXT_WRAP_DEFAULT: ['I', 0], TEXT_WRAP_ON: ['I', 1], TEXT_WRAP_OFF: ['I', 2] }, methods: {} });
  def(P + 'ItemStateListener', { isInterface: true, methods: {} });
  def(P + 'ItemCommandListener', { isInterface: true, methods: {} });

  const choiceMethods = (getItems) => ({
    'append(Ljava/lang/String;Ljavax/microedition/lcdui/Image;)I': (t, [o, s, im]) => {
      if (s === null) thr(t, 'java/lang/NullPointerException');
      const items = getItems(o);
      items.push({ str: s, img: im, sel: false });
      if (items.length === 1 && o._type !== 2 && o._listType !== 2) items[0].sel = true;
      repaint(t.vm); return items.length - 1;
    },
    'insert(ILjava/lang/String;Ljavax/microedition/lcdui/Image;)V': (t, [o, i, s, im]) => { getItems(o).splice(i, 0, { str: s, img: im, sel: false }); repaint(t.vm); },
    'set(ILjava/lang/String;Ljavax/microedition/lcdui/Image;)V': (t, [o, i, s, im]) => { const e = getItems(o)[i]; if (!e) thr(t, 'java/lang/IndexOutOfBoundsException'); e.str = s; e.img = im; repaint(t.vm); },
    'delete(I)V': (t, [o, i]) => { const items = getItems(o); if (i < 0 || i >= items.length) thr(t, 'java/lang/IndexOutOfBoundsException'); items.splice(i, 1); if (o._focus >= items.length) o._focus = Math.max(0, items.length - 1); repaint(t.vm); },
    'deleteAll()V': (t, [o]) => { getItems(o).length = 0; o._focus = 0; o._scroll = 0; repaint(t.vm); },
    'getString(I)Ljava/lang/String;': (t, [o, i]) => { const e = getItems(o)[i]; if (!e) thr(t, 'java/lang/IndexOutOfBoundsException'); return e.str; },
    'getImage(I)Ljavax/microedition/lcdui/Image;': (t, [o, i]) => { const e = getItems(o)[i]; return e ? e.img : null; },
    'size()I': (t, [o]) => getItems(o).length,
    'getSelectedIndex()I': (t, [o]) => {
      const items = getItems(o);
      if ((o._listType || o._type) === 2) return -1;
      if ((o._listType || o._type) === 3) return items.length ? o._focus : -1;
      return items.findIndex((e) => e.sel);
    },
    'setSelectedIndex(IZ)V': (t, [o, i, v]) => {
      const items = getItems(o);
      if (i < 0 || i >= items.length) thr(t, 'java/lang/IndexOutOfBoundsException');
      const multi = (o._listType || o._type) === 2;
      if (multi) items[i].sel = !!v;
      else if (v) { items.forEach((e, k) => { e.sel = k === i; }); o._focus = i; }
      repaint(t.vm);
    },
    'isSelected(I)Z': (t, [o, i]) => { const e = getItems(o)[i]; if (!e) thr(t, 'java/lang/IndexOutOfBoundsException'); return ((o._listType || o._type) === 3 ? i === o._focus : e.sel); },
    'getSelectedFlags([Z)I': (t, [o, a]) => { let n = 0; getItems(o).forEach((e, i) => { a[i] = e.sel ? 1 : 0; if (e.sel) n++; }); return n; },
    'setSelectedFlags([Z)V': (t, [o, a]) => { getItems(o).forEach((e, i) => { e.sel = !!a[i]; }); repaint(t.vm); },
    'setFitPolicy(I)V': () => {}, 'getFitPolicy()I': () => 0,
    'setFont(ILjavax/microedition/lcdui/Font;)V': () => {},
    'getFont(I)Ljavax/microedition/lcdui/Font;': (t) => KP.makeFont(t.vm, 0, 0, 0),
  });

  function initList(t, o, title, type, strs, imgs) {
    o._screen = 'list'; o._title = title; o._listType = type; o._cmds = []; o._listener = null;
    o._items = []; o._focus = 0; o._scroll = 0;
    o._selectCmd = t.vm.loadClass(P + 'List').statics[t.vm.loadClass(P + 'List').fieldsByName.get('SELECT_COMMAND').id];
    if (strs) for (let i = 0; i < strs.length; i++) o._items.push({ str: strs[i], img: imgs ? imgs[i] : null, sel: false });
    if (o._items.length && type !== 2) o._items[0].sel = true;
  }
  def(P + 'List', {
    super: P + 'Screen',
    interfaces: [P + 'Choice'],
    statics: { SELECT_COMMAND: ['Ljavax/microedition/lcdui/Command;', null] },
    clinit(vm, c) {
      const cmd = vm.newObject(P + 'Command'); cmd._label = ''; cmd._long = null; cmd._type = 1; cmd._prio = 0;
      c.statics[c.fieldsByName.get('SELECT_COMMAND').id] = cmd;
    },
    methods: Object.assign(choiceMethods((o) => o._items), {
      '<init>(Ljava/lang/String;I)V': (t, [o, ti, ty]) => initList(t, o, ti, ty, null, null),
      '<init>(Ljava/lang/String;I[Ljava/lang/String;[Ljavax/microedition/lcdui/Image;)V': (t, [o, ti, ty, s, im]) => initList(t, o, ti, ty, s, im),
      'setSelectCommand(Ljavax/microedition/lcdui/Command;)V': (t, [o, c]) => { o._selectCmd = c; if (c && o._cmds.indexOf(c) < 0) o._cmds.push(c); },
      'removeCommand(Ljavax/microedition/lcdui/Command;)V': (t, [o, c]) => { o._cmds = o._cmds.filter((x) => x !== c); if (o._selectCmd === c) o._selectCmd = null; },
    }),
  });

  // Items
  def(P + 'Item', {
    statics: { LAYOUT_DEFAULT: ['I', 0], LAYOUT_LEFT: ['I', 1], LAYOUT_RIGHT: ['I', 2], LAYOUT_CENTER: ['I', 3], LAYOUT_TOP: ['I', 0x10], LAYOUT_BOTTOM: ['I', 0x20], LAYOUT_VCENTER: ['I', 0x30], LAYOUT_NEWLINE_BEFORE: ['I', 0x100], LAYOUT_NEWLINE_AFTER: ['I', 0x200], LAYOUT_SHRINK: ['I', 0x400], LAYOUT_EXPAND: ['I', 0x800], LAYOUT_VSHRINK: ['I', 0x1000], LAYOUT_VEXPAND: ['I', 0x2000], LAYOUT_2: ['I', 0x4000], PLAIN: ['I', 0], HYPERLINK: ['I', 1], BUTTON: ['I', 2] },
    methods: {
      'getLabel()Ljava/lang/String;': (t, [o]) => o._label || null,
      'setLabel(Ljava/lang/String;)V': (t, [o, l]) => { o._label = l; repaint(t.vm); },
      'getLayout()I': (t, [o]) => o._layout || 0,
      'setLayout(I)V': (t, [o, l]) => { o._layout = l; },
      'addCommand(Ljavax/microedition/lcdui/Command;)V': (t, [o, c]) => { (o._cmds = o._cmds || []).push(c); },
      'removeCommand(Ljavax/microedition/lcdui/Command;)V': (t, [o, c]) => { o._cmds = (o._cmds || []).filter((x) => x !== c); },
      'setItemCommandListener(Ljavax/microedition/lcdui/ItemCommandListener;)V': (t, [o, l]) => { o._itemListener = l; },
      'setDefaultCommand(Ljavax/microedition/lcdui/Command;)V': (t, [o, c]) => { o._defaultCmd = c; if (c) (o._cmds = o._cmds || []).push(c); },
      'setPreferredSize(II)V': () => {},
      'getPreferredWidth()I': (t) => t.vm.host.screen.w, 'getPreferredHeight()I': () => 20,
      'getMinimumWidth()I': () => 20, 'getMinimumHeight()I': () => 10,
      'notifyStateChanged()V': () => {},
    },
  });
  def(P + 'StringItem', {
    super: P + 'Item',
    methods: {
      '<init>(Ljava/lang/String;Ljava/lang/String;)V': (t, [o, l, s]) => { o._kind = 'string'; o._label = l; o._text = s; },
      '<init>(Ljava/lang/String;Ljava/lang/String;I)V': (t, [o, l, s]) => { o._kind = 'string'; o._label = l; o._text = s; },
      'getText()Ljava/lang/String;': (t, [o]) => o._text,
      'setText(Ljava/lang/String;)V': (t, [o, s]) => { o._text = s; repaint(t.vm); },
      'setFont(Ljavax/microedition/lcdui/Font;)V': (t, [o, f]) => { o._font = f; },
      'getFont()Ljavax/microedition/lcdui/Font;': (t, [o]) => o._font || KP.makeFont(t.vm, 0, 0, 0),
      'getAppearanceMode()I': () => 0,
    },
  });
  def(P + 'ImageItem', {
    super: P + 'Item',
    methods: {
      '<init>(Ljava/lang/String;Ljavax/microedition/lcdui/Image;ILjava/lang/String;)V': (t, [o, l, im, lay, alt]) => { o._kind = 'image'; o._label = l; o._img = im; o._layout = lay; o._alt = alt; },
      '<init>(Ljava/lang/String;Ljavax/microedition/lcdui/Image;ILjava/lang/String;I)V': (t, [o, l, im, lay, alt]) => { o._kind = 'image'; o._label = l; o._img = im; o._layout = lay; o._alt = alt; },
      'getImage()Ljavax/microedition/lcdui/Image;': (t, [o]) => o._img,
      'setImage(Ljavax/microedition/lcdui/Image;)V': (t, [o, im]) => { o._img = im; repaint(t.vm); },
      'getAltText()Ljava/lang/String;': (t, [o]) => o._alt,
      'setAltText(Ljava/lang/String;)V': (t, [o, a]) => { o._alt = a; },
    },
  });
  def(P + 'Spacer', { super: P + 'Item', methods: { '<init>(II)V': (t, [o, w, h]) => { o._kind = 'spacer'; o._h = h; }, 'setMinimumSize(II)V': (t, [o, w, h]) => { o._h = h; } } });
  const textMethods = {
    'getString()Ljava/lang/String;': (t, [o]) => o._text || '',
    'setString(Ljava/lang/String;)V': (t, [o, s]) => { o._text = s || ''; repaint(t.vm); },
    'getChars([C)I': (t, [o, a]) => { const s = o._text || ''; for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return s.length; },
    'setChars([CII)V': (t, [o, a, off, len]) => { o._text = a ? KP.charsToString(a, off, len) : ''; repaint(t.vm); },
    'insert(Ljava/lang/String;I)V': (t, [o, s, p]) => { const x = o._text || ''; o._text = x.substring(0, p) + s + x.substring(p); repaint(t.vm); },
    'delete(II)V': (t, [o, p, n]) => { const x = o._text || ''; o._text = x.substring(0, p) + x.substring(p + n); repaint(t.vm); },
    'size()I': (t, [o]) => (o._text || '').length,
    'getMaxSize()I': (t, [o]) => o._max,
    'setMaxSize(I)I': (t, [o, n]) => { o._max = n; return n; },
    'getConstraints()I': (t, [o]) => o._constraints,
    'setConstraints(I)V': (t, [o, c]) => { o._constraints = c; },
    'getCaretPosition()I': (t, [o]) => (o._text || '').length,
    'setInitialInputMode(Ljava/lang/String;)V': () => {},
  };
  def(P + 'TextField', {
    super: P + 'Item',
    statics: { ANY: ['I', 0], EMAILADDR: ['I', 1], NUMERIC: ['I', 2], PHONENUMBER: ['I', 3], URL: ['I', 4], DECIMAL: ['I', 5], PASSWORD: ['I', 0x10000], UNEDITABLE: ['I', 0x20000], SENSITIVE: ['I', 0x40000], NON_PREDICTIVE: ['I', 0x80000], INITIAL_CAPS_WORD: ['I', 0x100000], INITIAL_CAPS_SENTENCE: ['I', 0x200000], CONSTRAINT_MASK: ['I', 0xffff] },
    methods: Object.assign({}, textMethods, {
      '<init>(Ljava/lang/String;Ljava/lang/String;II)V': (t, [o, l, s, max, c]) => { o._kind = 'text'; o._label = l; o._text = s || ''; o._max = max; o._constraints = c; },
    }),
  });
  def(P + 'Gauge', {
    super: P + 'Item',
    statics: { INDEFINITE: ['I', -1], CONTINUOUS_IDLE: ['I', 0], INCREMENTAL_IDLE: ['I', 1], CONTINUOUS_RUNNING: ['I', 2], INCREMENTAL_UPDATING: ['I', 3] },
    methods: {
      '<init>(Ljava/lang/String;ZII)V': (t, [o, l, i, max, v]) => { o._kind = 'gauge'; o._label = l; o._interactive = !!i; o._max = max; o._value = v; },
      'getValue()I': (t, [o]) => o._value,
      'setValue(I)V': (t, [o, v]) => { o._value = v; repaint(t.vm); },
      'getMaxValue()I': (t, [o]) => o._max,
      'setMaxValue(I)V': (t, [o, v]) => { o._max = v; repaint(t.vm); },
      'isInteractive()Z': (t, [o]) => o._interactive,
    },
  });
  def(P + 'ChoiceGroup', {
    super: P + 'Item',
    interfaces: [P + 'Choice'],
    methods: Object.assign(choiceMethods((o) => o._items), {
      '<init>(Ljava/lang/String;I)V': (t, [o, l, ty]) => { o._kind = 'choice'; o._label = l; o._type = ty; o._items = []; o._focus = 0; },
      '<init>(Ljava/lang/String;I[Ljava/lang/String;[Ljavax/microedition/lcdui/Image;)V': (t, [o, l, ty, s, im]) => {
        o._kind = 'choice'; o._label = l; o._type = ty; o._items = []; o._focus = 0;
        for (let i = 0; i < s.length; i++) o._items.push({ str: s[i], img: im ? im[i] : null, sel: false });
        if (o._items.length && ty !== 2) o._items[0].sel = true;
      },
    }),
  });
  def(P + 'DateField', {
    super: P + 'Item',
    statics: { DATE: ['I', 1], TIME: ['I', 2], DATE_TIME: ['I', 3] },
    methods: {
      '<init>(Ljava/lang/String;I)V': (t, [o, l]) => { o._kind = 'string'; o._label = l; o._text = new Date().toLocaleString(); },
      '<init>(Ljava/lang/String;ILjava/util/TimeZone;)V': (t, [o, l]) => { o._kind = 'string'; o._label = l; o._text = new Date().toLocaleString(); },
      'getDate()Ljava/util/Date;': (t) => { const d = t.vm.newObject('java/util/Date'); d._t = BigInt(Date.now()); return d; },
      'setDate(Ljava/util/Date;)V': (t, [o, d]) => { o._text = d ? new Date(Number(d._t)).toLocaleString() : ''; },
    },
  });
  def(P + 'CustomItem', {
    super: P + 'Item',
    methods: {
      '<init>(Ljava/lang/String;)V': (t, [o, l]) => { o._kind = 'string'; o._label = l; o._text = ''; },
      'repaint()V': () => {}, 'repaint(IIII)V': () => {}, 'invalidate()V': () => {},
      'getGameAction(I)I': (t, [o, k]) => KP.gameActionOf(k),
      'getInteractionModes()I': () => 0,
    },
  });

  def(P + 'Form', {
    super: P + 'Screen',
    methods: {
      '<init>(Ljava/lang/String;)V': (t, [o, ti]) => { o._screen = 'form'; o._title = ti; o._items = []; o._cmds = []; o._focus = 0; o._scrollY = 0; },
      '<init>(Ljava/lang/String;[Ljavax/microedition/lcdui/Item;)V': (t, [o, ti, items]) => { o._screen = 'form'; o._title = ti; o._items = items ? Array.from(items) : []; o._cmds = []; o._focus = 0; o._scrollY = 0; focusFirst(o); },
      'append(Ljavax/microedition/lcdui/Item;)I': (t, [o, it]) => { if (it === null) thr(t, 'java/lang/NullPointerException'); o._items.push(it); focusFirst(o); repaint(t.vm); return o._items.length - 1; },
      'append(Ljava/lang/String;)I': (t, [o, s]) => { const it = t.vm.newObject(P + 'StringItem'); it._kind = 'string'; it._label = null; it._text = s; o._items.push(it); repaint(t.vm); return o._items.length - 1; },
      'append(Ljavax/microedition/lcdui/Image;)I': (t, [o, im]) => { const it = t.vm.newObject(P + 'ImageItem'); it._kind = 'image'; it._img = im; it._layout = 3; o._items.push(it); repaint(t.vm); return o._items.length - 1; },
      'insert(ILjavax/microedition/lcdui/Item;)V': (t, [o, i, it]) => { o._items.splice(i, 0, it); repaint(t.vm); },
      'set(ILjavax/microedition/lcdui/Item;)V': (t, [o, i, it]) => { o._items[i] = it; repaint(t.vm); },
      'get(I)Ljavax/microedition/lcdui/Item;': (t, [o, i]) => { if (i < 0 || i >= o._items.length) thr(t, 'java/lang/IndexOutOfBoundsException'); return o._items[i]; },
      'delete(I)V': (t, [o, i]) => { o._items.splice(i, 1); o._focus = Math.min(o._focus, Math.max(0, o._items.length - 1)); repaint(t.vm); },
      'deleteAll()V': (t, [o]) => { o._items = []; o._focus = 0; o._scrollY = 0; repaint(t.vm); },
      'size()I': (t, [o]) => o._items.length,
      'setItemStateListener(Ljavax/microedition/lcdui/ItemStateListener;)V': (t, [o, l]) => { o._stateListener = l; },
    },
  });
  function focusFirst(o) { const i = o._items.findIndex(isInteractive); o._focus = i >= 0 ? i : 0; }

  def(P + 'AlertType', {
    statics: { ALARM: ['Ljavax/microedition/lcdui/AlertType;', null], CONFIRMATION: ['Ljavax/microedition/lcdui/AlertType;', null], ERROR: ['Ljavax/microedition/lcdui/AlertType;', null], INFO: ['Ljavax/microedition/lcdui/AlertType;', null], WARNING: ['Ljavax/microedition/lcdui/AlertType;', null] },
    clinit(vm, c) { for (const k of ['ALARM', 'CONFIRMATION', 'ERROR', 'INFO', 'WARNING']) { const o = vm.newObject(c); o._name = k; c.statics[c.fieldsByName.get(k).id] = o; } },
    methods: { 'playSound(Ljavax/microedition/lcdui/Display;)Z': () => 1, '<init>()V': () => {} },
  });
  def(P + 'Alert', {
    super: P + 'Screen',
    statics: { FOREVER: ['I', -2], DISMISS_COMMAND: ['Ljavax/microedition/lcdui/Command;', null] },
    clinit(vm, c) {
      const cmd = vm.newObject(P + 'Command'); cmd._label = 'Done'; cmd._long = null; cmd._type = 4; cmd._prio = 0;
      c.statics[c.fieldsByName.get('DISMISS_COMMAND').id] = cmd;
    },
    methods: {
      '<init>(Ljava/lang/String;)V': (t, [o, ti]) => initAlert(t, o, ti, null, null),
      '<init>(Ljava/lang/String;Ljava/lang/String;Ljavax/microedition/lcdui/Image;Ljavax/microedition/lcdui/AlertType;)V': (t, [o, ti, s, im]) => initAlert(t, o, ti, s, im),
      'getString()Ljava/lang/String;': (t, [o]) => o._text,
      'setString(Ljava/lang/String;)V': (t, [o, s]) => { o._text = s; repaint(t.vm); },
      'getImage()Ljavax/microedition/lcdui/Image;': (t, [o]) => o._img,
      'setImage(Ljavax/microedition/lcdui/Image;)V': (t, [o, im]) => { o._img = im; repaint(t.vm); },
      'getTimeout()I': (t, [o]) => o._timeout,
      'setTimeout(I)V': (t, [o, ms]) => { o._timeout = ms; },
      'getDefaultTimeout()I': () => 2000,
      'getType()Ljavax/microedition/lcdui/AlertType;': (t, [o]) => o._type || null,
      'setType(Ljavax/microedition/lcdui/AlertType;)V': (t, [o, ty]) => { o._type = ty; },
      'setIndicator(Ljavax/microedition/lcdui/Gauge;)V': () => {},
      'getIndicator()Ljavax/microedition/lcdui/Gauge;': () => null,
      'addCommand(Ljavax/microedition/lcdui/Command;)V': (t, [o, c]) => { o._cmds = o._cmds.filter((x) => x !== o._dismiss); o._cmds.push(c); o._timeout = -2; },
    },
  });
  function initAlert(t, o, ti, s, im) {
    const ac = t.vm.loadClass(P + 'Alert');
    o._screen = 'alert'; o._title = ti; o._text = s; o._img = im; o._timeout = 2000;
    o._dismiss = ac.statics[ac.fieldsByName.get('DISMISS_COMMAND').id];
    o._cmds = [o._dismiss]; o._listener = null;
  }

  def(P + 'TextBox', {
    super: P + 'Screen',
    methods: Object.assign({}, textMethods, {
      '<init>(Ljava/lang/String;Ljava/lang/String;II)V': (t, [o, ti, s, max, c]) => { o._screen = 'textbox'; o._title = ti; o._text = s || ''; o._max = max; o._constraints = c; o._cmds = []; },
    }),
  });
  def(P + 'Ticker', {
    methods: {
      '<init>(Ljava/lang/String;)V': (t, [o, s]) => { o._text = s; },
      'getString()Ljava/lang/String;': (t, [o]) => o._text,
      'setString(Ljava/lang/String;)V': (t, [o, s]) => { o._text = s; },
    },
  });
})(globalThis.KP = globalThis.KP || {});
