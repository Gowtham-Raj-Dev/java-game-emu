const { app, dialog, shell } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

let autoUpdater = null;
try {
  // Try loading electron-updater if installed
  const eu = require('electron-updater');
  autoUpdater = eu.autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
} catch (e) {
  // Fall back to built-in updater
}

class DesktopUpdater {
  constructor(mainWindow, currentVersionCode = 18, currentVersionName = '2.6.6') {
    this.mainWindow = mainWindow;
    this.currentVersionCode = currentVersionCode;
    this.currentVersionName = currentVersionName;
    this.isChecking = false;
    this.isDownloading = false;
    this.downloadedFilePath = null;
    this.latestRelease = null;
    this.checkUrl = 'https://javaplay.codelove.in/version.json';
    this.githubApiUrl = 'https://api.github.com/repos/Gowtham-Raj-Dev/java-game-emu/releases/latest';

    if (autoUpdater) {
      this.initElectronUpdater();
    }
  }

  initElectronUpdater() {
    autoUpdater.on('update-available', (info) => {
      console.log('electron-updater: Update available:', info.version);
      this.notifyUpdateAvailable({
        versionName: info.version,
        notes: Array.isArray(info.releaseNotes) ? info.releaseNotes.map(n => n.note || n) : [info.releaseNotes || 'Bug fixes and improvements']
      });
    });

    autoUpdater.on('download-progress', (progressObj) => {
      this.notifyProgress({
        percent: Math.round(progressObj.percent),
        transferred: progressObj.transferred,
        total: progressObj.total
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('electron-updater: Update downloaded');
      this.notifyUpdateReady({ versionName: info.version });
    });

    autoUpdater.on('error', (err) => {
      console.warn('electron-updater error:', err.message);
    });
  }

  // Fetch JSON from URL
  fetchJson(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { headers: { 'User-Agent': 'JavaPlay-Desktop-App' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this.fetchJson(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(8000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  // Check for updates (manual = clicked button; false = background launch check)
  async checkForUpdates(manual = false) {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      // 1. First check remote version.json (same as Android app)
      let info = null;
      try {
        info = await this.fetchJson(`${this.checkUrl}?t=${Date.now()}`);
      } catch (err) {
        console.log('version.json check failed, trying GitHub Releases...', err.message);
      }

      // 2. Or check GitHub Releases if available
      let ghInfo = null;
      if (!info) {
        try {
          ghInfo = await this.fetchJson(this.githubApiUrl);
        } catch (e) {
          // Both failed
        }
      }

      let newVersionAvailable = false;
      let newVersionCode = 0;
      let newVersionName = '';
      let downloadUrl = '';
      let notes = [];

      if (info) {
        // Support Windows specific config in version.json (info.win) or fallback to top-level
        const win = info.win || {};
        newVersionCode = win.versionCode || info.versionCode || 0;
        newVersionName = win.versionName || info.versionName || '';
        notes = win.notes || info.notes || [];
        downloadUrl = win.url || win.exe || (info.apk ? info.apk.replace('JavaPlay.apk', 'JavaPlay-Setup.exe') : '');

        if (newVersionCode > this.currentVersionCode || this.isVersionGreater(newVersionName, this.currentVersionName)) {
          newVersionAvailable = true;
        }
      } else if (ghInfo && ghInfo.tag_name) {
        newVersionName = ghInfo.tag_name.replace(/^v/, '');
        notes = ghInfo.body ? ghInfo.body.split('\n').filter(Boolean) : [];
        const winAsset = (ghInfo.assets || []).find(a => a.name.endsWith('.exe'));
        if (winAsset) {
          downloadUrl = winAsset.browser_download_url;
        }
        if (this.isVersionGreater(newVersionName, this.currentVersionName)) {
          newVersionAvailable = true;
        }
      }

      if (!newVersionAvailable) {
        if (manual) {
          dialog.showMessageBox(this.mainWindow, {
            type: 'info',
            title: 'JavaPlay is Up to Date',
            message: `You are running the latest version of JavaPlay (${this.currentVersionName}).`,
            buttons: ['OK']
          });
        }
        this.isChecking = false;
        return;
      }

      this.latestRelease = {
        versionCode: newVersionCode,
        versionName: newVersionName,
        downloadUrl,
        notes
      };

      // Notify renderer
      this.notifyUpdateAvailable(this.latestRelease);

      // Show prompt to user
      const notesText = notes.length ? `\n\nRelease notes:\n• ${notes.join('\n• ')}` : '';
      const choice = await dialog.showMessageBox(this.mainWindow, {
        type: 'info',
        title: 'Update Available – JavaPlay',
        message: `A new version of JavaPlay (${newVersionName}) is available!${notesText}`,
        detail: 'Would you like to download and install this update automatically now?',
        buttons: ['Update Now', 'Remind Me Later'],
        defaultId: 0,
        cancelId: 1
      });

      if (choice.response === 0) {
        this.startDownload();
      }
    } catch (e) {
      console.warn('Update check error:', e);
      if (manual) {
        dialog.showMessageBox(this.mainWindow, {
          type: 'warning',
          title: 'Update Check',
          message: 'Unable to check for updates right now. Please check your internet connection.',
          buttons: ['OK']
        });
      }
    } finally {
      this.isChecking = false;
    }
  }

  isVersionGreater(newVer, curVer) {
    if (!newVer || !curVer) return false;
    const n = newVer.split('.').map(x => parseInt(x, 10) || 0);
    const c = curVer.split('.').map(x => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(n.length, c.length); i++) {
      const a = n[i] || 0;
      const b = c[i] || 0;
      if (a > b) return true;
      if (a < b) return false;
    }
    return false;
  }

  // Download update file
  startDownload() {
    if (this.isDownloading) return;
    if (autoUpdater && autoUpdater.downloadUpdate) {
      autoUpdater.downloadUpdate().catch(() => this.fallbackDownload());
      return;
    }
    this.fallbackDownload();
  }

  fallbackDownload() {
    if (!this.latestRelease || !this.latestRelease.downloadUrl) {
      // If no direct binary URL found, open download page in browser
      shell.openExternal('https://javaplay.codelove.in/#download');
      return;
    }

    this.isDownloading = true;
    const downloadUrl = this.latestRelease.downloadUrl;
    const tempDir = os.tmpdir();
    const destFile = path.join(tempDir, `JavaPlay-Setup-${this.latestRelease.versionName}.exe`);
    this.downloadedFilePath = destFile;

    const fileStream = fs.createWriteStream(destFile);
    console.log(`Downloading update from: ${downloadUrl}`);

    const client = downloadUrl.startsWith('https') ? https : http;
    const downloadRequest = (url) => {
      client.get(url, { headers: { 'User-Agent': 'JavaPlay-Desktop-App' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadRequest(res.headers.location);
        }
        if (res.statusCode !== 200) {
          this.isDownloading = false;
          dialog.showErrorBox('Update Download Failed', `Server returned HTTP ${res.statusCode}.`);
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let receivedBytes = 0;

        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
          this.notifyProgress({ percent, transferred: receivedBytes, total: totalBytes });
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            this.isDownloading = false;
            console.log('Update downloaded successfully:', destFile);
            this.notifyUpdateReady(this.latestRelease);
            this.promptInstall();
          });
        });
      }).on('error', (err) => {
        this.isDownloading = false;
        try { fs.unlinkSync(destFile); } catch (e) {}
        console.error('Download update error:', err);
        dialog.showErrorBox('Update Failed', 'Failed to download update: ' + err.message);
      });
    };

    downloadRequest(downloadUrl);
  }

  async promptInstall() {
    const res = await dialog.showMessageBox(this.mainWindow, {
      type: 'question',
      title: 'Update Ready to Install',
      message: 'JavaPlay update has been downloaded.',
      detail: 'The app will close and update to the new version. Would you like to restart now?',
      buttons: ['Restart and Install', 'Install Later'],
      defaultId: 0,
      cancelId: 1
    });

    if (res.response === 0) {
      this.installAndRestart();
    }
  }

  installAndRestart() {
    if (autoUpdater && autoUpdater.quitAndInstall) {
      try {
        autoUpdater.quitAndInstall(false, true);
        return;
      } catch (e) {}
    }

    if (this.downloadedFilePath && fs.existsSync(this.downloadedFilePath)) {
      console.log('Launching installer:', this.downloadedFilePath);
      // Run installer with /S for silent install or standard execution
      const child = spawn(this.downloadedFilePath, ['/S'], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      app.quit();
    }
  }

  notifyUpdateAvailable(data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-available-notify', data);
    }
  }

  notifyProgress(progress) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-download-progress', progress);
    }
  }

  notifyUpdateReady(data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-downloaded-notify', data);
    }
  }
}

module.exports = DesktopUpdater;
