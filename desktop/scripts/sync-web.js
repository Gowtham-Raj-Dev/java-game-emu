const fs = require('fs');
const path = require('path');

const rootWeb = path.resolve(__dirname, '../../web');
const targetWeb = path.resolve(__dirname, '../web');

console.log('Syncing web assets for desktop build:');
console.log('Source: ', rootWeb);
console.log('Target: ', targetWeb);

if (!fs.existsSync(rootWeb)) {
  console.error('Source web directory not found:', rootWeb);
  process.exit(1);
}

if (!fs.existsSync(targetWeb)) {
  fs.mkdirSync(targetWeb, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

const itemsToCopy = [
  'play.html',
  'app',
  'engine',
  'assets',
  'games',
  'version.json',
  'favicon.ico',
  'favicon-32x32.png',
  'favicon-48x48.png',
  'icon-192.png',
  'icon-512.png',
  'manifest.webmanifest'
];

for (const item of itemsToCopy) {
  const srcPath = path.join(rootWeb, item);
  const destPath = path.join(targetWeb, item);
  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, destPath);
    console.log(`Synced: ${item}`);
  }
}

console.log('Web assets synced successfully for desktop!');
