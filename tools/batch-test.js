// Smoke-test many JARs on the KeyPlay engine (headless). usage: node batch-test.js <dir-with-jars> <out.json> [parallel] [seconds]
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const dir = process.argv[2], out = process.argv[3];
const par = +(process.argv[4] || 4), secs = +(process.argv[5] || 6);
const jars = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar')).sort();
const results = {};
let next = 0, running = 0;

function runOne(file) {
  return new Promise((resolve) => {
    const args = [path.join(__dirname, 'run-jar.js'), path.join(dir, file), String(secs), '1500:-5', '2500:-5', '3200:-2', '3600:-4', '4000:-5', '4600:53', '5000:-1'];
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let txt = '';
    p.stdout.on('data', (d) => { txt += d; });
    p.stderr.on('data', (d) => { txt += d; });
    const kill = setTimeout(() => p.kill(), (secs + 10) * 1000);
    p.on('exit', () => {
      clearTimeout(kill);
      const prof = /profile (\{.*?\}) midlet (\S+)/.exec(txt);
      const presents = /presents=(\d+)/.exec(txt);
      const errors = txt.split('\n').filter((l) => /\[ERROR\]|Uncaught|Engine error/.test(l)).slice(0, 4);
      const missing = [...new Set(txt.split('\n').filter((l) => /Missing (class|method|field)/.test(l)).map((l) => l.replace('[warn] ', '').trim()))].slice(0, 8);
      resolve({
        profile: prof ? JSON.parse(prof[1]) : null,
        midlet: prof ? prof[2] : null,
        presents: presents ? +presents[1] : 0,
        errors, missing,
        finished: /--- after/.test(txt),
      });
    });
  });
}

function pump() {
  while (running < par && next < jars.length) {
    const f = jars[next++];
    running++;
    runOne(f).then((r) => {
      results[f] = r;
      running--;
      const status = !r.finished ? 'HANG' : r.errors.length ? 'ERROR' : r.presents < 2 ? 'NODRAW' : 'ok';
      console.log(String(Object.keys(results).length).padStart(3) + '/' + jars.length + ' ' + status.padEnd(6) + ' ' + f + ' presents=' + r.presents + (r.missing.length ? ' missing=' + r.missing.length : ''));
      if (Object.keys(results).length === jars.length) { fs.writeFileSync(out, JSON.stringify(results, null, 1)); process.exit(0); }
      pump();
    });
  }
}
pump();
