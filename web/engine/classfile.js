/* KeyPlay engine – Java .class file parser. */
(function (KP) {
  'use strict';

  const dv = new DataView(new ArrayBuffer(8));

  function parseClass(b) {
    let p = 0;
    const u1 = () => b[p++];
    const u2 = () => { const v = (b[p] << 8) | b[p + 1]; p += 2; return v; };
    const u4 = () => { const v = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]); p += 4; return v; };
    if (u4() !== (0xCAFEBABE | 0)) throw new Error('Not a class file');
    u2(); u2(); // minor, major
    const count = u2();
    const cp = new Array(count);
    for (let i = 1; i < count; i++) {
      const tag = u1();
      switch (tag) {
        case 1: { const len = u2(); cp[i] = { tag, value: KP.utf8Decode(b, p, len) }; p += len; break; }
        case 3: cp[i] = { tag, value: u4() }; break;
        case 4: { dv.setInt32(0, u4()); cp[i] = { tag, value: dv.getFloat32(0) }; break; }
        case 5: { const hi = u4(), lo = u4(); cp[i] = { tag, value: BigInt.asIntN(64, (BigInt(hi) << 32n) | BigInt(lo >>> 0)) }; i++; break; }
        case 6: { dv.setInt32(0, u4()); dv.setInt32(4, u4()); cp[i] = { tag, value: dv.getFloat64(0) }; i++; break; }
        case 7: cp[i] = { tag, nameIndex: u2() }; break;
        case 8: cp[i] = { tag, stringIndex: u2() }; break;
        case 9: case 10: case 11: cp[i] = { tag, classIndex: u2(), natIndex: u2() }; break;
        case 12: cp[i] = { tag, nameIndex: u2(), descIndex: u2() }; break;
        case 15: cp[i] = { tag, kind: u1(), ref: u2() }; break;
        case 16: cp[i] = { tag, descIndex: u2() }; break;
        case 18: cp[i] = { tag, bsm: u2(), natIndex: u2() }; break;
        default: throw new Error('Bad constant pool tag ' + tag + ' at ' + i);
      }
    }
    const utf = (i) => cp[i].value;
    const className = (i) => (i ? utf(cp[i].nameIndex) : null);
    // pre-resolve symbolic info
    for (let i = 1; i < count; i++) {
      const e = cp[i];
      if (!e) continue;
      if (e.tag === 7) e.name = utf(e.nameIndex);
      else if (e.tag === 8) e.value = utf(e.stringIndex);
      else if (e.tag === 12) { e.name = utf(e.nameIndex); e.desc = utf(e.descIndex); }
    }
    for (let i = 1; i < count; i++) {
      const e = cp[i];
      if (e && (e.tag === 9 || e.tag === 10 || e.tag === 11)) {
        e.className = cp[e.classIndex].name;
        const nat = cp[e.natIndex];
        e.name = nat.name; e.desc = nat.desc;
      }
    }

    const access = u2();
    const name = className(u2());
    const superName = className(u2());
    const interfaces = [];
    for (let n = u2(); n > 0; n--) interfaces.push(className(u2()));

    const readAttrs = (handler) => {
      for (let n = u2(); n > 0; n--) {
        const an = utf(u2());
        const len = u4();
        const end = p + len;
        handler(an, len);
        p = end;
      }
    };

    const fields = [];
    for (let n = u2(); n > 0; n--) {
      const f = { access: u2(), name: utf(u2()), desc: utf(u2()), constant: undefined };
      readAttrs((an) => { if (an === 'ConstantValue') f.constant = cp[u2()].value; });
      fields.push(f);
    }

    const methods = [];
    for (let n = u2(); n > 0; n--) {
      const m = { access: u2(), name: utf(u2()), desc: utf(u2()), code: null };
      readAttrs((an) => {
        if (an !== 'Code') return;
        const maxStack = u2(), maxLocals = u2();
        const codeLen = u4();
        const code = b.slice(p, p + codeLen);
        p += codeLen;
        const handlers = [];
        for (let k = u2(); k > 0; k--) handlers.push({ start: u2(), end: u2(), handler: u2(), catchType: className(u2()) });
        const lines = [];
        readAttrs((an2) => {
          if (an2 === 'LineNumberTable') for (let k = u2(); k > 0; k--) lines.push([u2(), u2()]);
        });
        m.code = { maxStack, maxLocals, code, handlers, lines };
      });
      methods.push(m);
    }
    return { access, name, superName, interfaces, cp, fields, methods };
  }

  KP.parseClass = parseClass;
})(globalThis.KP = globalThis.KP || {});
