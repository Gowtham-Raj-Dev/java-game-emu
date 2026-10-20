// Local preview server: node serve.js  ->  http://localhost:8080
// Serves ./web (the GitHub Pages site). /_local/* maps to KP_LOCAL_DIR (test JARs kept outside the repo).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, 'web');
const localDir = process.env.KP_LOCAL_DIR || 'D:/Gowtham/toolchain/test-games';
const port = Number(process.env.PORT) || 8080;
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.apk': 'application/vnd.android.package-archive', '.jar': 'application/java-archive', '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let base = root;
  if (p.startsWith('/_local/')) { base = localDir; p = p.substring('/_local'.length); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(base, p));
  if (!file.startsWith(path.normalize(base))) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, '0.0.0.0', () => {
  console.log(`KeyPlay site: http://localhost:${port}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list) if (a.family === 'IPv4' && !a.internal) console.log(`On your phone (same WiFi): http://${a.address}:${port}`);
  }
});
