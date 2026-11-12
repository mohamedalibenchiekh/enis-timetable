import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import { DataSource, Repository } from 'typeorm';
import { Setting } from '../entities/timetable.entity.js';
import { BackupCreator } from './backup-creator.js';
import { BackupInspector } from './backup-inspector.js';
import { BackupRestorer } from './backup-restorer.js';
import { BackupSchedulerService } from './backup-scheduler.js';
import {
  AutoBackupItem,
  BackupCounts,
  BackupManifest,
  BackupMode,
  BackupSettings,
  BackupsSummary,
  InspectResult,
  PreUpdateBackupItem,
  RestoreResult,
} from './backup-types.js';
import { MaintenanceService } from './maintenance.guard.js';

@Injectable()
export class BackupsService implements OnModuleInit {
  private readonly backupsDirectory: string;
  private readonly appVersion: string;
  public readonly scheduler: BackupSchedulerService;

  constructor(
    @InjectRepository(Setting) private readonly settingsRepo: Repository<Setting>,
    private readonly dataSource: DataSource,
    private readonly maintenanceService: MaintenanceService,
  ) {
    this.backupsDirectory = process.env.BACKUPS_DIR
      ? path.resolve(process.env.BACKUPS_DIR)
      : path.resolve(process.cwd(), 'backups');

    this.appVersion = process.env.APP_VERSION || '1.0.6';

    this.scheduler = new BackupSchedulerService(
      this.dataSource,
      this.backupsDirectory,
      this.appVersion,
      () => this.getSettings(),
    );
  }

  async onModuleInit(): Promise<void> {
    this.ensureDirectories();
    await this.scheduler.start();
  }

  private ensureDirectories(): void {
    fs.mkdirSync(this.backupsDirectory, { recursive: true });
    fs.mkdirSync(path.join(this.backupsDirectory, 'auto'), { recursive: true });
    fs.mkdirSync(path.join(this.backupsDirectory, 'manual'), { recursive: true });
    fs.mkdirSync(path.join(this.backupsDirectory, 'tmp'), { recursive: true });
  }

  async getSettings(): Promise<BackupSettings> {
    const row = await this.settingsRepo.findOneBy({ key: 'backup' });
    return {
      enabled: row?.value?.enabled !== false,
      retention: typeof row?.value?.retention === 'number'
        ? Math.max(3, Math.min(50, row.value.retention))
        : 10,
    };
  }

  async updateSettings(dto: Partial<BackupSettings>): Promise<BackupSettings> {
    const current = await this.getSettings();
    const next: BackupSettings = {
      enabled: dto.enabled !== undefined ? Boolean(dto.enabled) : current.enabled,
      retention: dto.retention !== undefined
        ? Math.max(3, Math.min(50, Number(dto.retention)))
        : current.retention,
    };
    await this.settingsRepo.save({ key: 'backup', value: next });
    return next;
  }

  /**
   * Returns complete backup summary: auto backups, pre-update snapshots, settings, and last run status.
   */
  async listBackups(): Promise<BackupsSummary> {
    this.ensureDirectories();
    const autoDir = path.join(this.backupsDirectory, 'auto');
    const autoFiles = fs.readdirSync(autoDir)
      .filter((name) => name.endsWith('.enisbackup'))
      .map((fileName) => {
        const fullPath = path.join(autoDir, fileName);
        return { fileName, fullPath, stat: fs.statSync(fullPath) };
      })
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    const autoBackups: AutoBackupItem[] = [];
    for (const item of autoFiles) {
      const summary = await this.readBackupManifestQuick(item.fullPath);
      const id = Buffer.from(item.fileName, 'utf8').toString('base64url');
      autoBackups.push({
        id,
        fileName: item.fileName,
        createdAt: summary?.createdAt || new Date(item.stat.mtimeMs).toISOString(),
        sizeBytes: item.stat.size,
        appVersion: summary?.appVersion || 'inconnue',
        schemaVersion: summary?.schemaVersion || 1,
        counts: summary?.counts || {
          timetables: 0,
          sessions: 0,
          settings: 0,
          teacher_names: 0,
          room_labels: 0,
        },
        isPreRestore: item.fileName.startsWith('pre-restore-'),
      });
    }

    // Pre-update database-<version>-<timestamp> folders
    const preUpdateBackups: PreUpdateBackupItem[] = [];
    const rootEntries = fs.readdirSync(this.backupsDirectory, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isDirectory() && entry.name.startsWith('database-')) {
        const fullPath = path.join(this.backupsDirectory, entry.name);
        const match = /^database-(.+)-(\d{8,14})$/.exec(entry.name);
        const version = match ? match[1] : 'inconnue';
        const stat = fs.statSync(fullPath);
        preUpdateBackups.push({
          id: entry.name,
          name: entry.name,
          version,
          createdAt: new Date(stat.mtimeMs).toISOString(),
          sizeBytes: this.getDirectorySize(fullPath),
          path: fullPath,
        });
      }
    }
    preUpdateBackups.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const settings = await this.getSettings();
    const schedulerStatus = this.scheduler.getStatus();

    return {
      autoBackups,
      preUpdateBackups,
      settings,
      lastAutoBackup: schedulerStatus,
    };
  }

  private async readBackupManifestQuick(filePath: string): Promise<BackupManifest | null> {
    try {
      const buffer = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(buffer);
      const manifestEntry = zip.file('manifest.json');
      if (!manifestEntry) return null;
      const text = await manifestEntry.async('text');
      return JSON.parse(text) as BackupManifest;
    } catch {
      return null;
    }
  }

  private getDirectorySize(dir: string): number {
    let total = 0;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          total += this.getDirectorySize(full);
        } else {
          total += fs.statSync(full).size;
        }
      }
    } catch { /* ignore */ }
    return total;
  }

  private resolveAutoFile(id: string): { fileName: string; fullPath: string } {
    let fileName: string;
    try {
      fileName = Buffer.from(id, 'base64url').toString('utf8');
    } catch {
      fileName = id;
    }
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\') || !fileName.endsWith('.enisbackup')) {
      throw new BadRequestException('Identifiant de sauvegarde invalide.');
    }
    const fullPath = path.join(this.backupsDirectory, 'auto', fileName);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException('Sauvegarde introuvable.');
    }
    return { fileName, fullPath };
  }

  /**
   * Creates a backup archive.
   */
  async createBackup(download = false): Promise<{ buffer: Buffer; fileName: string; filePath?: string; manifest: BackupManifest }> {
    return this.maintenanceService.runExclusive('createBackup', async () => {
      const creator = new BackupCreator(this.dataSource);
      const { buffer, manifest } = await creator.createArchive({ appVersion: this.appVersion });

      const now = new Date();
      const YYYY = now.getFullYear();
      const MM = String(now.getMonth() + 1).padStart(2, '0');
      const DD = String(now.getDate()).padStart(2, '0');
      const HH = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');

      if (download) {
        const fileName = `ENISo-sauvegarde-${YYYY}-${MM}-${DD}-${HH}${mm}.enisbackup`;
        return { buffer, fileName, manifest };
      } else {
        const ss = String(now.getSeconds()).padStart(2, '0');
        const fileName = `auto-${YYYY}${MM}${DD}-${HH}${mm}${ss}.enisbackup`;
        const filePath = path.join(this.backupsDirectory, 'auto', fileName);
        BackupCreator.writeArchiveAtomically(filePath, buffer);
        const settings = await this.getSettings();
        this.scheduler.pruneOldBackups(settings.retention);
        return { buffer, fileName, filePath, manifest };
      }
    });
  }

  getDownloadStream(id: string): { stream: fs.ReadStream; fileName: string; size: number } {
    const { fileName, fullPath } = this.resolveAutoFile(id);
    const stat = fs.statSync(fullPath);
    const stream = fs.createReadStream(fullPath);
    return { stream, fileName, size: stat.size };
  }

  async deleteAutoBackup(id: string): Promise<void> {
    const { fullPath } = this.resolveAutoFile(id);
    fs.unlinkSync(fullPath);
  }

  /**
   * Inspects a backup from an uploaded file or an existing auto backup id.
   */
  async inspectBackup(options: { fileBuffer?: Buffer; id?: string }): Promise<InspectResult> {
    let buffer: Buffer;
    let uploadToken: string | undefined;

    if (options.fileBuffer) {
      buffer = options.fileBuffer;
      uploadToken = randomUUID();
      const tmpPath = path.join(this.backupsDirectory, 'tmp', `inspect-${uploadToken}.enisbackup`);
      fs.writeFileSync(tmpPath, buffer);
    } else if (options.id) {
      const { fullPath } = this.resolveAutoFile(options.id);
      buffer = fs.readFileSync(fullPath);
    } else {
      throw new BadRequestException('Aucun fichier ou identifiant fourni pour l’inspection.');
    }

    const { inspectResult } = await BackupInspector.inspectArchive(buffer);
    if (uploadToken) {
      inspectResult.uploadToken = uploadToken;
    } else {
      inspectResult.id = options.id;
    }
    return inspectResult;
  }

  /**
   * Restores a backup.
   */
  async restoreBackup(options: { id?: string; uploadToken?: string; mode: BackupMode }): Promise<RestoreResult> {
    return this.maintenanceService.runExclusive('restoreBackup', async () => {
      this.maintenanceService.setMaintenance(true, 'Restauration en cours');

      let buffer: Buffer;
      let tempFilePath: string | null = null;

      try {
        if (options.uploadToken) {
          const safeToken = options.uploadToken.replace(/[^a-zA-Z0-9-]/g, '');
          tempFilePath = path.join(this.backupsDirectory, 'tmp', `inspect-${safeToken}.enisbackup`);
          if (!fs.existsSync(tempFilePath)) {
            throw new NotFoundException('Fichier de restauration temporaire expiré ou introuvable. Veuillez réessayer.');
          }
          buffer = fs.readFileSync(tempFilePath);
        } else if (options.id) {
          const { fullPath } = this.resolveAutoFile(options.id);
          buffer = fs.readFileSync(fullPath);
        } else {
          throw new BadRequestException('Identifiant ou jeton de restauration manquant.');
        }

        const { manifest, data } = await BackupInspector.inspectArchive(buffer);
        const restorer = new BackupRestorer(this.dataSource);
        const result = await restorer.executeRestore({
          data,
          manifest,
          mode: options.mode,
          backupsDirectory: this.backupsDirectory,
          appVersion: this.appVersion,
        });

        // Clean up temporary inspect file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch { /* ignore */ }
        }

        // Notify scheduler of data change
        this.scheduler.notifyDataChanged();

        return result;
      } finally {
        this.maintenanceService.setMaintenance(false);
      }
    });
  }
}
