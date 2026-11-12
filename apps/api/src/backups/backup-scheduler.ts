import * as fs from 'node:fs';
import * as path from 'node:path';
import { DataSource } from 'typeorm';
import { BackupCreator } from './backup-creator.js';
import { BackupSettings, Clock } from './backup-types.js';

export const defaultClock: Clock = {
  now: () => new Date(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export class BackupSchedulerService {
  private debounceTimer: any = null;
  private lastSuccessAt: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly backupsDirectory: string,
    private readonly appVersion: string,
    private readonly getSettings: () => Promise<BackupSettings>,
    private readonly clock: Clock = defaultClock,
  ) {}

  /**
   * Initializes the scheduler: cleans stale temp files and verifies the startup 24h condition.
   */
  async start(): Promise<void> {
    try {
      BackupCreator.cleanStaleTempFiles(this.backupsDirectory);
      await this.checkStartupBackup();
    } catch (err) {
      this.lastError = (err as Error).message;
      console.warn(`[Sauvegardes] Avertissement au démarrage : ${this.lastError}`);
    }
  }

  /**
   * Called whenever timetables, sessions, names, or settings change.
   * Debounces the auto-backup by 30 seconds.
   */
  notifyDataChanged(): void {
    if (this.debounceTimer !== null) {
      this.clock.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = this.clock.setTimeout(async () => {
      this.debounceTimer = null;
      await this.triggerAutoBackup('data-change');
    }, 30_000);
  }

  /**
   * Checks whether the newest auto-backup is older than 24h (or none exists) and triggers one if needed.
   */
  async checkStartupBackup(): Promise<boolean> {
    const settings = await this.getSettings();
    if (!settings.enabled) return false;

    const autoDir = path.join(this.backupsDirectory, 'auto');
    if (!fs.existsSync(autoDir)) {
      await this.triggerAutoBackup('startup-no-backup');
      return true;
    }

    const files = fs.readdirSync(autoDir)
      .filter((f) => f.startsWith('auto-') && f.endsWith('.enisbackup'))
      .map((f) => {
        const full = path.join(autoDir, f);
        return { name: f, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    const newest = files[0];
    if (!newest) {
      await this.triggerAutoBackup('startup-no-backup');
      return true;
    }

    const ageMs = this.clock.now().getTime() - newest.mtime;
    const dayMs = 24 * 60 * 60 * 1000;
    if (ageMs >= dayMs) {
      await this.triggerAutoBackup('startup-older-than-24h');
      return true;
    }

    return false;
  }

  /**
   * Creates an automatic backup and prunes old ones according to retention.
   */
  async triggerAutoBackup(reason: string): Promise<string | null> {
    try {
      const settings = await this.getSettings();
      if (!settings.enabled) return null;

      const autoDir = path.join(this.backupsDirectory, 'auto');
      fs.mkdirSync(autoDir, { recursive: true });

      const now = this.clock.now();
      const ts = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const fileName = `auto-${ts}.enisbackup`;
      const targetPath = path.join(autoDir, fileName);

      const creator = new BackupCreator(this.dataSource);
      const { buffer } = await creator.createArchive({ appVersion: this.appVersion });

      BackupCreator.writeArchiveAtomically(targetPath, buffer);
      this.pruneOldBackups(settings.retention);

      this.lastSuccessAt = now.toISOString();
      this.lastError = null;
      return targetPath;
    } catch (err) {
      this.lastError = (err as Error).message;
      console.warn(`[Sauvegardes] Échec de la sauvegarde automatique (${reason}) : ${this.lastError}`);
      return null;
    }
  }

  /**
   * Prunes scheduled auto backups older than the retention limit.
   */
  pruneOldBackups(retention: number): void {
    const autoDir = path.join(this.backupsDirectory, 'auto');
    if (!fs.existsSync(autoDir)) return;

    const limit = Math.max(3, Math.min(50, retention));
    const autoFiles = fs.readdirSync(autoDir)
      .filter((f) => f.startsWith('auto-') && f.endsWith('.enisbackup'))
      .map((f) => {
        const full = path.join(autoDir, f);
        return { name: f, path: full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (autoFiles.length > limit) {
      const toDelete = autoFiles.slice(limit);
      for (const item of toDelete) {
        try {
          fs.unlinkSync(item.path);
        } catch { /* ignore */ }
      }
    }
  }

  getStatus(): { successAt: string | null; error: string | null } {
    return {
      successAt: this.lastSuccessAt,
      error: this.lastError,
    };
  }

  cancelPending(): void {
    if (this.debounceTimer !== null) {
      this.clock.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

