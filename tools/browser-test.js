// Drive the real KeyPlay web player in Edge: load a JAR, press keys over time, take screenshots, collect console output.
// usage: node browser-test.js <jarName in /_local/> <outPrefix> [w h] [steps...]
//   step:  wait:<ms> | key:<code>[:holdMs] | shot:<name> | tap:<x>:<y> (game coords)
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const [jar, out, vw, vh, ...steps] = process.argv.slice(2);

(async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: +(vw || 400), height: +(vh || 860), deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const logs = [];
  page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto('http://localhost:8080/play.html' + (jar ? '?jar=/_local/' + jar + (process.env.KP_Q || '') : ''), { waitUntil: 'load' });
  await page.waitForFunction((j) => !j || (window.KPDebug && window.KPDebug.emu), { timeout: 15000 }, jar).catch(() => logs.push('[test] emulator did not start'));
  for (const s of steps) {
    const [cmd, a, b] = s.split(':');
    if (cmd === 'wait') await new Promise((r) => setTimeout(r, +a));
    else if (cmd === 'key') {
      await page.evaluate((code, hold) => new Promise((r) => { const e = window.KPDebug.emu; e.keyDown(code); setTimeout(() => { e.keyUp(code); r(); }, hold); }), +a, +(b || 150));
    } else if (cmd === 'tap') {
      await page.evaluate((x, y) => { const e = window.KPDebug.emu; e.pointer('press', x, y); e.pointer('release', x, y); }, +a, +b);
    } else if (cmd === 'shot') {
      await page.screenshot({ path: out + '-' + a + '.png' });
    } else if (cmd === 'screen') {
      const data = await page.evaluate(() => document.getElementById('screen').toDataURL('image/png'));
      fs.writeFileSync(out + '-' + a + '.png', Buffer.from(data.split(',')[1], 'base64'));
    }
  }
  const info = await page.evaluate(() => {
    const e = window.KPDebug && window.KPDebug.emu;
    if (!e) return null;
    const vm = e.vm;
    return { profile: e.profile, threads: vm.threads.map((t) => t.name + '@' + vm.where(t)), current: vm.display && vm.display._current ? vm.classOf(vm.display._current).name : null };
  });
  console.log(JSON.stringify(info));
  console.log(logs.filter((l) => !/\[debug\]/.test(l)).slice(0, 40).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });


