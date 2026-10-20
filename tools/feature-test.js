// Verify sound playback, RMS saves and video recording in the browser player with a real game.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const jar = process.argv[2] || 'diamondrush.jar';
const dl = process.argv[3];
(async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 860 });
  const cdp = await page.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: true }).catch(() => cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }));
  const logs = [];
  page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()));
  await page.evaluateOnNewDocument(() => {
    window.__audio = [];
    const wrap = () => {
      if (!window.KP || !KP.audio || KP.audio.__wrapped) return;
      KP.audio.__wrapped = true;
      for (const fn of ['play', 'playOtt', 'playToneSeq', 'tone', 'freqTone']) {
        const orig = KP.audio[fn];
        KP.audio[fn] = function (...a) { const b = a[0]; window.__audio.push(fn + (b && b.length ? ':' + b.length + 'B:' + KP.audio.kindOf(b, a[1]) : '')); return orig.apply(this, a); };
      }
    };
    document.addEventListener('DOMContentLoaded', wrap);
  });
  await page.goto('http://localhost:8080/play.html?jar=/_local/' + jar, { waitUntil: 'load' });
  await page.waitForFunction(() => window.KPDebug && window.KPDebug.emu, { timeout: 15000 });
  await page.mouse.click(200, 300); // user gesture -> unlock audio
  const key = (c, w) => page.evaluate((code) => { const e = KPDebug.emu; e.keyDown(code); setTimeout(() => e.keyUp(code), 150); }, c).then(() => new Promise((r) => setTimeout(r, w)));
  await new Promise((r) => setTimeout(r, 4000));
  await key(-5, 3000); // Sound ON
  await page.click('#recBtn');
  for (let i = 0; i < 4; i++) await key(-5, 3000);
  await new Promise((r) => setTimeout(r, 6000));
  await key(-4, 800); await key(-4, 800); await key(-2, 800);
  await page.click('#recBtn');
  await new Promise((r) => setTimeout(r, 3000));
  const res = await page.evaluate(() => ({
    audio: window.__audio.slice(0, 12), audioCalls: window.__audio.length,
    ctx: KP.audio.ctx && KP.audio.ctx.state,
    rms: Object.keys(localStorage).filter((k) => k.indexOf(':rms:') > 0),
    toast: document.getElementById('toast').textContent,
  }));
  console.log(JSON.stringify(res, null, 1));
  console.log('downloads:', fs.readdirSync(dl).map((f) => f + ' ' + fs.statSync(dl + '/' + f).size + 'B').join(', '));
  console.log(logs.filter((l) => !/^\[log\]/.test(l)).slice(0, 15).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
