// Attach to the KeyPlay WebView on a device (adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>)
// and print engine state + recent console output. usage: node webview-probe.js [js-to-eval]
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes('keyplay.app')) || pages[0];
  const logs = [];
  page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  const extra = process.argv[2] || '';
  const r = await page.evaluate(async (code) => {
    const out = {};
    const e = window.KPDebug && window.KPDebug.emu;
    if (e) {
      const vm = e.vm;
      out.paused = e.paused; out.stopped = vm.stopped; out.timer = vm.timer !== null;
      out.threads = vm.threads.map((t) => t.name + '@' + vm.where(t) + (t.blocker ? ' [blocked]' : ''));
      out.queue = vm.display ? vm.display._queue.length : -1;
      out.hidden = document.hidden;
    }
    if (code) { try { out.eval = String(await eval(code)); } catch (x) { out.eval = 'ERR ' + x.message; } }
    return out;
  }, extra);
  await new Promise((res) => setTimeout(res, 1500));
  console.log(JSON.stringify(r, null, 1));
  console.log(logs.join('\n'));
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
