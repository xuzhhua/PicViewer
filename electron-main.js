// PicViewer Electron Main Process
const { app, BrowserWindow, Tray, Menu, dialog, shell } = require('electron');
const path = require('path');

// === Keep a global reference to prevent GC ===
let mainWindow = null;
let tray = null;
let httpServer = null;
let serverPort = null;

// Window state persistence
const windowStateFile = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    if (require('fs').existsSync(windowStateFile)) {
      return JSON.parse(require('fs').readFileSync(windowStateFile, 'utf-8'));
    }
  } catch (_) {}
  return { width: 1280, height: 800, x: undefined, y: undefined, maximized: false };
}

function saveWindowState() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const state = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized: mainWindow.isMaximized(),
  };
  try {
    require('fs').writeFileSync(windowStateFile, JSON.stringify(state, null, 2));
  } catch (_) {}
}

// === Create the main browser window ===
function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    minWidth: 800,
    minHeight: 500,
    x: state.x,
    y: state.y,
    title: 'PicViewer',
    icon: path.join(__dirname, 'client', 'public', 'icons', 'icon-512.png'),
    backgroundColor: '#0c0c0e',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Allow loading localhost (the Express server)
      webSecurity: false,
    },
  });

  if (state.maximized) {
    mainWindow.maximize();
  }

  // Load the Express-served app
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // Show when ready (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', () => {
    saveWindowState();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// === System Tray ===
function createTray() {
  // Use a simple 16x16 PNG data-url for tray icon
  const iconPath = path.join(__dirname, 'client', 'public', 'icons', 'icon-192.png');
  try {
    tray = new Tray(iconPath);
  } catch (_) {
    // Fallback: create tray without icon
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示 PicViewer',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '打开浏览器',
      click: () => {
        shell.openExternal(`http://localhost:${serverPort}`);
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('PicViewer');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// === Prevent window close → hide to tray instead ===
function setupCloseToTray() {
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// === Application lifecycle ===
app.whenReady().then(async () => {
  // Build the React app first (in production) or trust dev mode
  const distPath = path.join(__dirname, 'client', 'dist');
  const fs = require('fs');

  if (!fs.existsSync(distPath) || !fs.existsSync(path.join(distPath, 'index.html'))) {
    console.log('[Electron] Client dist not found. Please run `npm run build` first.');
    console.log('[Electron] Starting in dev mode — ensure `npm run dev:client` is running.');
    // In dev mode, assume Vite dev server at 5173
    serverPort = 5173;
  } else {
    // Start the Express server
    try {
      const { startServer } = require('./server/index');
      const result = await startServer();
      httpServer = result.server;
      serverPort = result.port;
      console.log(`[Electron] Express server started on port ${serverPort}`);
    } catch (err) {
      console.error('[Electron] Failed to start server:', err.message);
      dialog.showErrorBox('启动失败', `无法启动 PicViewer 服务:\n${err.message}`);
      app.quit();
      return;
    }
  }

  createWindow();
  createTray();
  setupCloseToTray();

  app.on('activate', () => {
    // macOS: re-create window when dock icon clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  if (process.platform !== 'darwin') {
    // Don't quit — tray keeps running
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  // Clean up the HTTP server
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
});
