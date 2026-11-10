const { BrowserWindow, BrowserView, ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');

class MiniBrowser {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.window = null;
    this.view = null;
    this.downloadsDir = path.join(app.getPath('userData'), 'Downloads');
    if (!fs.existsSync(this.downloadsDir)) {
      fs.mkdirSync(this.downloadsDir, { recursive: true });
    }
    this.registerIpc();
  }

  registerIpc() {
    ipcMain.on('browser-go-back', () => {
      if (this.view && this.view.webContents.canGoBack()) {
        this.view.webContents.goBack();
      }
    });

    ipcMain.on('browser-go-forward', () => {
      if (this.view && this.view.webContents.canGoForward()) {
        this.view.webContents.goForward();
      }
    });

    ipcMain.on('browser-reload', () => {
      if (this.view) {
        this.view.webContents.reload();
      }
    });

    ipcMain.on('browser-close', () => {
      if (this.window) {
        this.window.close();
      }
    });

    ipcMain.on('browser-navigate', (event, url) => {
      if (this.view) {
        this.view.webContents.loadURL(url);
      }
    });

    ipcMain.on('browser-handle-download', (event, { name, filePath, start }) => {
      if (fs.existsSync(filePath)) {
        try {
          const buffer = fs.readFileSync(filePath);
          const base64 = buffer.toString('base64');
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('open-jar', {
              name,
              base64,
              start
            });
            if (start) {
              this.mainWindow.focus();
              if (this.window) this.window.close();
            }
          }
        } catch (e) {
          console.error('Error reading downloaded jar:', e);
        }
      }
    });
  }

  open(initialUrl = 'https://phoneky.com/games/') {
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus();
      if (initialUrl && this.view) {
        this.view.webContents.loadURL(initialUrl);
      }
      return;
    }

    const bounds = this.mainWindow.getBounds();
    this.window = new BrowserWindow({
      width: Math.min(1080, Math.max(800, bounds.width)),
      height: Math.min(840, Math.max(650, bounds.height)),
      x: bounds.x + 40,
      y: bounds.y + 40,
      parent: this.mainWindow,
      title: 'Find Java Games – JavaPlay Browser',
      backgroundColor: '#0E1014',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    this.window.loadFile(path.join(__dirname, 'browser-toolbar.html'));

    this.view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    this.window.setBrowserView(this.view);

    const updateViewBounds = () => {
      if (!this.window || this.window.isDestroyed()) return;
      const size = this.window.getContentSize();
      this.view.setBounds({ x: 0, y: 52, width: size[0], height: Math.max(0, size[1] - 52) });
    };

    updateViewBounds();
    this.window.on('resize', updateViewBounds);

    const ses = this.view.webContents.session;
    ses.on('will-download', (event, item, webContents) => {
      const fileName = item.getFilename();
      const isJar = fileName.toLowerCase().endsWith('.jar') || item.getMimeType().includes('java-archive');

      if (isJar) {
        const savePath = path.join(this.downloadsDir, fileName);
        item.setSavePath(savePath);

        item.once('done', (event, state) => {
          if (state === 'completed') {
            console.log('Downloaded jar:', savePath);
            if (this.window && !this.window.isDestroyed()) {
              this.window.webContents.send('browser-download-complete', {
                name: fileName,
                filePath: savePath
              });
            }
          }
        });
      }
    });

    const updateUrlBar = () => {
      if (!this.view || !this.window || this.window.isDestroyed()) return;
      const currentUrl = this.view.webContents.getURL();
      this.window.webContents.send('browser-url-changed', {
        url: currentUrl,
        canGoBack: this.view.webContents.canGoBack(),
        canGoForward: this.view.webContents.canGoForward()
      });
    };

    this.view.webContents.on('did-navigate', updateUrlBar);
    this.view.webContents.on('did-navigate-in-page', updateUrlBar);

    this.view.webContents.loadURL(initialUrl);

    this.window.on('closed', () => {
      this.window = null;
      this.view = null;
    });
  }
}

module.exports = MiniBrowser;
