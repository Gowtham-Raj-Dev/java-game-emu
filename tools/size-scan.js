// Count screen-size constants (sipush/bipush operands) in a JAR's bytecode: node size-scan.js game.jar
const fs = require('fs');
const KP = require('./load-engine.js')(['inflate.js', 'zip.js', 'png.js', 'classfile.js']);
const jar = new KP.Jar(fs.readFileSync(process.argv[2]));
const want = [128, 132, 160, 176, 208, 220, 240, 320, 352, 360, 400, 416, 480, 640, 800];
const count = {};
for (const n of jar.names()) {
  if (!n.endsWith('.class')) continue;
  const cf = KP.parseClass(jar.get(n));
  for (const m of cf.methods) {
    if (!m.code) continue;
    const c = m.code.code;
    for (let i = 0; i < c.length; i++) {
      if (c[i] === 0x11) { const v = (c[i + 1] << 8) | c[i + 2]; if (want.includes(v)) count[v] = (count[v] || 0) + 1; }
    }
  }
}
console.log(process.argv[2].split(/[\\/]/).pop(), JSON.stringify(count));
