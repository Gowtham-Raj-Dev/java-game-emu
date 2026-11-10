const { app, BrowserWindow, Menu, MenuItem, dialog, shell, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const MiniBrowser = require('./browser-window');
const DesktopUpdater = require('./updater');

// Ensure dark theme for titlebars and menus
nativeTheme.themeSource = 'dark';

// Locate web assets directory
const webDir = fs.existsSync(path.join(__dirname, '..', 'web'))
  ? path.join(__dirname, '..', 'web')
  : path.join(__dirname, 'web');

// App version info
const pkg = require('../package.json');
let versionCode = 18;
try {
  const verInfo = JSON.parse(fs.readFileSync(path.join(webDir, 'version.json'), 'utf8'));
  versionCode = verInfo.versionCode || versionCode;
} catch (e) {}

let mainWindow = null;
let miniBrowser = null;
let updater = null;
let pendingJarToOpen = null;

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const jarPath = findJarInArgv(commandLine);
      if (jarPath) {
        importJarFile(jarPath, true);
      }
    }
  });
}

function findJarInArgv(argv) {
  if (!argv || !Array.isArray(argv)) return null;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg && !arg.startsWith('--') && !arg.startsWith('-') && /\.jar$/i.test(arg) && fs.existsSync(arg)) {
      return arg;
    }
  }
  return null;
}

function importJarFile(filePath, start = true) {
  try {
    if (!fs.existsSync(filePath)) return;
    const name = path.basename(filePath);
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-jar', { name, base64, start });
    } else {
      pendingJarToOpen = { name, base64, start };
    }
  } catch (err) {
    console.error('Failed to import JAR:', err);
    if (mainWindow) {
      dialog.showErrorBox('Could not open file', `Failed to open ${path.basename(filePath)}: ${err.message}`);
    }
  }
}

function createMainWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 460,
    height: 820,
    minWidth: 380,
    minHeight: 620,
    title: 'JavaPlay – J2ME Emulator',
    backgroundColor: '#0E1014',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allows local file audio/games and IndexedDB without restriction
      allowRunningInsecureContent: true
    }
  });

  miniBrowser = new MiniBrowser(mainWindow);
  updater = new DesktopUpdater(mainWindow, versionCode, pkg.version);

  setupNativeMenu();

  // Load the web app
  const playHtmlPath = path.join(webDir, 'play.html');
  mainWindow.loadFile(playHtmlPath);

  mainWindow.webContents.on('did-finish-load', () => {
    // Check initial launch jar argument
    const initialJar = findJarInArgv(process.argv);
    if (initialJar) {
      importJarFile(initialJar, true);
    } else if (pendingJarToOpen) {
      mainWindow.webContents.send('open-jar', pendingJarToOpen);
      pendingJarToOpen = null;
    }

    // Auto-check for updates after 2.5 seconds
    setTimeout(() => {
      updater.checkForUpdates(false);
    }, 2500);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://phoneky.com') || url.startsWith('https://archive.org') || url.includes('google.com')) {
      miniBrowser.open(url);
    } else {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupNativeMenu() {
  const template = [
    {
      label: '&File',
      submenu: [
        {
          label: '&Open .jar Game...',
          accelerator: 'CmdOrCtrl+O',
          click: () => openJarFileDialog()
        },
        {
          label: 'Open &In-App Game Browser...',
          accelerator: 'CmdOrCtrl+B',
          click: () => miniBrowser.open('https://phoneky.com/games/')
        },
        { type: 'separator' },
        {
          label: 'Open &Videos Folder',
          click: () => {
            const vDir = path.join(app.getPath('videos'), 'JavaPlay');
            if (!fs.existsSync(vDir)) fs.mkdirSync(vDir, { recursive: true });
            shell.openPath(vDir);
          }
        },
        { type: 'separator' },
        {
          label: 'E&xit',
          accelerator: 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '&View',
      submenu: [
        {
          label: 'Toggle &Fullscreen',
          accelerator: 'F11',
          click: () => {
            if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
          }
        },
        {
          label: '&Reload Game',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.reload();
          }
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'Check for &Updates...',
          click: () => {
            if (updater) updater.checkForUpdates(true);
          }
        },
        { type: 'separator' },
        {
          label: 'JavaPlay &Website',
          click: () => shell.openExternal('https://javaplay.codelove.in')
        },
        {
          label: '&About JavaPlay',
          click: () => showAboutDialog()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function openJarFileDialog() {
  if (!mainWindow) return;
  dialog.showOpenDialog(mainWindow, {
    title: 'Select a Java Game (.jar)',
    filters: [
      { name: 'Java Games (*.jar)', extensions: ['jar'] },
      { name: 'All Files (*.*)', extensions: ['*'] }
    ],
    properties: ['openFile', 'multiSelections']
  }).then(result => {
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      result.filePaths.forEach((fPath, index) => {
        // Start the first one, add remaining to library
        importJarFile(fPath, index === 0);
      });
    }
  });
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About JavaPlay',
    message: `JavaPlay v${pkg.version} (Build ${versionCode})`,
    detail: 'Fast, lightweight J2ME phone game emulator for Windows and Android.\nPart of the CodeLove network.\n\nDeveloped by Gowtham.\nWebsite: https://javaplay.codelove.in',
    buttons: ['OK', 'Visit Website'],
    defaultId: 0
  }).then(res => {
    if (res.response === 1) {
      shell.openExternal('https://javaplay.codelove.in');
    }
  });
}

// ---------------- IPC Handlers for JavaPlayAndroid Bridge ----------------
ipcMain.on('get-version-code', (event) => {
  event.returnValue = versionCode;
});

ipcMain.on('get-version-name', (event) => {
  event.returnValue = pkg.version;
});

ipcMain.on('open-in-app-browser', (event, url) => {
  if (miniBrowser) miniBrowser.open(url || 'https://phoneky.com/games/');
});

ipcMain.on('open-external', (event, url) => {
  if (!url) return;
  // If user tapped update in about dialog or update notification
  if (url.includes('?update=') && updater) {
    updater.checkForUpdates(true);
    return;
  }
  shell.openExternal(url);
});

ipcMain.on('set-orientation', (event, mode) => {
  if (!mainWindow) return;
  if (mode === 'landscape') {
    const b = mainWindow.getBounds();
    mainWindow.setBounds({ width: Math.max(760, b.width), height: Math.min(520, b.height) });
  } else if (mode === 'portrait') {
    mainWindow.setBounds({ width: 460, height: 820 });
  }
});

ipcMain.on('set-fullscreen', (event, on) => {
  if (mainWindow) {
    mainWindow.setFullScreen(Boolean(on));
  }
});

ipcMain.on('save-file', (event, { name, base64, mime }) => {
  try {
    const videoDir = path.join(app.getPath('videos'), 'JavaPlay');
    if (!fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
    }
    const targetFile = path.join(videoDir, name || `recording-${Date.now()}.webm`);
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(targetFile, buffer);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('video-saved-result', true);
    }
  } catch (e) {
    console.error('Failed to save recorded video:', e);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('video-saved-result', false);
    }
  }
});

ipcMain.on('open-jar-dialog', () => {
  openJarFileDialog();
});

ipcMain.on('check-for-updates', () => {
  if (updater) updater.checkForUpdates(true);
});

ipcMain.on('start-update', () => {
  if (updater) updater.startDownload();
});

ipcMain.on('install-update-now', () => {
  if (updater) updater.installAndRestart();
});

// App lifecycle
app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
