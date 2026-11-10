import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { backupBeforeUpgrade } from './backup';
import { assertEmbeddedDatabaseVersion, DatabaseVersionMismatchError, EmbeddedDb, startEmbeddedPostgres } from './database';
import { createUpdater } from './updater';

let api: ChildProcess | null = null;
let win: BrowserWindow | null = null;
let apiLog = '';
let db: EmbeddedDb | null = null;
let splash: BrowserWindow | null = null;
let updaterService: ReturnType<typeof createUpdater> | null = null;
let shutdownPromise: Promise<void> | null = null;
let servicesStopped = false;
let backupWarning: string | undefined;

/**
 * By default the app runs its own embedded PostgreSQL. To use an existing server instead, put
 * { "databaseUrl": "postgres://user:password@host:5432/dbname" } in <userData>/config.json.
 * Put "autoUpdate": false in <userData>/config.json to disable automatic update checks.
 */
function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}
function readConfig(): { databaseUrl?: string | null; autoUpdate?: boolean } {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}
function ensureConfigFile() {
  if (!fs.existsSync(configPath())) {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ databaseUrl: null, autoUpdate: true }, null, 2));
  }
  return configPath();
}

function appIconPath(name: 'icon.png' | 'icon-small.png') {
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, '..', 'build', name);
}

function logUpdate(message: string) {
  const logDirectory = path.join(app.getPath('userData'), 'logs');
  const logFile = path.join(logDirectory, 'update.log');
  try {
    fs.mkdirSync(logDirectory, { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size >= 1_000_000) {
      const previousLog = `${logFile}.1`;
      if (fs.existsSync(previousLog)) fs.unlinkSync(previousLog);
      fs.renameSync(logFile, previousLog);
    }
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
  } catch (error) {
    console.error('Impossible d’écrire le journal de mise à jour:', error);
  }
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
  const config = readConfig();
  const external = config.databaseUrl;
  let databaseUrl = external || '';
  if (!databaseUrl) {
    const databaseDirectory = path.join(app.getPath('userData'), 'database');
    assertEmbeddedDatabaseVersion(databaseDirectory);
    db = await startEmbeddedPostgres(databaseDirectory, await freePort(), (m) => { apiLog = (apiLog + m + '\n').slice(-4000); });
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
  const icon = fs.readFileSync(appIconPath('icon-small.png')).toString('base64');
  splash = new BrowserWindow({ width: 380, height: 220, frame: false, resizable: false, alwaysOnTop: true, show: true, backgroundColor: '#1d2733' });
  const html = `<body style="margin:0;display:grid;place-items:center;height:100vh;background:#1d2733;color:#fff;font:15px system-ui,sans-serif;text-align:center"><div><img src="data:image/png;base64,${icon}" width="72" height="72" alt=""><br><b style="font-size:18px">Emplois du temps ENISo</b><br><br>Démarrage…</div></body>`;
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

async function createWindow(port: number) {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: 'Emplois du temps ENISo',
    show: false,
    icon: appIconPath('icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => {
    win?.show();
    splash?.close();
    splash = null;
    updaterService?.onMainWindowShown();
  });
  const origin = `http://127.0.0.1:${port}`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); shell.openExternal(url); } });
  await win.loadURL(origin);
}

function showStartupError(err: Error) {
  splash?.close();
  const versionMismatch = err instanceof DatabaseVersionMismatchError;
  const hint = readConfig().databaseUrl
    ? '\n\nLa connexion à PostgreSQL a échoué. Vérifiez que le serveur est démarré et que « databaseUrl » est correct dans le fichier de configuration.'
    : '\n\nLa base de données intégrée n\'a pas pu démarrer. Fermez les autres fenêtres de l\'application et réessayez.';
  const buttons = versionMismatch ? ['Ouvrir les sauvegardes', 'Quitter'] : ['Ouvrir le dossier de configuration', 'Quitter'];
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: 'Démarrage impossible',
    message: err.message + (versionMismatch ? '' : hint),
    detail: apiLog.trim().split('\n').slice(-8).join('\n'),
    buttons,
    defaultId: 1,
  });
  if (choice === 0) {
    if (versionMismatch) {
      const backupDirectory = path.join(app.getPath('userData'), 'backups');
      fs.mkdirSync(backupDirectory, { recursive: true });
      void shell.openPath(backupDirectory);
    } else {
      shell.showItemInFolder(ensureConfigFile());
    }
  }
}

function assertNoIpcArguments(args: unknown[]) {
  if (args.length !== 0) throw new Error('Arguments IPC inattendus.');
}

ipcMain.handle('choose-folder', async (_event, ...args: unknown[]) => {
  assertNoIpcArguments(args);
  const r = await dialog.showOpenDialog(win!, { title: 'Choisir le dossier de destination', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('show-in-folder', (_event, ...args: unknown[]) => {
  if (args.length !== 1 || typeof args[0] !== 'string' || !path.isAbsolute(args[0])) {
    throw new Error('Chemin de fichier invalide.');
  }
  shell.showItemInFolder(args[0]);
});
ipcMain.handle('get-version', (_event, ...args: unknown[]) => {
  assertNoIpcArguments(args);
  return app.getVersion();
});
ipcMain.handle('get-update-status', (_event, ...args: unknown[]) => {
  assertNoIpcArguments(args);
  return updaterService?.getStatus() ?? null;
});
ipcMain.handle('check-for-updates', async (_event, ...args: unknown[]) => {
  assertNoIpcArguments(args);
  await updaterService?.checkForUpdates(true);
});
ipcMain.handle('install-update', async (_event, ...args: unknown[]) => {
  assertNoIpcArguments(args);
  await updaterService?.installUpdate();
});

if (process.platform === 'win32') app.setAppUserModelId('tn.enis.timetable');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  showSplash();
  const userDataPath = app.getPath('userData');
  backupWarning = backupBeforeUpgrade(userDataPath, app.getVersion(), logUpdate).warning;
  const platformCanUpdate = process.platform === 'win32' || (process.platform === 'linux' && Boolean(process.env.APPIMAGE));
  autoUpdater.logger = {
    info: (message?: unknown) => logUpdate(`INFO ${String(message ?? '')}`),
    warn: (message?: unknown) => logUpdate(`WARN ${String(message ?? '')}`),
    error: (message?: unknown) => logUpdate(`ERROR ${String(message ?? '')}`),
    debug: (message: string) => logUpdate(`DEBUG ${message}`),
  };
  if (process.env.ENIS_FORCE_DEV_UPDATE_CONFIG === '1') autoUpdater.forceDevUpdateConfig = true;
  updaterService = createUpdater({
    app,
    updater: autoUpdater,
    dialog: {
      showMessageBox: (options) => win && !win.isDestroyed()
        ? dialog.showMessageBox(win, options)
        : dialog.showMessageBox(options),
    },
    enabled: readConfig().autoUpdate !== false,
    supportedPlatform: platformCanUpdate,
    log: logUpdate,
    sendStatus: (status) => {
      if (win && !win.isDestroyed()) win.webContents.send('update-status', status);
    },
    openReleasePage: () => shell.openExternal('https://github.com/mohamedalibenchiekh/enis-timetable/releases/latest'),
    stopBeforeInstall: stopServices,
    recoverAfterInstallFailure: async () => {
      logUpdate('Redémarrage de récupération après échec d’installation de la mise à jour.');
      try {
        await stopServices();
      } catch (error) {
        logUpdate(`Nouvel échec de l’arrêt avant redémarrage de récupération: ${String(error)}`);
      }
      app.relaunch();
      app.exit(1);
    },
  });
  updaterService.start();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Fichier', submenu: [
      { label: 'Fichier de configuration (base de données)…', click: () => shell.showItemInFolder(ensureConfigFile()) },
      { label: 'Rechercher des mises à jour…', click: () => { void updaterService?.checkForUpdates(true); } },
      { label: 'Ouvrir le dossier des sauvegardes', click: () => {
        const directory = path.join(app.getPath('userData'), 'backups');
        fs.mkdirSync(directory, { recursive: true });
        void shell.openPath(directory).then((error) => {
          if (error) dialog.showErrorBox('Ouverture impossible', error);
        });
      } },
      { role: 'quit', label: 'Quitter' },
    ] },
    { label: 'Édition', submenu: [{ role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' }] },
    { label: 'Affichage', submenu: [{ role: 'reload', label: 'Recharger' }, { role: 'toggleDevTools', label: 'Outils de développement' }, { role: 'togglefullscreen', label: 'Plein écran' }] },
  ]));
  try {
    await createWindow(await startApi());
    if (backupWarning) {
      void dialog.showMessageBox(win!, {
        type: 'warning',
        title: 'Sauvegarde des données',
        message: `${backupWarning} L’application continue, mais vérifiez vos données avant de poursuivre.`,
        buttons: ['OK'],
      }).catch((error: unknown) => logUpdate(`Impossible d’afficher l’avertissement de sauvegarde: ${String(error)}`));
    }
  } catch (e) {
    showStartupError(e instanceof Error ? e : new Error(String(e)));
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());

function stopServices(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  const attempt = (async () => {
    const child = api;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve, reject) => {
        let timeout: NodeJS.Timeout;
        const closed = () => {
          clearTimeout(timeout);
          resolve();
        };
        child.once('close', () => {
          closed();
        });
        timeout = setTimeout(() => {
          if (child.exitCode !== null || child.signalCode !== null) {
            closed();
            return;
          }
          if (!child.kill('SIGKILL')) {
            clearTimeout(timeout);
            reject(new Error('Le processus API ne répond pas à l’arrêt.'));
            return;
          }
          timeout = setTimeout(() => {
            clearTimeout(timeout);
            reject(new Error('Le processus API ne s’est pas arrêté après SIGKILL.'));
          }, 5_000);
        }, 5_000);
        if (!child.kill()) {
          clearTimeout(timeout);
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else reject(new Error('Impossible d’arrêter le processus API.'));
        }
      });
    }
    if (api === child) api = null;

    if (db) {
      const activeDatabase = db;
      await activeDatabase.stop();
      db = null;
    }
    servicesStopped = true;
  })();
  shutdownPromise = attempt.catch((error: unknown) => {
    shutdownPromise = null;
    throw error;
  });
  return shutdownPromise;
}

app.on('will-quit', (event) => {
  if (servicesStopped || (!api && !db)) return;
  event.preventDefault();
  void stopServices().then(() => app.quit()).catch((error: unknown) => {
    shutdownPromise = null;
    logUpdate(`Arrêt sécurisé impossible: ${String(error)}`);
    void dialog.showMessageBox({
      type: 'error',
      title: 'Arrêt impossible',
      message: 'Le serveur intégré n’a pas pu être arrêté proprement. Vous pouvez réessayer ou quitter quand même.',
      detail: String(error),
      buttons: ['Réessayer', 'Quitter quand même'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        app.quit();
      } else {
        logUpdate('Arrêt forcé choisi après échec de l’arrêt sécurisé.');
        app.exit(1);
      }
    }).catch((dialogError: unknown) => {
      logUpdate(`Impossible d’afficher les options d’arrêt: ${String(dialogError)}; arrêt forcé.`);
      app.exit(1);
    });
  });
});
