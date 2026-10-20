// Gameplay thumbnails for catalog entries: node shots.js <entries.json> <jarUrlPrefix> <outDir> [parallel]
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const [entriesFile, prefix, outDir, parArg] = process.argv.slice(2);
const entries = JSON.parse(fs.readFileSync(entriesFile, 'utf8').replace(/^\uFEFF/, ''));
const par = +(parArg || 3);
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--mute-audio'] });
  let next = 0, done = 0;
  const failures = [];
  async function worker() {
    const page = await browser.newPage();
    await page.setViewport({ width: 420, height: 860 });
    while (next < entries.length) {
      const e = entries[next++];
      const out = path.join(outDir, e.id + '.webp');
      try {
        const size = e.size ? '&size=' + e.size : '';
        await page.goto('http://localhost:8080/play.html?jar=' + prefix + encodeURIComponent(e.jarFile) + size + (e.rotate ? '&rotate=' + e.rotate : ''), { waitUntil: 'load' });
        await page.waitForFunction(() => window.KPDebug && window.KPDebug.emu, { timeout: 15000 });
        const key = (c) => page.evaluate((code) => { const m = KPDebug.emu; m.keyDown(code); setTimeout(() => m.keyUp(code), 120); }, c);
        await new Promise((r) => setTimeout(r, +(process.env.KP_WAIT || 2200)));
        await key(-5); await new Promise((r) => setTimeout(r, 900));
        await key(-5); await new Promise((r) => setTimeout(r, 900));
        await key(-4); await new Promise((r) => setTimeout(r, 700));
        const data = await page.evaluate((w, h) => {
          const src = KPDebug.emu.host.screen.front;
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, w, h);
          return c.toDataURL('image/webp', 0.82);
        }, 240, 320);
        fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
      } catch (x) { failures.push(e.id + ': ' + x.message); }
      done++;
      if (done % 10 === 0) console.log('shots', done + '/' + entries.length);
    }
    await page.close();
  }
  await Promise.all(Array.from({ length: par }, worker));
  console.log('failures', failures.length ? failures.join('\n') : 0);
  await browser.close();
})();


