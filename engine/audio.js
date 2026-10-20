/* KeyPlay engine – audio: MIDI synth, MMAPI tone sequences, Nokia OTT ringtones, sampled audio (WebAudio). */
(function (KP) {
  'use strict';

  const A = {
    ctx: null, master: null, muted: false, volume: 1, noise: null, players: new Set(),
  };

  A.ensure = function () {
    if (A.ctx) return A.ctx;
    const AC = typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null); // eslint-disable-line no-undef
    if (!AC) return null;
    A.ctx = new AC();
    A.master = A.ctx.createGain();
    A.master.gain.value = A.muted ? 0 : A.volume;
    A.master.connect(A.ctx.destination);
    const len = A.ctx.sampleRate * 0.5;
    A.noise = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
    const d = A.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return A.ctx;
  };
  A.unlock = function () { const c = A.ensure(); if (c && c.state === 'suspended') c.resume(); };
  A.setMuted = function (m) { A.muted = m; if (A.master) A.master.gain.value = m ? 0 : A.volume; };
  A.stopAll = function () { for (const p of Array.from(A.players)) p.stop(); };

  const freqOf = (note) => 440 * Math.pow(2, (note - 69) / 12);

  // ---------- instrument model ----------
  function voiceFor(program, ch) {
    if (ch === 9) return { drum: true };
    const fam = program >> 3;
    switch (fam) {
      case 0: return { wave: 'triangle', perc: true, gain: 1.0, decay: 0.9 };      // piano
      case 1: return { wave: 'sine', perc: true, gain: 0.9, decay: 0.5 };          // chromatic perc
      case 2: return { wave: 'square', perc: false, gain: 0.45 };                   // organ
      case 3: return { wave: 'sawtooth', perc: true, gain: 0.5, decay: 0.8 };       // guitar
      case 4: return { wave: 'triangle', perc: false, gain: 1.0 };                  // bass
      case 5: case 6: return { wave: 'sawtooth', perc: false, gain: 0.35 };         // strings / ensemble
      case 7: return { wave: 'sawtooth', perc: false, gain: 0.4 };                  // brass
      case 8: case 9: return { wave: 'square', perc: false, gain: 0.4 };            // reed / pipe
      case 10: return { wave: 'square', perc: false, gain: 0.45 };                  // lead
      case 11: return { wave: 'sine', perc: false, gain: 0.7 };                     // pad
      default: return { wave: 'triangle', perc: true, gain: 0.8, decay: 0.6 };
    }
  }

  function playNote(c, out, n, when) {
    const g = c.createGain();
    g.connect(out);
    const vol = Math.max(0, Math.min(1, n.vol));
    if (n.drum) {
      const src = c.createBufferSource();
      src.buffer = A.noise;
      const k = n.note;
      if (k === 35 || k === 36) { // kick: pitched sine sweep
        const o = c.createOscillator();
        o.frequency.setValueAtTime(140, when); o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
        o.connect(g);
        g.gain.setValueAtTime(vol * 0.9, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
        o.start(when); o.stop(when + 0.2);
        return o;
      }
      const f = c.createBiquadFilter();
      f.type = k >= 42 && k <= 46 ? 'highpass' : 'bandpass';
      f.frequency.value = k >= 42 && k <= 46 ? 7000 : k === 38 || k === 40 ? 1800 : 3000;
      src.connect(f); f.connect(g);
      const len = k === 46 || k === 49 || k === 57 ? 0.35 : 0.09;
      g.gain.setValueAtTime(vol * 0.5, when); g.gain.exponentialRampToValueAtTime(0.001, when + len);
      src.start(when); src.stop(when + len + 0.02);
      return src;
    }
    const o = c.createOscillator();
    o.type = n.wave || 'square';
    o.frequency.value = n.freq || freqOf(n.note);
    o.connect(g);
    const peak = vol * (n.gain || 0.5) * 0.22;
    const dur = Math.max(0.03, n.dur);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.006);
    if (n.perc) {
      g.gain.exponentialRampToValueAtTime(Math.max(0.0005, peak * 0.25), when + Math.min(dur, n.decay || 0.6));
      g.gain.linearRampToValueAtTime(0, when + dur + 0.05);
    } else {
      g.gain.setValueAtTime(peak * 0.85, when + Math.max(0.006, dur - 0.02));
      g.gain.linearRampToValueAtTime(0, when + dur + 0.04);
    }
    o.start(when); o.stop(when + dur + 0.08);
    return o;
  }

  // ---------- generic note-list player with lookahead scheduling and looping ----------
  function NotePlayer(notes, length, loops, volume, onEnd) {
    this.notes = notes.slice().sort((a, b) => a.t - b.t);
    this.length = Math.max(length, 0.05);
    this.loops = loops; // -1 forever, else total play count
    this.volume = volume;
    this.onEnd = onEnd;
    this.idx = 0; this.loop = 0; this.base = 0; this.timer = null; this.nodes = []; this.stopped = false;
    this.out = null;
  }
  NotePlayer.prototype.start = function (offset) {
    const c = A.ensure();
    if (!c) { setTimeout(() => this.finish(), this.length * 1000); return; }
    this.out = c.createGain(); this.out.gain.value = this.volume; this.out.connect(A.master);
    this.base = c.currentTime + 0.03 - (offset || 0);
    this.idx = 0;
    while (this.idx < this.notes.length && this.notes[this.idx].t < (offset || 0)) this.idx++;
    A.players.add(this);
    const tick = () => {
      if (this.stopped) return;
      const now = c.currentTime;
      const horizon = now + 0.6;
      while (this.idx < this.notes.length && this.base + this.notes[this.idx].t < horizon) {
        const n = this.notes[this.idx++];
        const when = Math.max(now, this.base + n.t);
        try { this.nodes.push(playNote(c, this.out, n, when)); } catch (e) { /* ignore */ }
      }
      if (this.nodes.length > 400) this.nodes.splice(0, 200);
      if (this.idx >= this.notes.length && now >= this.base + this.length) {
        this.loop++;
        if (this.loops === -1 || this.loop < this.loops) { this.base += this.length; this.idx = 0; }
        else { this.finish(); return; }
      }
      this.timer = setTimeout(tick, 120);
    };
    tick();
  };
  NotePlayer.prototype.position = function () { return A.ctx ? Math.max(0, (A.ctx.currentTime - this.base) % this.length) : 0; };
  NotePlayer.prototype.setVolume = function (v) { this.volume = v; if (this.out) this.out.gain.value = v; };
  NotePlayer.prototype.stop = function () {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const n of this.nodes) { try { n.stop(); } catch (e) { /* already stopped */ } }
    this.nodes = [];
    if (this.out) { try { this.out.disconnect(); } catch (e) { /* ignore */ } }
    A.players.delete(this);
  };
  NotePlayer.prototype.finish = function () { this.stop(); if (this.onEnd) this.onEnd(); };

  // ---------- MIDI file parser ----------
  function parseMidi(b) {
    const u = (i) => b[i] & 255;
    const rd32 = (p) => ((u(p) << 24) | (u(p + 1) << 16) | (u(p + 2) << 8) | u(p + 3)) >>> 0;
    if (String.fromCharCode(u(0), u(1), u(2), u(3)) !== 'MThd') throw new Error('not MIDI');
    const hlen = rd32(4);
    const ntracks = (u(10) << 8) | u(11);
    let division = (u(12) << 8) | u(13);
    if (division & 0x8000) division = 480;
    let p = 8 + hlen;
    const events = [];
    for (let tr = 0; tr < ntracks && p + 8 <= b.length; tr++) {
      if (String.fromCharCode(u(p), u(p + 1), u(p + 2), u(p + 3)) !== 'MTrk') break;
      const len = rd32(p + 4);
      let q = p + 8;
      const end = Math.min(b.length, q + len);
      let tick = 0, status = 0;
      while (q < end) {
        let delta = 0, c;
        do { c = u(q++); delta = (delta << 7) | (c & 0x7f); } while (c & 0x80 && q < end);
        tick += delta;
        let st = u(q);
        if (st & 0x80) q++; else st = status;
        if (st === 0xff) {
          const type = u(q++);
          let l = 0; do { c = u(q++); l = (l << 7) | (c & 0x7f); } while (c & 0x80);
          if (type === 0x51 && l === 3) events.push({ tick, type: 'tempo', v: (u(q) << 16) | (u(q + 1) << 8) | u(q + 2) });
          if (type === 0x2f) { q = end; break; }
          q += l;
          continue;
        }
        if (st === 0xf0 || st === 0xf7) {
          let l = 0; do { c = u(q++); l = (l << 7) | (c & 0x7f); } while (c & 0x80);
          q += l; continue;
        }
        status = st;
        const kind = st & 0xf0, ch = st & 0x0f;
        const d1 = u(q++);
        const d2 = (kind === 0xc0 || kind === 0xd0) ? 0 : u(q++);
        if (kind === 0x90 && d2 > 0) events.push({ tick, type: 'on', ch, note: d1, vel: d2 });
        else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) events.push({ tick, type: 'off', ch, note: d1 });
        else if (kind === 0xc0) events.push({ tick, type: 'prog', ch, v: d1 });
        else if (kind === 0xb0 && (d1 === 7 || d1 === 11)) events.push({ tick, type: d1 === 7 ? 'vol' : 'expr', ch, v: d2 });
      }
      p = 8 + p + len;
    }
    events.sort((a, b2) => a.tick - b2.tick);
    // ticks -> seconds
    let tempo = 500000, lastTick = 0, time = 0;
    const prog = new Array(16).fill(0), vol = new Array(16).fill(100), expr = new Array(16).fill(127);
    const open = new Map();
    const notes = [];
    for (const e of events) {
      time += (e.tick - lastTick) * tempo / division / 1e6;
      lastTick = e.tick;
      e.time = time;
      switch (e.type) {
        case 'tempo': tempo = e.v; break;
        case 'prog': prog[e.ch] = e.v; break;
        case 'vol': vol[e.ch] = e.v; break;
        case 'expr': expr[e.ch] = e.v; break;
        case 'on': {
          const v = voiceFor(prog[e.ch], e.ch);
          const n = Object.assign({ t: time, note: e.note, vol: (e.vel / 127) * (vol[e.ch] / 127) * (expr[e.ch] / 127), dur: 0.25 }, v);
          if (v.drum) { notes.push(n); break; }
          const key = e.ch * 128 + e.note;
          if (open.has(key)) { const o = open.get(key); o.dur = time - o.t; }
          open.set(key, n);
          notes.push(n);
          break;
        }
        case 'off': {
          const key = e.ch * 128 + e.note;
          const o = open.get(key);
          if (o) { o.dur = Math.max(0.03, time - o.t); open.delete(key); }
          break;
        }
      }
    }
    for (const o of open.values()) o.dur = Math.max(0.1, time - o.t);
    return { notes, length: Math.max(time, notes.length ? notes[notes.length - 1].t + 0.3 : 0.1) };
  }

  // ---------- MMAPI tone sequence ----------
  function parseToneSequence(seq) {
    const s = Array.from(seq, (x) => (x << 24) >> 24);
    let i = 0, tempo = 30, res = 64, vol = 100;
    const blocks = {};
    const notes = [];
    let t = 0;
    const unit = () => (60 / (tempo * 4)) * 4 / res;
    const play = (from, to, depth) => {
      for (let k = from; k < to && depth < 8;) {
        const v = s[k];
        if (v === -7) { const b = blocks[s[k + 1]]; if (b) play(b[0], b[1], depth + 1); k += 2; }
        else if (v === -8) { vol = s[k + 1]; k += 2; }
        else if (v === -9) {
          const rep = s[k + 1]; const n = s[k + 2], d = s[k + 3];
          for (let r = 0; r < rep; r++) { if (n >= 0) notes.push({ t, note: n, dur: d * unit() * 0.95, vol: vol / 100, wave: 'square', gain: 0.6 }); t += d * unit(); }
          k += 4;
        } else if (v === -5) { const id = s[k + 1]; let e = k + 2; while (e < s.length && !(s[e] === -6 && s[e + 1] === id)) e += 2; blocks[id] = [k + 2, e]; k = e + 2; }
        else if (v === -2 || v === -3 || v === -4 || v === -6) k += 2;
        else { const d = s[k + 1]; if (v >= 0) notes.push({ t, note: v, dur: d * unit() * 0.95, vol: vol / 100, wave: 'square', gain: 0.6 }); t += d * unit(); k += 2; }
      }
    };
    // header
    while (i < s.length) {
      if (s[i] === -2) i += 2;
      else if (s[i] === -3) { tempo = s[i + 1] & 255; i += 2; }
      else if (s[i] === -4) { res = s[i + 1] & 255; i += 2; }
      else break;
    }
    play(i, s.length, 0);
    return { notes, length: Math.max(t, 0.05) };
  }

  // ---------- Nokia OTT (Smart Messaging) ringtone ----------
  function parseOtt(b) {
    let bit = 0;
    const read = (n) => {
      let v = 0;
      for (let i = 0; i < n; i++) {
        const byte = b[bit >> 3] & 255;
        v = (v << 1) | ((byte >> (7 - (bit & 7))) & 1);
        bit++;
      }
      return v;
    };
    const BPM = [25, 28, 31, 35, 40, 45, 50, 56, 63, 70, 80, 90, 100, 112, 125, 140, 160, 180, 200, 225, 250, 285, 320, 355, 400, 450, 500, 565, 635, 715, 800, 900];
    const notes = [];
    let t = 0;
    try {
      const cmdLen = read(8);
      for (let c = 0; c < cmdLen; c++) {
        const cmd = read(7);
        if (cmd === 0x25) { read(1); continue; } // ringing tone programming, align
        if (cmd === 0x1d) { // sound
          const type = read(3);
          if (type === 1) {
            const tl = read(4); for (let i = 0; i < tl; i++) read(8);
          }
          const patterns = read(8);
          let scale = 1, tempo = 63, vol = 7;
          for (let pIdx = 0; pIdx < patterns; pIdx++) {
            read(3); read(2);
            const loopVal = read(4);
            const count = read(8);
            const start = notes.length, tStart = t;
            for (let k = 0; k < count; k++) {
              const ins = read(3);
              if (ins === 1) {
                const nv = read(4), dur = read(3), spec = read(2);
                let len = (60 / tempo) * 4 / Math.pow(2, dur);
                if (spec === 1) len *= 1.5; else if (spec === 2) len *= 1.75; else if (spec === 3) len *= 2 / 3;
                if (nv > 0 && nv <= 12) notes.push({ t, note: 59 + nv + 12 * scale, dur: len * 0.9, vol: (vol + 1) / 16, wave: 'square', gain: 0.6 });
                t += len;
              } else if (ins === 2) scale = read(2);
              else if (ins === 3) read(2);
              else if (ins === 4) tempo = BPM[read(5)];
              else if (ins === 5) vol = read(4);
              else break;
            }
            const reps = loopVal === 15 ? 0 : loopVal;
            const pat = notes.slice(start), span = t - tStart;
            for (let r = 0; r < reps; r++) { for (const n of pat) notes.push(Object.assign({}, n, { t: n.t + span * (r + 1) })); }
            t += span * reps;
          }
          break;
        }
        break;
      }
    } catch (e) { /* truncated data */ }
    return { notes, length: Math.max(t, 0.05) };
  }

  // ---------- sampled audio ----------
  function SamplePlayer(bytes, loops, volume, onEnd) {
    this.bytes = bytes; this.loops = loops; this.volume = volume; this.onEnd = onEnd;
    this.src = null; this.stopped = false; this.count = 0; this.buffer = null; this.started = 0; this.out = null;
  }
  SamplePlayer.prototype.start = function () {
    const c = A.ensure();
    if (!c) { setTimeout(() => this.onEnd && this.onEnd(), 10); return; }
    A.players.add(this);
    const go = (buf) => {
      if (this.stopped) return;
      this.buffer = buf;
      this.out = c.createGain(); this.out.gain.value = this.volume; this.out.connect(A.master);
      const playOnce = () => {
        if (this.stopped) return;
        const s = c.createBufferSource();
        s.buffer = buf; s.connect(this.out);
        if (this.loops === -1) s.loop = true;
        s.onended = () => {
          if (this.stopped || this.loops === -1) return;
          this.count++;
          if (this.count < this.loops) playOnce(); else { this.stop(); if (this.onEnd) this.onEnd(); }
        };
        this.started = c.currentTime;
        s.start();
        this.src = s;
      };
      playOnce();
    };
    const key = this.bytes;
    if (key._decoded) { go(key._decoded); return; }
    const ab = new Uint8Array(this.bytes.buffer, this.bytes.byteOffset, this.bytes.length).slice().buffer;
    c.decodeAudioData(ab).then((buf) => { key._decoded = buf; go(buf); }).catch(() => { this.stop(); if (this.onEnd) this.onEnd(); });
  };
  SamplePlayer.prototype.setVolume = function (v) { this.volume = v; if (this.out) this.out.gain.value = v; };
  SamplePlayer.prototype.position = function () { return A.ctx && this.src ? A.ctx.currentTime - this.started : 0; };
  SamplePlayer.prototype.stop = function () {
    this.stopped = true;
    if (this.src) { try { this.src.stop(); } catch (e) { /* ignore */ } }
    if (this.out) { try { this.out.disconnect(); } catch (e) { /* ignore */ } }
    A.players.delete(this);
  };

  // ---------- public API ----------
  const parsedCache = new WeakMap();
  function parsed(bytes, fn) {
    let r = parsedCache.get(bytes);
    if (!r) { r = fn(bytes); parsedCache.set(bytes, r); }
    return r;
  }
  A.kindOf = function (bytes, type) {
    const u = (i) => bytes[i] & 255;
    type = (type || '').toLowerCase();
    if (bytes.length > 4 && u(0) === 0x4d && u(1) === 0x54 && u(2) === 0x68 && u(3) === 0x64) return 'midi';
    if (type.indexOf('tone') >= 0 || type.indexOf('ott') >= 0) return 'tone';
    if (type.indexOf('midi') >= 0 || type.indexOf('mid') >= 0) return 'midi';
    return 'sampled';
  };
  A.duration = function (bytes, type) {
    try {
      const k = A.kindOf(bytes, type);
      if (k === 'midi') return parsed(bytes, parseMidi).length;
      return bytes._decoded ? bytes._decoded.duration : -1;
    } catch (e) { return -1; }
  };
  A.play = function (bytes, type, loops, volume, onEnd) {
    const k = A.kindOf(bytes, type);
    let p;
    try {
      if (k === 'midi') { const m = parsed(bytes, parseMidi); p = new NotePlayer(m.notes, m.length, loops, volume, onEnd); }
      else if (k === 'tone') { const m = parsed(bytes, parseToneSequence); p = new NotePlayer(m.notes, m.length, loops, volume, onEnd); }
      else p = new SamplePlayer(bytes, loops, volume, onEnd);
    } catch (e) {
      p = new NotePlayer([], 0.05, 1, volume, onEnd);
    }
    p.start();
    return p;
  };
  A.playOtt = function (bytes, loops, volume, onEnd) {
    const m = parsed(bytes, parseOtt);
    const p = new NotePlayer(m.notes, m.length, loops, volume, onEnd);
    p.start();
    return p;
  };
  A.playToneSeq = function (seq, loops, volume, onEnd) {
    const m = parseToneSequence(seq);
    const p = new NotePlayer(m.notes, m.length, loops, volume, onEnd);
    p.start();
    return p;
  };
  A.tone = function (note, ms, volume) {
    const n = { t: 0, note, dur: Math.max(0.02, ms / 1000), vol: volume / 100, wave: 'square', gain: 0.7 };
    const p = new NotePlayer([n], n.dur, 1, 1, null);
    p.start();
    return p;
  };
  A.freqTone = function (freq, ms, volume) {
    const n = { t: 0, freq, dur: Math.max(0.02, ms / 1000), vol: volume, wave: 'square', gain: 0.7 };
    const p = new NotePlayer([n], n.dur, 1, 1, null);
    p.start();
    return p;
  };
  A.parseMidi = parseMidi; A.parseOtt = parseOtt; A.parseToneSequence = parseToneSequence;

  KP.audio = A;
})(globalThis.KP = globalThis.KP || {});
