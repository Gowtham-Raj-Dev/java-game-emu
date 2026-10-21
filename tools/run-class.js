// Run a compiled Java class directory on the JavaPlay VM in Node: node run-class.js <dir> <MainClass>
const fs = require('fs');
const path = require('path');
const KP = require('./load-engine.js')(['inflate.js', 'zip.js', 'png.js', 'classfile.js', 'vm.js', 'jlib.js']);

const dir = process.argv[2], main = process.argv[3];
const fakeJar = {
  get(name) { const p = path.join(dir, name); return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null; },
  has(name) { return fs.existsSync(path.join(dir, name)); },
};
const out = [];
const vm = new KP.VM({ jar: fakeJar, log: (s) => { out.push(s); console.log(s); }, warn: (s) => console.error('[warn] ' + s) });
const cls = vm.loadClass(main);
const m = cls.methods.get('main([Ljava/lang/String;)V');
const t = vm.newThread('main');
const args = []; args.$t = '[Ljava/lang/String;';
vm.pushInvoke(t, m, [args]);
// main needs class init first
vm.ensureInit(t, cls);
vm.schedule();
const started = Date.now();
const iv = setInterval(() => {
  if (!vm.threads.length || Date.now() - started > 20000) {
    clearInterval(iv);
    if (vm.threads.length) console.error('TIMEOUT, threads left: ' + vm.threads.map((x) => x.name + '@' + vm.where(x)).join(', '));
  }
}, 20);
