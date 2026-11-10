const { contextBridge, ipcRenderer } = require('electron');

// Native bridge interface mimicking Android's JavaPlayAndroid bridge,
// with full desktop enhancements (file picking, auto-updates, native drag-and-drop).
const bridge = {
  isDesktop: true,
  platform: 'win32',

  versionCode() {
    return ipcRenderer.sendSync('get-version-code');
  },

  versionName() {
    return ipcRenderer.sendSync('get-version-name');
  },

  openBrowser(url) {
    ipcRenderer.send('open-in-app-browser', url);
  },

  openExternal(url) {
    ipcRenderer.send('open-external', url);
  },

  vibrate(ms) {
    // Windows haptic feedback / subtle no-op
  },

  setOrientation(mode) {
    ipcRenderer.send('set-orientation', mode);
  },

  setFullscreen(on) {
    ipcRenderer.send('set-fullscreen', on);
  },

  saveFile(name, base64, mime) {
    ipcRenderer.send('save-file', { name, base64, mime });
  },

  // Desktop-specific extensions
  openJarDialog() {
    ipcRenderer.send('open-jar-dialog');
  },

  checkForUpdates() {
    ipcRenderer.send('check-for-updates');
  },

  startUpdate() {
    ipcRenderer.send('start-update');
  },

  installUpdateNow() {
    ipcRenderer.send('install-update-now');
  }
};

// Listen for messages from main process and dispatch them to the web app
window.addEventListener('DOMContentLoaded', () => {
  // Handle JAR file opened from Windows Explorer or command-line
  ipcRenderer.on('open-jar', (event, { name, base64, start }) => {
    if (window.JavaPlayApp && window.JavaPlayApp.openJarBase64) {
      window.JavaPlayApp.openJarBase64(name, base64, start);
    }
  });

  // Handle video saved callback
  ipcRenderer.on('video-saved-result', (event, success) => {
    if (window.JavaPlayApp && window.JavaPlayApp.videoSaved) {
      window.JavaPlayApp.videoSaved(success);
    }
  });

  // Update notifications from auto-updater
  ipcRenderer.on('update-available-notify', (event, data) => {
    window.dispatchEvent(new CustomEvent('javaplay:update-available', { detail: data }));
  });

  ipcRenderer.on('update-download-progress', (event, progress) => {
    window.dispatchEvent(new CustomEvent('javaplay:update-progress', { detail: progress }));
  });

  ipcRenderer.on('update-downloaded-notify', (event, data) => {
    window.dispatchEvent(new CustomEvent('javaplay:update-ready', { detail: data }));
  });
});

// Expose on window as JavaPlayAndroid (for 100% Android code compatibility)
// and JavaPlayDesktop (for clear desktop identification)
try {
  contextBridge.exposeInMainWorld('JavaPlayAndroid', bridge);
  contextBridge.exposeInMainWorld('JavaPlayDesktop', bridge);
} catch (e) {
  // If contextIsolation is off or in fallback mode
  window.JavaPlayAndroid = bridge;
  window.JavaPlayDesktop = bridge;
}
