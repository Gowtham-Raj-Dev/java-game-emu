/* JavaPlay engine – synchronous DEFLATE decoder (RFC 1951), used for JAR entries and PNG data. */
(function (KP) {
  'use strict';

  const LEN_BASE = new Uint16Array([3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]);
  const LEN_EXTRA = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]);
  const DIST_BASE = new Uint16Array([1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]);
  const DIST_EXTRA = new Uint8Array([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]);
  const CL_ORDER = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

  // Huffman table: counts per length + symbols sorted by code
  function Tree() { this.counts = new Uint16Array(16); this.symbols = new Uint16Array(320); }

  function buildTree(t, lengths, off, num) {
    t.counts.fill(0);
    for (let i = 0; i < num; i++) t.counts[lengths[off + i]]++;
    t.counts[0] = 0;
    const offs = new Uint16Array(16);
    for (let i = 1, sum = 0; i < 16; i++) { offs[i] = sum; sum += t.counts[i]; }
    for (let i = 0; i < num; i++) if (lengths[off + i]) t.symbols[offs[lengths[off + i]]++] = i;
  }

  const FIXED_LIT = new Tree(), FIXED_DIST = new Tree();
  (function () {
    const l = new Uint8Array(288);
    for (let i = 0; i < 144; i++) l[i] = 8;
    for (let i = 144; i < 256; i++) l[i] = 9;
    for (let i = 256; i < 280; i++) l[i] = 7;
    for (let i = 280; i < 288; i++) l[i] = 8;
    buildTree(FIXED_LIT, l, 0, 288);
    const d = new Uint8Array(30).fill(5);
    buildTree(FIXED_DIST, d, 0, 30);
  })();

  function inflateRaw(src, sizeHint) {
    let pos = 0, bitBuf = 0, bitCnt = 0;
    let out = new Uint8Array(Math.max(sizeHint || 0, src.length * 4, 1024));
    let op = 0;

    function ensure(n) {
      if (op + n <= out.length) return;
      let len = out.length * 2;
      while (len < op + n) len *= 2;
      const o = new Uint8Array(len); o.set(out.subarray(0, op)); out = o;
    }
    function bit() {
      if (!bitCnt) { if (pos >= src.length) throw new Error('inflate: unexpected end'); bitBuf = src[pos++]; bitCnt = 8; }
      const b = bitBuf & 1; bitBuf >>>= 1; bitCnt--; return b;
    }
    function bits(n) {
      let v = 0;
      for (let i = 0; i < n; i++) v |= bit() << i;
      return v;
    }
    function decode(t) {
      let sum = 0, cur = 0, len = 0;
      do {
        cur = 2 * cur + bit();
        if (++len > 15) throw new Error('inflate: bad code');
        sum += t.counts[len];
        cur -= t.counts[len];
      } while (cur >= 0);
      return t.symbols[sum + cur];
    }

    const dynLit = new Tree(), dynDist = new Tree(), clTree = new Tree();
    const lengths = new Uint8Array(320);
    let final = 0;
    do {
      final = bit();
      const type = bits(2);
      if (type === 0) {
        bitBuf = 0; bitCnt = 0;
        const len = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        ensure(len);
        out.set(src.subarray(pos, pos + len), op);
        op += len; pos += len;
        continue;
      }
      let lt, dt;
      if (type === 1) { lt = FIXED_LIT; dt = FIXED_DIST; }
      else if (type === 2) {
        const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        lengths.fill(0, 0, 19);
        for (let i = 0; i < hclen; i++) lengths[CL_ORDER[i]] = bits(3);
        buildTree(clTree, lengths, 0, 19);
        for (let n = 0; n < hlit + hdist;) {
          const sym = decode(clTree);
          if (sym < 16) { lengths[n++] = sym; continue; }
          let prev = 0, rep;
          if (sym === 16) { prev = lengths[n - 1]; rep = bits(2) + 3; }
          else if (sym === 17) rep = bits(3) + 3;
          else rep = bits(7) + 11;
          while (rep--) lengths[n++] = prev;
        }
        buildTree(dynLit, lengths, 0, hlit);
        buildTree(dynDist, lengths, hlit, hdist);
        lt = dynLit; dt = dynDist;
      } else throw new Error('inflate: bad block type');

      for (;;) {
        const sym = decode(lt);
        if (sym < 256) { ensure(1); out[op++] = sym; continue; }
        if (sym === 256) break;
        const li = sym - 257;
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const di = decode(dt);
        const dist = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        ensure(len);
        for (let i = 0; i < len; i++, op++) out[op] = out[op - dist];
      }
    } while (!final);
    return out.subarray(0, op);
  }

  // zlib wrapper (PNG IDAT): 2-byte header, deflate data, adler32
  function inflateZlib(src, sizeHint) {
    return inflateRaw(src.subarray(2), sizeHint);
  }

  KP.inflateRaw = inflateRaw;
  KP.inflateZlib = inflateZlib;
})(globalThis.KP = globalThis.KP || {});
