import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { EmbeddedDb, startEmbeddedPostgres } from './database';

let api: ChildProcess | null = null;
let win: BrowserWindow | null = null;
let apiLog = '';
let db: EmbeddedDb | null = null;
let splash: BrowserWindow | null = null;

/**
 * By default the app runs its own embedded PostgreSQL. To use an existing server instead, put
 * { "databaseUrl": "postgres://user:password@host:5432/dbname" } in <userData>/config.json.
 */
function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}
function readConfig(): { databaseUrl?: string | null } {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}
function ensureConfigFile() {
  if (!fs.existsSync(configPath())) {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ databaseUrl: null }, null, 2));
  }
  return configPath();
}

function resolveBackend() {
  if (app.isPackaged) {
    return { main: path.join(process.resourcesPath, 'api', 'dist', 'main.js'), web: path.join(process.resourcesPath, 'web'), cwd: path.join(process.resourcesPath, 'api') };
  }
  const apps = path.join(__dirname, '..', '..');
  return { main: path.join(apps, 'api', 'dist', 'main.js'), web: path.join(apps, 'web', 'out'), cwd: path.join(apps, 'api') };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForApi(port: number, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!api || api.exitCode !== null) throw new Error('Le serveur s\'est arrêté au démarrage.');
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Le serveur ne répond pas.');
}

async function startApi(): Promise<number> {
  const external = readConfig().databaseUrl;
  let databaseUrl = external || '';
  if (!databaseUrl) {
    db = await startEmbeddedPostgres(path.join(app.getPath('userData'), 'database'), await freePort(), (m) => { apiLog = (apiLog + m + '\n').slice(-4000); });
    databaseUrl = db.url;
  }
  const be = resolveBackend();
  if (!fs.existsSync(be.main)) throw new Error(`Backend introuvable : ${be.main}\nLancez « npm run build » à la racine du projet.`);
  const port = await freePort();
  api = spawn(process.execPath, [be.main], {
    cwd: be.cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port), WEB_DIR: be.web, DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (d: Buffer) => { apiLog = (apiLog + d.toString()).slice(-4000); };
  api.stdout!.on('data', keep);
  api.stderr!.on('data', keep);
  await waitForApi(port);
  return port;
}

function showSplash() {
  splash = new BrowserWindow({ width: 380, height: 150, frame: false, resizable: false, alwaysOnTop: true, show: true, backgroundColor: '#1d2733' });
  const html = '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#1d2733;color:#fff;font:15px system-ui,sans-serif;text-align:center"><div><b style="font-size:18px">Emplois du temps ENISo</b><br><br>Démarrage…</div></body>';
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

async function createWindow(port: number) {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: 'Emplois du temps ENISo',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const origin = `http://127.0.0.1:${port}`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); shell.openExternal(url); } });
  await win.loadURL(origin);
  splash?.close();
  splash = null;
}

function showStartupError(err: Error) {
  splash?.close();
  const hint = readConfig().databaseUrl
    ? '\n\nLa connexion à PostgreSQL a échoué. Vérifiez que le serveur est démarré et que « databaseUrl » est correct dans le fichier de configuration.'
    : '\n\nLa base de données intégrée n\'a pas pu démarrer. Fermez les autres fenêtres de l\'application et réessayez.';
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: 'Démarrage impossible',
    message: err.message + hint,
    detail: apiLog.trim().split('\n').slice(-8).join('\n'),
    buttons: ['Ouvrir le dossier de configuration', 'Quitter'],
    defaultId: 1,
  });
  if (choice === 0) shell.showItemInFolder(ensureConfigFile());
}

ipcMain.handle('choose-folder', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Choisir le dossier de destination', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('show-in-folder', (_e, p: string) => shell.showItemInFolder(p));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Fichier', submenu: [
      { label: 'Fichier de configuration (base de données)…', click: () => shell.showItemInFolder(ensureConfigFile()) },
      { role: 'quit', label: 'Quitter' },
    ] },
    { label: 'Édition', submenu: [{ role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' }] },
    { label: 'Affichage', submenu: [{ role: 'reload', label: 'Recharger' }, { role: 'toggleDevTools', label: 'Outils de développement' }, { role: 'togglefullscreen', label: 'Plein écran' }] },
  ]));
  showSplash();
  try {
    await createWindow(await startApi());
  } catch (e) {
    showStartupError(e as Error);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', (e) => {
  api?.kill();
  if (db) {
    // let PostgreSQL shut down cleanly before the process exits
    e.preventDefault();
    const d = db;
    db = null;
    d.stop().catch(() => undefined).finally(() => app.quit());
  }
});
