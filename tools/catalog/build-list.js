// Build catalog entries from a download list + fetched jars: node build-list.js <list.json> <jarsDir> <outEntries.json>
// Copies each jar to web/games/free/<id>.jar and extracts its MIDlet icon.
const fs = require('fs');
const path = require('path');
const KP = require('../load-engine.js')(['inflate.js', 'zip.js', 'png.js', 'classfile.js', 'vm.js', 'jlib.js', 'midp-lcdui.js', 'launcher.js']);

const [listFile, jarsDir, outFile] = process.argv.slice(2);
const list = JSON.parse(fs.readFileSync(listFile, 'utf8').replace(/^﻿/, ''));
const webFree = path.join(__dirname, '..', '..', 'web', 'games', 'free');
const out = [];
for (const e of list) {
  const src = path.join(jarsDir, e.id + '.jar');
  if (!fs.existsSync(src)) continue;
  const bytes = fs.readFileSync(src);
  const jar = new KP.Jar(bytes);
  const props = KP.parseManifest(jar.text('META-INF/MANIFEST.MF') || '');
  let iconPath = props['MIDlet-Icon'] || ((props['MIDlet-1'] || '').split(',')[1] || '').trim();
  let icon = iconPath ? jar.get(iconPath.replace(/^\/+/, '')) : null;
  if (!icon || !KP.isPng(icon)) {
    // fall back to a small square PNG inside the jar named like an icon
    const n = jar.names().find((x) => /icon|logo/i.test(x) && /\.png$/i.test(x));
    icon = n ? jar.get(n) : null;
  }
  const prof = KP.detectProfile(jar, props, e.id);
  fs.copyFileSync(src, path.join(webFree, e.id + '.jar'));
  out.push({
    id: e.id, name: e.name, category: e.cat, desc: e.desc, jarFile: e.id + '.jar',
    iconBytes: icon && KP.isPng(icon) ? Buffer.from(icon).toString('base64') : null,
    size: null, detected: prof.w + 'x' + prof.h, author: e.author, license: e.license, source: e.source,
    controls: e.controls || (prof.touch ? 'touch' : 'keypad'),
  });
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log('entries', out.length, 'icons', out.filter((x) => x.iconBytes).length);
console.log('sizes', JSON.stringify(out.reduce((a, x) => { a[x.detected] = (a[x.detected] || 0) + 1; return a; }, {})));
