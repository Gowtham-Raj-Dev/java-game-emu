const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootWeb = path.resolve(__dirname, '../../web');
const desktopDir = path.resolve(__dirname, '..');
const distDir = path.join(desktopDir, 'dist');
const pkg = require('../package.json');

console.log('=== Building JavaPlay Windows Installer ===');
execSync('npm run dist', { cwd: desktopDir, stdio: 'inherit' });

console.log('=== Publishing Windows Build to Web Downloads ===');
const downloadDir = path.join(rootWeb, 'download');
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
}

// Locate generated setup file
const files = fs.readdirSync(distDir);
const setupFile = files.find(f => f.startsWith('JavaPlay-Setup') && f.endsWith('.exe'));

if (!setupFile) {
  console.error('Setup executable not found in dist directory!');
  process.exit(1);
}

const setupPath = path.join(distDir, setupFile);
const targetPath = path.join(downloadDir, 'JavaPlay-Setup.exe');

fs.copyFileSync(setupPath, targetPath);
const fileSizeKb = Math.round(fs.statSync(targetPath).size / 1024);
console.log(`Copied ${setupFile} to ${targetPath} (${fileSizeKb} KB)`);

// Update web/version.json
const versionJsonPath = path.join(rootWeb, 'version.json');
let versionInfo = {};
try {
  versionInfo = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
} catch (e) {
  versionInfo = { versionCode: 18, versionName: pkg.version };
}

const relCode = versionInfo.versionCode || 18;
const relName = pkg.version;

versionInfo.win = {
  versionCode: relCode,
  versionName: relName,
  kb: fileSizeKb,
  url: `https://javaplay.codelove.in/download/JavaPlay-Setup.exe?v=${relCode}`,
  notes: [
    'Windows Desktop app release with offline engine, keyboard & controller mapping, and in-app game downloader.'
  ]
};

fs.writeFileSync(versionJsonPath, JSON.stringify(versionInfo, null, 4) + '\n');
console.log(`Updated ${versionJsonPath} with Windows v${relName} (Build ${relCode}) metadata.`);
console.log('=== Published JavaPlay Windows Successfully! ===');
