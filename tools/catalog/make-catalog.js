// Merge licensed game sources into web/games/catalog.json (+ icons, thumbnails).
// usage: node make-catalog.js <shotsDir> <entries1.json> [entries2.json ...]
// Each entry: { id, name, category, desc, jarFile (in web/games/free/), iconBytes?, size?, rotate?, author, license, source, controls? }
const fs = require('fs');
const path = require('path');

const web = path.join(__dirname, '..', '..', 'web', 'games');
const [shotsDir, ...lists] = process.argv.slice(2);
fs.mkdirSync(path.join(web, 'icons'), { recursive: true });
fs.mkdirSync(path.join(web, 'shots'), { recursive: true });

const games = [];
const seen = new Set();
for (const file of lists) {
  const entries = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  for (const e of entries) {
    if (seen.has(e.id)) continue;
    const jarPath = path.join(web, 'free', e.jarFile);
    if (!fs.existsSync(jarPath)) { console.warn('skip (no jar):', e.id); continue; }
    if (e.ok === false) { console.warn('skip (failed test):', e.id); continue; }
    seen.add(e.id);
    let icon = null, shot = null;
    if (e.iconBytes) { fs.writeFileSync(path.join(web, 'icons', e.id + '.png'), Buffer.from(e.iconBytes, 'base64')); icon = 'games/icons/' + e.id + '.png'; }
    const s = path.join(shotsDir, e.id + '.webp');
    if (fs.existsSync(s)) { fs.copyFileSync(s, path.join(web, 'shots', e.id + '.webp')); shot = 'games/shots/' + e.id + '.webp'; }
    games.push({
      id: e.id, name: e.name, cat: e.category, desc: e.desc,
      jar: 'games/free/' + e.jarFile, kb: Math.max(1, Math.round(fs.statSync(jarPath).size / 1024)),
      icon, shot, size: e.size || null, rotate: e.rotate || 0, controls: e.controls || 'keypad',
      author: e.author, license: e.license, source: e.source,
    });
  }
}
games.sort((a, b) => a.name.localeCompare(b.name));
const cats = {};
for (const g of games) cats[g.cat] = (cats[g.cat] || 0) + 1;
fs.writeFileSync(path.join(web, 'catalog.json'), JSON.stringify({ updated: new Date().toISOString().slice(0, 10), count: games.length, categories: cats, games }));
console.log('catalog:', games.length, 'games', JSON.stringify(cats));
