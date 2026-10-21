// Headless smoke test: run a J2ME JAR on the JavaPlay engine in Node (no-op canvas) and press some keys.
// usage: node run-jar.js <file.jar> [seconds] [keys...]   keys like  2000:-5 (at ms : code)
const fs = require('fs');
const KP = require('./load-engine.js')(['inflate.js', 'zip.js', 'png.js', 'classfile.js', 'vm.js', 'jlib.js', 'midp-lcdui.js', 'midp-ui.js', 'midp-game.js', 'audio.js', 'midp-misc.js', 'launcher.js']);

const file = process.argv[2];
const secs = +(process.argv[3] || 6);
const keys = process.argv.slice(4).map((k) => k.split(':').map(Number));
globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));

let presents = 0;
const store = new Map();
const emu = new KP.Emulator({
  jarBytes: new Uint8Array(fs.readFileSync(file)),
  fileName: file,
  host: {
    present: () => { presents++; },
    storage: { load: (k) => store.get(k) || null, save: (k, v) => store.set(k, v), remove: (k) => store.delete(k), list: (p) => [...store.keys()].filter((k) => k.startsWith(p)) },
    setSoftLabels: (l, r) => console.log('[soft] "' + l + '" | "' + r + '"'),
    onCanvasShown: (c) => console.log('[shown] canvas ' + c.__cls.name),
    onScreenShown: (s) => console.log('[shown] screen ' + s._screen + ' "' + (s._title || '') + '"'),
    exit: () => console.log('[exit]'),
  },
  log: (s) => console.log('[game] ' + s),
  warn: (s) => console.log('[warn] ' + s),
  onError: (m) => console.log('[ERROR] ' + m),
});
console.log('profile', JSON.stringify(emu.profile), 'midlet', emu.midletEntry());
const t0 = Date.now();
emu.start();
for (const [at, code] of keys) {
  setTimeout(() => { console.log('[key] ' + code); emu.keyDown(code); setTimeout(() => emu.keyUp(code), 120); }, at);
}
setTimeout(() => {
  const vm = emu.vm;
  console.log('--- after ' + secs + 's: presents=' + presents + ' threads=' + vm.threads.map((t) => t.name + '@' + vm.where(t)).join(' | '));
  const d = vm.display;
  console.log('current:', d && d._current ? vm.classOf(d._current).name : null);
  emu.stop();
  process.exit(0);
}, secs * 1000);
