export interface UpdateInfo {
  version: string;
}

export interface UpdateProgress {
  percent: number;
}

export type UpdateStatus =
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'progress'; version: string; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }
  | { status: 'none' };

export interface AutoUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on(event: 'checking-for-update', listener: () => void): unknown;
  on(event: 'update-available', listener: (info: UpdateInfo) => void): unknown;
  on(event: 'update-not-available', listener: (info: UpdateInfo) => void): unknown;
  on(event: 'download-progress', listener: (progress: UpdateProgress) => void): unknown;
  on(event: 'update-downloaded', listener: (info: UpdateInfo) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateDialog {
  showMessageBox(options: {
    type: 'info' | 'error';
    title: string;
    message: string;
    buttons: string[];
    defaultId?: number;
  }): Promise<{ response: number }>;
}

export interface UpdateServiceOptions {
  app: { isPackaged: boolean; getVersion(): string };
  updater: AutoUpdater;
  dialog: UpdateDialog;
  enabled: boolean;
  supportedPlatform: boolean;
  log(message: string): void;
  sendStatus(status: UpdateStatus): void;
  openReleasePage(): Promise<void>;
  stopBeforeInstall(): Promise<void>;
  recoverAfterInstallFailure(): Promise<void> | void;
}

const INITIAL_CHECK_DELAY_MS = 20_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function createUpdater(options: UpdateServiceOptions) {
  const { app, updater, dialog } = options;
  let manuallyChecking = false;
  let manualErrorShown = false;
  let downloadedVersion: string | null = null;
  let updateVersion: string | null = null;
  let latestStatus: UpdateStatus | null = null;
  let downloadedStatus: UpdateStatus | null = null;

  const publish = (status: UpdateStatus) => {
    latestStatus = status;
    if (status.status === 'downloaded') downloadedStatus = status;
    options.sendStatus(status);
  };

  const showManualError = (error: Error) => {
    if (!manuallyChecking || manualErrorShown) return;
    manualErrorShown = true;
    void dialog.showMessageBox({
      type: 'error',
      title: 'Recherche de mises à jour',
      message: `La recherche de mises à jour a échoué : ${error.message}`,
      buttons: ['OK'],
    }).catch((dialogError: unknown) => options.log(`Impossible d’afficher l’erreur de mise à jour: ${String(dialogError)}`));
  };

  const reportError = (error: Error) => {
    options.log(`Erreur de mise à jour: ${error.message}`);
    publish({ status: 'error', message: error.message });
    showManualError(error);
    manuallyChecking = false;
  };

  updater.on('checking-for-update', () => publish({ status: 'checking' }));
  updater.on('update-available', (info) => {
    updateVersion = info.version;
    options.log(`Mise à jour disponible: ${info.version}`);
    publish({ status: 'available', version: info.version });
  });
  updater.on('update-not-available', () => {
    options.log('Aucune mise à jour disponible.');
    publish({ status: 'none' });
    if (manuallyChecking) {
      manuallyChecking = false;
      void dialog.showMessageBox({
        type: 'info',
        title: 'Recherche de mises à jour',
        message: 'Vous avez la dernière version.',
        buttons: ['OK'],
      }).catch((error: unknown) => options.log(`Impossible d’afficher le résultat de mise à jour: ${String(error)}`));
    }
  });
  updater.on('download-progress', (progress) => {
    publish({
      status: 'progress',
      version: updateVersion ?? app.getVersion(),
      percent: Math.round(progress.percent),
    });
  });
  updater.on('update-downloaded', (info) => {
    downloadedVersion = info.version;
    manuallyChecking = false;
    options.log(`Mise à jour téléchargée: ${info.version}`);
    publish({ status: 'downloaded', version: info.version });
    void dialog.showMessageBox({
      type: 'info',
      title: 'Mise à jour prête',
      message: `La version ${info.version} est prête. Redémarrer maintenant pour l’installer ?`,
      buttons: ['Redémarrer maintenant', 'Plus tard'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) return installUpdate();
      return undefined;
    }).catch((error: unknown) => options.log(`Impossible d’afficher la confirmation de mise à jour: ${String(error)}`));
  });
  updater.on('error', (error) => reportError(error instanceof Error ? error : new Error(String(error))));

  async function installUpdate(): Promise<void> {
    if (!downloadedVersion) return;
    try {
      await options.stopBeforeInstall();
      updater.quitAndInstall();
    } catch (error) {
      const installError = error instanceof Error ? error : new Error(String(error));
      reportError(installError);
      try {
        await dialog.showMessageBox({
          type: 'error',
          title: 'Installation de la mise à jour',
          message: `La mise à jour n’a pas pu être installée : ${installError.message}`,
          buttons: ['OK'],
        });
      } catch (dialogError) {
        options.log(`Impossible d’afficher l’erreur d’installation: ${String(dialogError)}`);
      }
      try {
        await options.recoverAfterInstallFailure();
      } catch (recoveryError) {
        options.log(`Impossible de redémarrer l’application après l’échec de mise à jour: ${String(recoveryError)}`);
      }
    }
  }

  async function checkForUpdates(manual = false): Promise<void> {
    if (!manual && (!app.isPackaged || !options.enabled || !options.supportedPlatform)) return;
    if (manual) {
      manuallyChecking = false;
      manualErrorShown = false;
      if (!app.isPackaged) {
        await dialog.showMessageBox({
          type: 'info',
          title: 'Recherche de mises à jour',
          message: 'La recherche de mises à jour est disponible uniquement dans une version installée.',
          buttons: ['OK'],
        });
        return;
      }
      if (!options.enabled) {
        await dialog.showMessageBox({
          type: 'info',
          title: 'Recherche de mises à jour',
          message: 'Les mises à jour automatiques sont désactivées dans le fichier de configuration.',
          buttons: ['OK'],
        });
        return;
      }
      if (!options.supportedPlatform) {
        const { response } = await dialog.showMessageBox({
          type: 'info',
          title: 'Mises à jour',
          message: 'La mise à jour automatique n’est pas disponible sur cette plateforme. Ouvrir la page des versions ?',
          buttons: ['Ouvrir la page des versions', 'Plus tard'],
          defaultId: 0,
        });
        if (response === 0) {
          try {
            await options.openReleasePage();
          } catch (error) {
            const openError = error instanceof Error ? error : new Error(String(error));
            options.log(`Impossible d’ouvrir la page des versions: ${openError.message}`);
            await dialog.showMessageBox({
              type: 'error',
              title: 'Mises à jour',
              message: `Impossible d’ouvrir la page des versions : ${openError.message}`,
              buttons: ['OK'],
            });
          }
        }
        return;
      }
      manuallyChecking = true;
    }

    try {
      await updater.checkForUpdates();
    } catch (error) {
      reportError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function start(): void {
    if (!app.isPackaged) return;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
  }

  function onMainWindowShown(): void {
    if (!app.isPackaged || !options.enabled || !options.supportedPlatform) return;
    setTimeout(() => { void checkForUpdates(); }, INITIAL_CHECK_DELAY_MS);
    setInterval(() => { void checkForUpdates(); }, CHECK_INTERVAL_MS);
  }

  return {
    start,
    onMainWindowShown,
    checkForUpdates,
    installUpdate,
    getStatus: () => downloadedStatus ?? latestStatus,
  };
}
