/* KeyPlay engine – JAR (ZIP) reader with lazy, synchronous entry extraction. */
(function (KP) {
  'use strict';

  class Jar {
    constructor(bytes) {
      this.data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      this.entries = new Map(); // name -> {method, csize, size, offset}
      this.cache = new Map();
      this._readDirectory();
    }

    _u16(p) { return this.data[p] | (this.data[p + 1] << 8); }
    _u32(p) { return (this.data[p] | (this.data[p + 1] << 8) | (this.data[p + 2] << 16) | (this.data[p + 3] << 24)) >>> 0; }

    _readDirectory() {
      const d = this.data;
      let eocd = -1;
      for (let p = d.length - 22; p >= Math.max(0, d.length - 65557); p--) {
        if (d[p] === 0x50 && d[p + 1] === 0x4b && d[p + 2] === 5 && d[p + 3] === 6) { eocd = p; break; }
      }
      if (eocd < 0) { this._scanLocalHeaders(); return; }
      const count = this._u16(eocd + 10);
      let p = this._u32(eocd + 16);
      for (let i = 0; i < count; i++) {
        if (this._u32(p) !== 0x02014b50) break;
        const method = this._u16(p + 10);
        const csize = this._u32(p + 20), size = this._u32(p + 24);
        const nlen = this._u16(p + 28), xlen = this._u16(p + 30), clen = this._u16(p + 32);
        const local = this._u32(p + 42);
        const name = this._name(p + 46, nlen);
        p += 46 + nlen + xlen + clen;
        if (!name.endsWith('/')) this.entries.set(name, { method, csize, size, local });
      }
      if (!this.entries.size) this._scanLocalHeaders();
    }

    // fallback for JARs with a broken central directory (some old games)
    _scanLocalHeaders() {
      const d = this.data;
      let p = 0;
      while (p + 30 < d.length && this._u32(p) === 0x04034b50) {
        const flags = this._u16(p + 6), method = this._u16(p + 8);
        let csize = this._u32(p + 18), size = this._u32(p + 22);
        const nlen = this._u16(p + 26), xlen = this._u16(p + 28);
        const name = this._name(p + 30, nlen);
        const dataStart = p + 30 + nlen + xlen;
        if ((flags & 8) && csize === 0) {
          // data descriptor: search next signature
          let q = dataStart;
          while (q + 4 < d.length && !(this._u32(q) === 0x08074b50 || this._u32(q) === 0x04034b50 || this._u32(q) === 0x02014b50)) q++;
          csize = q - dataStart;
          if (this._u32(q) === 0x08074b50) { size = this._u32(q + 12); q += 16; }
          if (!name.endsWith('/')) this.entries.set(name, { method, csize, size, local: p });
          p = q;
          continue;
        }
        if (!name.endsWith('/')) this.entries.set(name, { method, csize, size, local: p });
        p = dataStart + csize;
      }
    }

    _name(p, len) {
      let s = '';
      for (let i = 0; i < len; i++) s += String.fromCharCode(this.data[p + i]);
      try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
    }

    has(name) { return this.entries.has(KP.Jar.norm(name)); }

    get(name) {
      name = KP.Jar.norm(name);
      if (this.cache.has(name)) return this.cache.get(name);
      const e = this.entries.get(name);
      if (!e) return null;
      const p = e.local;
      const start = p + 30 + this._u16(p + 26) + this._u16(p + 28);
      const raw = this.data.subarray(start, start + e.csize);
      let out;
      if (e.method === 0) out = raw.slice();
      else if (e.method === 8) out = KP.inflateRaw(raw, e.size);
      else throw new Error('Unsupported ZIP method ' + e.method + ' for ' + name);
      if (out.length < 512 * 1024) this.cache.set(name, out);
      return out;
    }

    text(name) {
      const b = this.get(name);
      return b ? KP.utf8Decode(b) : null;
    }

    names() { return Array.from(this.entries.keys()); }

    static norm(name) {
      while (name.startsWith('/')) name = name.substring(1);
      return name;
    }
  }

  KP.utf8Decode = function (b, off, len) {
    off = off || 0; len = len === undefined ? b.length - off : len;
    let s = '';
    const end = off + len;
    for (let i = off; i < end;) {
      const c = b[i++];
      if (c < 0x80) s += String.fromCharCode(c);
      else if ((c & 0xe0) === 0xc0) s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
      else if ((c & 0xf0) === 0xe0) { s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i] & 0x3f) << 6) | (b[i + 1] & 0x3f)); i += 2; }
      else { s += String.fromCharCode(c); }
    }
    return s;
  };

  // Java "modified UTF-8" / UTF-8 encoder
  KP.utf8Encode = function (s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 0 && c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  };

  // MANIFEST.MF / JAD parser (handles continuation lines)
  KP.parseManifest = function (text) {
    const props = {};
    if (!text) return props;
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let key = null;
    for (const line of lines) {
      if (line.startsWith(' ') && key) { props[key] += line.substring(1); continue; }
      const i = line.indexOf(':');
      if (i <= 0) { key = null; continue; }
      key = line.substring(0, i).trim();
      props[key] = line.substring(i + 1).trim();
    }
    return props;
  };

  KP.Jar = Jar;
})(globalThis.KP = globalThis.KP || {});
