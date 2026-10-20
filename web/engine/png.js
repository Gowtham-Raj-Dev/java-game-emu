/* KeyPlay engine – synchronous PNG decoder (all color types / bit depths, tRNS, Adam7). */
(function (KP) {
  'use strict';

  function isPng(b, off) {
    off = off || 0;
    return b.length - off > 8 && b[off] === 0x89 && b[off + 1] === 0x50 && b[off + 2] === 0x4e && b[off + 3] === 0x47;
  }

  // returns {width, height, data: Uint8ClampedArray RGBA}
  function decodePng(b, off, len) {
    off = off || 0;
    const end = len === undefined ? b.length : off + len;
    let p = off + 8;
    let w = 0, h = 0, depth = 8, ctype = 0, interlace = 0;
    let palette = null, trns = null;
    const idat = [];
    let idatLen = 0;
    const u32 = (q) => ((b[q] << 24) | (b[q + 1] << 16) | (b[q + 2] << 8) | b[q + 3]) >>> 0;
    while (p + 8 <= end) {
      const clen = u32(p);
      const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      const d = p + 8;
      if (type === 'IHDR') {
        w = u32(d); h = u32(d + 4); depth = b[d + 8]; ctype = b[d + 9]; interlace = b[d + 12];
      } else if (type === 'PLTE') {
        palette = b.subarray(d, d + clen);
      } else if (type === 'tRNS') {
        trns = b.subarray(d, d + clen);
      } else if (type === 'IDAT') {
        idat.push(b.subarray(d, d + clen)); idatLen += clen;
      } else if (type === 'IEND') break;
      p = d + clen + 4;
    }
    if (!w || !h) throw new Error('PNG: missing header');
    const z = new Uint8Array(idatLen);
    for (let i = 0, q = 0; i < idat.length; i++) { z.set(idat[i], q); q += idat[i].length; }
    const channels = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 3 ? 1 : ctype === 4 ? 2 : 4;
    const bpp = Math.max(1, (channels * depth) >> 3);
    const raw = KP.inflateZlib(z, (w * channels * depth / 8 + 1) * h);
    const out = new Uint8ClampedArray(w * h * 4);

    let trnsGray = -1, trnsR = -1, trnsG = -1, trnsB = -1;
    if (trns && ctype === 0 && trns.length >= 2) trnsGray = (trns[0] << 8) | trns[1];
    if (trns && ctype === 2 && trns.length >= 6) { trnsR = (trns[0] << 8) | trns[1]; trnsG = (trns[2] << 8) | trns[3]; trnsB = (trns[4] << 8) | trns[5]; }

    let rp = 0;
    function pass(x0, y0, dx, dy) {
      const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
      if (pw <= 0 || ph <= 0) return;
      const stride = Math.ceil(pw * channels * depth / 8);
      let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
      for (let y = 0; y < ph; y++) {
        const ft = raw[rp++];
        for (let i = 0; i < stride; i++) {
          const x = raw[rp + i];
          const a = i >= bpp ? cur[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
          let v;
          switch (ft) {
            case 0: v = x; break;
            case 1: v = x + a; break;
            case 2: v = x + up; break;
            case 3: v = x + ((a + up) >> 1); break;
            case 4: {
              const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c);
              v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
              break;
            }
            default: v = x;
          }
          cur[i] = v & 255;
        }
        rp += stride;
        const yy = y0 + y * dy;
        for (let xI = 0; xI < pw; xI++) {
          const xx = x0 + xI * dx;
          const o = (yy * w + xx) * 4;
          let r, g, bl, al = 255;
          if (depth < 8) {
            const bitPos = xI * depth;
            const sample = (cur[bitPos >> 3] >> (8 - depth - (bitPos & 7))) & ((1 << depth) - 1);
            if (ctype === 3) {
              r = palette ? palette[sample * 3] : 0; g = palette ? palette[sample * 3 + 1] : 0; bl = palette ? palette[sample * 3 + 2] : 0;
              al = trns && sample < trns.length ? trns[sample] : 255;
            } else {
              const v = Math.round(sample * 255 / ((1 << depth) - 1));
              r = g = bl = v;
              if (sample === trnsGray) al = 0;
            }
          } else if (depth === 8) {
            const q = xI * channels;
            switch (ctype) {
              case 0: r = g = bl = cur[q]; if (cur[q] === trnsGray) al = 0; break;
              case 2: r = cur[q]; g = cur[q + 1]; bl = cur[q + 2]; if (r === trnsR && g === trnsG && bl === trnsB) al = 0; break;
              case 3: {
                const s = cur[q];
                r = palette ? palette[s * 3] : 0; g = palette ? palette[s * 3 + 1] : 0; bl = palette ? palette[s * 3 + 2] : 0;
                al = trns && s < trns.length ? trns[s] : 255; break;
              }
              case 4: r = g = bl = cur[q]; al = cur[q + 1]; break;
              default: r = cur[q]; g = cur[q + 1]; bl = cur[q + 2]; al = cur[q + 3];
            }
          } else { // 16-bit
            const q = xI * channels * 2;
            const s = (i) => cur[q + i * 2];
            switch (ctype) {
              case 0: r = g = bl = s(0); if (((cur[q] << 8) | cur[q + 1]) === trnsGray) al = 0; break;
              case 2: r = s(0); g = s(1); bl = s(2); break;
              case 4: r = g = bl = s(0); al = s(1); break;
              default: r = s(0); g = s(1); bl = s(2); al = s(3);
            }
          }
          out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = al;
        }
        const t = prev; prev = cur; cur = t;
      }
    }
    if (interlace) {
      pass(0, 0, 8, 8); pass(4, 0, 8, 8); pass(0, 4, 4, 8); pass(2, 0, 4, 4);
      pass(0, 2, 2, 4); pass(1, 0, 2, 2); pass(0, 1, 1, 2);
    } else pass(0, 0, 1, 1);
    return { width: w, height: h, data: out };
  }

  // Minimal PNG size probe (for resolution detection)
  function pngSize(b) {
    if (!isPng(b)) return null;
    return { width: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, height: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 };
  }

  KP.isPng = isPng;
  KP.decodePng = decodePng;
  KP.pngSize = pngSize;
})(globalThis.KP = globalThis.KP || {});
