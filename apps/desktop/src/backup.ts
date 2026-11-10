import * as fs from 'fs';
import * as path from 'path';

export interface UpgradeBackupOptions {
  now?: () => Date;
  copyDirectory?: (source: string, destination: string) => void;
}

export interface UpgradeBackupResult {
  changed: boolean;
  warning?: string;
  backupPath?: string;
}

function safeVersion(version: string): string {
  return version.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function backupBeforeUpgrade(
  userDataPath: string,
  currentVersion: string,
  log: (message: string) => void,
  options: UpgradeBackupOptions = {},
): UpgradeBackupResult {
  const statePath = path.join(userDataPath, 'state.json');
  const databasePath = path.join(userDataPath, 'database');
  let previousVersion: string | null = null;

  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as { version?: unknown };
      previousVersion = typeof state.version === 'string' ? state.version : 'inconnu';
    } catch (error) {
      previousVersion = 'inconnu';
      log(`Impossible de lire state.json; sauvegarde conservatrice: ${String(error)}`);
    }
  } else if (fs.existsSync(databasePath)) {
    previousVersion = 'inconnu';
  }

  const changed = previousVersion !== null && previousVersion !== currentVersion;
  let backupPath: string | undefined;
  let warning: string | undefined;
  let backupFailed = false;

  if (changed && previousVersion !== null && fs.existsSync(databasePath)) {
    const backupRoot = path.join(userDataPath, 'backups');
    const timestamp = (options.now?.() ?? new Date()).toISOString().replace(/[-:.]/g, '');
    backupPath = path.join(backupRoot, `database-${safeVersion(previousVersion)}-${timestamp}`);
    let copySucceeded = false;
    let backupCreated = false;

    try {
      fs.mkdirSync(backupRoot, { recursive: true });
      fs.mkdirSync(backupPath);
      backupCreated = true;
      (options.copyDirectory ?? ((source, destination) => fs.cpSync(source, destination, {
        recursive: true,
        errorOnExist: true,
        force: false,
      })))(
        databasePath,
        backupPath,
      );
      copySucceeded = true;

      const backups = fs.readdirSync(backupRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('database-'))
        .map((entry) => {
          const fullPath = path.join(backupRoot, entry.name);
          return { fullPath, mtime: fs.statSync(fullPath).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime || b.fullPath.localeCompare(a.fullPath));
      for (const oldBackup of backups.slice(2)) fs.rmSync(oldBackup.fullPath, { recursive: true, force: true });
    } catch (error) {
      warning = copySucceeded
        ? 'Le nettoyage des anciennes sauvegardes a échoué.'
        : 'La sauvegarde automatique des données avant mise à jour a échoué.';
      log(`${warning} ${String(error)}`);
      if (!copySucceeded) {
        backupFailed = true;
        try {
          if (backupCreated && fs.existsSync(backupPath)) {
            fs.rmSync(backupPath, { recursive: true, force: true });
          }
        } catch (cleanupError) {
          log(`Impossible de supprimer la sauvegarde incomplète: ${String(cleanupError)}`);
        }
        backupPath = undefined;
      }
    }
  }

  if (!backupFailed) {
    try {
      fs.mkdirSync(userDataPath, { recursive: true });
      const temporaryStatePath = `${statePath}.tmp`;
      fs.writeFileSync(temporaryStatePath, JSON.stringify({ version: currentVersion }, null, 2));
      fs.renameSync(temporaryStatePath, statePath);
    } catch (error) {
      warning ??= 'La version de l’application n’a pas pu être enregistrée.';
      log(`${warning} ${String(error)}`);
    }
  }

  return { changed, warning, backupPath };
}
