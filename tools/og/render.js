// Renders tools/og/og.html to web/assets/og.png (1200x630) with a local Edge/Chrome.
// usage: node tools/og/render.js
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const browsers = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: browsers.find((b) => fs.existsSync(b)), headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630 });
  await page.goto('file:///' + path.join(__dirname, 'og.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(__dirname, '..', '..', 'web', 'assets', 'og.png');
  await page.screenshot({ path: out });
  await browser.close();
  console.log('wrote', out);
})();
