const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.setAppUserModelId('com.yuza.launcher');

const startedHidden = process.argv.includes('--hidden');
let win = null;
let tray = null;

/* -------- config persistante (adresse du serveur) -------- */
const cfgPath = path.join(app.getPath('userData'), 'config.json');
function loadCfg() {
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    return {};
  }
}
function saveCfg(obj) {
  try {
    fs.writeFileSync(cfgPath, JSON.stringify(obj, null, 2));
  } catch {}
}
function apiBase() {
  return (
    process.env.YUZA_API || loadCfg().api || 'http://127.0.0.1:53134'
  ).replace(/\/+$/, '');
}

const ICON = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));

/* -------- fenêtre principale -------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 780,
    minHeight: 520,
    show: !startedHidden,
    backgroundColor: '#0b0c10',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));

  // app installée : fermer = réduire dans le tray (garde les notifs actives).
  // en dev : fermer = quitter normalement.
  win.on('close', (e) => {
    if (app.isPackaged && !app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  try {
    tray = new Tray(ICON.isEmpty() ? nativeImage.createEmpty() : ICON);
  } catch {
    return;
  }
  tray.setToolTip('Yuza Launcher');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir', click: () => showWindow() },
      { type: 'separator' },
      {
        label: 'Quitter',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => showWindow());
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

/* -------- instance unique (important avec l'auto-démarrage) -------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    // démarrage automatique à l'ouverture de session Windows
    // (uniquement pour l'app installée, pas en dev)
    if (app.isPackaged) {
      // 'name' explicite => valeur de registre déterministe, supprimée par le
      // désinstalleur (voir build/installer.nsh).
      app.setLoginItemSettings({
        openAtLogin: true,
        name: 'YuzaLauncher',
        args: ['--hidden'],
      });
    }
    createWindow();
    createTray();
  });
}

app.on('window-all-closed', () => {
  // app installée : on reste dans le tray. en dev : on quitte.
  if (!app.isPackaged) app.quit();
});

/* -------- IPC -------- */
ipcMain.handle('get-config', () => ({ api: apiBase() }));

ipcMain.handle('set-server', (_e, url) => {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  const c = loadCfg();
  c.api = clean;
  saveCfg(c);
  return { api: apiBase() };
});

ipcMain.on('focus-window', () => showWindow());

// Fenêtre Discord OAuth -> récupère la session signée par le backend.
ipcMain.handle('login', () => {
  const API = apiBase();
  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 520,
      height: 760,
      parent: win,
      modal: true,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });

    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      resolve(payload);
      setTimeout(() => {
        if (!authWin.isDestroyed()) authWin.close();
      }, 600);
    };

    const grab = async () => {
      const url = authWin.webContents.getURL();
      if (!url.startsWith(`${API}/auth/callback`)) return;
      try {
        const token = await authWin.webContents.executeJavaScript(
          'window.__YUZA_SESSION__ || null',
        );
        if (token) return finish({ ok: true, token });
        const reason = await authWin.webContents.executeJavaScript(
          'window.__YUZA_REASON__ || "unknown"',
        );
        finish({ ok: false, reason });
      } catch (e) {
        finish({ ok: false, reason: String(e) });
      }
    };

    authWin.webContents.on('did-finish-load', grab);
    authWin.webContents.on('did-redirect-navigation', grab);
    authWin.on('closed', () => {
      if (!done) resolve({ ok: false, reason: 'closed' });
    });

    authWin.loadURL(`${API}/auth/login`);
  });
});
