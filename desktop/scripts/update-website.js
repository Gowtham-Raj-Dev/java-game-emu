const fs = require('fs');
const path = require('path');

const indexPath = path.resolve(__dirname, '../../web/index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// 1. Pill
html = html.replace('J2ME emulator · Android &amp; browser', 'J2ME emulator · Android, Windows &amp; browser');

// 2. Hero CTA: add Windows download button
const oldCtaRegex = /<a class="btn primary" href="download\/JavaPlay\.apk" download>[\s\S]*?Download Android app\s*<\/a>/;
const newCta = `<a class="btn primary" href="download/JavaPlay.apk" download>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>
            Download Android app
          </a>
          <a class="btn" href="download/JavaPlay-Setup.exe" download title="Download JavaPlay for Windows (64-bit)">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="width:17px;height:17px;vertical-align:middle;margin-right:6px"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>
            Download Windows app (.exe)
          </a>`;

html = html.replace(oldCtaRegex, newCta);

// 3. FAQ computer
html = html.replace(
  '<p>Yes. Open Play in browser, add a .jar and use the keyboard or click the keypad. Use a recent Chrome or Edge.</p>',
  '<p>Yes! You can download the <strong><a href="download/JavaPlay-Setup.exe" download>JavaPlay Windows desktop app</a></strong> with offline play, keyboard &amp; gamepad controls, .jar file association and auto-updates, or play directly in your browser with <a href="play">Play in browser</a>.</p>'
);

// 4. Final CTA
html = html.replace(
  '<a class="btn" href="download/JavaPlay.apk" download>Get the app</a>',
  '<a class="btn" href="download/JavaPlay.apk" download>Android app</a>\n          <a class="btn" href="download/JavaPlay-Setup.exe" download>Windows app (.exe)</a>'
);

// 5. Footer nav
html = html.replace(
  '<li><a href="download/JavaPlay.apk" download>Android app</a></li>',
  '<li><a href="download/JavaPlay.apk" download>Android app</a></li>\n          <li><a href="download/JavaPlay-Setup.exe" download>Windows app (.exe)</a></li>'
);

// 6. Update script for Windows
html = html.replace(
  "const apk = 'download/JavaPlay.apk?v=' + encodeURIComponent(code);",
  "const isWin = new URLSearchParams(location.search).get('os') === 'win' || /Windows/i.test(navigator.userAgent);\n  const apk = (isWin ? 'download/JavaPlay-Setup.exe?v=' : 'download/JavaPlay.apk?v=') + encodeURIComponent(code);"
);
html = html.replace(
  "a.download = 'JavaPlay.apk';",
  "a.download = isWin ? 'JavaPlay-Setup.exe' : 'JavaPlay.apk';"
);

fs.writeFileSync(indexPath, html, 'utf8');
console.log('web/index.html updated successfully with Windows download links!');

// Also update web/games.html, web/about.html, etc.
const otherPages = ['games.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html'];
for (const page of otherPages) {
  const pPath = path.resolve(__dirname, '../../web', page);
  if (fs.existsSync(pPath)) {
    let content = fs.readFileSync(pPath, 'utf8');
    if (content.includes('<li><a href="download/JavaPlay.apk" download>Android app</a></li>') &&
        !content.includes('JavaPlay-Setup.exe')) {
      content = content.replace(
        '<li><a href="download/JavaPlay.apk" download>Android app</a></li>',
        '<li><a href="download/JavaPlay.apk" download>Android app</a></li>\n          <li><a href="download/JavaPlay-Setup.exe" download>Windows app (.exe)</a></li>'
      );
      fs.writeFileSync(pPath, content, 'utf8');
      console.log(`Updated footer in web/${page}`);
    }
  }
}
