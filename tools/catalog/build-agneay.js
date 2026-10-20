// Build catalog entries for agneay/j2me-100-games (MIT): node build-agneay.js <jarDir> <readme.md> <outJson>
const fs = require('fs');
const path = require('path');
const KP = require('../load-engine.js')(['inflate.js', 'zip.js', 'png.js', 'classfile.js']);

const [jarDir, readmePath, outJson] = process.argv.slice(2);
const readme = fs.readFileSync(readmePath, 'utf8');
const rows = [];
const re = /^\|\s*(\d{3})\s*\|\s*\[([^\]]+)\]\(games\/([^)\/]+)\/README\.md\)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|.*?\(https:\/\/github\.com\/agneay\/j2me-100-games\/releases\/download\/[^/]+\/([^)]+?\.jar)\)/gm;
let m;
while ((m = re.exec(readme))) rows.push({ num: m[1], name: m[2], slug: m[3], category: m[4], desc: m[5], jar: m[6] });

const out = [];
for (const r of rows) {
  const file = path.join(jarDir, r.jar);
  if (!fs.existsSync(file)) { console.warn('missing jar', r.jar); continue; }
  const jar = new KP.Jar(fs.readFileSync(file));
  const props = KP.parseManifest(jar.text('META-INF/MANIFEST.MF') || '');
  let iconPath = props['MIDlet-Icon'] || ((props['MIDlet-1'] || '').split(',')[1] || '').trim();
  const icon = iconPath ? jar.get(iconPath.replace(/^\/+/, '')) : null;
  out.push({
    id: 'agneay-' + r.num,
    name: r.name,
    category: r.category,
    desc: r.desc.replace(/\s+/g, ' ').trim(),
    jarFile: r.jar,
    hasIcon: !!(icon && KP.isPng(icon)),
    iconBytes: icon && KP.isPng(icon) ? Buffer.from(icon).toString('base64') : null,
    size: '240x320',
    author: 'Agneay B Nair and contributors',
    license: 'MIT',
    source: 'https://github.com/agneay/j2me-100-games/tree/main/games/' + r.slug,
    controls: 'keypad',
  });
}
fs.writeFileSync(outJson, JSON.stringify(out, null, 1));
console.log('entries', out.length, 'with icons', out.filter((e) => e.hasIcon).length);
console.log('categories', JSON.stringify(out.reduce((a, e) => { a[e.category] = (a[e.category] || 0) + 1; return a; }, {})));
