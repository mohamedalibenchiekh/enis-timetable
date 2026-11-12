import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import { DataSource, EntityManager } from 'typeorm';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  BackupTableName,
} from './backup-schema.js';
import { BackupCounts, BackupManifest } from './backup-types.js';

export interface CreateArchiveOptions {
  appVersion: string;
  schemaVersion?: number;
}

export class BackupCreator {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Generates a complete logical backup archive inside a REPEATABLE READ snapshot.
   */
  async createArchive(options: CreateArchiveOptions): Promise<{ buffer: Buffer; manifest: BackupManifest }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('REPEATABLE READ');

    try {
      const em = queryRunner.manager;
      const counts: BackupCounts = {
        timetables: 0,
        sessions: 0,
        settings: 0,
        teacher_names: 0,
        room_labels: 0,
      };
      const sha256: Record<string, string> = {};
      const dataFiles: Record<string, Buffer> = {};

      for (const table of BACKUP_TABLES) {
        const rows = await this.readTableRows(em, table);
        counts[table] = rows.length;

        const ndjson = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
        const buffer = Buffer.from(ndjson, 'utf8');
        const hash = createHash('sha256').update(buffer).digest('hex');

        const filePath = `data/${table}.ndjson`;
        sha256[filePath] = hash;
        dataFiles[filePath] = buffer;
      }

      await queryRunner.commitTransaction();

      const manifest: BackupManifest = {
        formatVersion: BACKUP_FORMAT_VERSION,
        appVersion: options.appVersion,
        schemaVersion: options.schemaVersion ?? BACKUP_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        counts,
        sha256,
      };

      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
      for (const [filePath, buffer] of Object.entries(dataFiles)) {
        zip.file(filePath, buffer);
      }

      const archiveBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      return { buffer: archiveBuffer, manifest };
    } catch (error) {
      await queryRunner.rollbackTransaction().catch(() => {});
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async readTableRows(em: EntityManager, table: BackupTableName): Promise<any[]> {
    switch (table) {
      case 'timetables': {
        const rows = await em.query('SELECT * FROM timetables ORDER BY "createdAt" ASC, id ASC');
        return rows.map((r: any) => ({
          ...r,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        }));
      }
      case 'sessions': {
        return em.query('SELECT * FROM sessions ORDER BY id ASC');
      }
      case 'settings': {
        // Exclude sensitive keys (passwords, database URLs, auth secrets)
        const rows = await em.query(
          `SELECT * FROM settings 
           WHERE key NOT ILIKE '%password%' 
             AND key NOT ILIKE '%secret%' 
             AND key NOT ILIKE '%database%url%'
           ORDER BY key ASC`,
        );
        return rows;
      }
      case 'teacher_names': {
        const rows = await em.query('SELECT * FROM teacher_names ORDER BY id ASC');
        return rows.map((r: any) => ({
          ...r,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
          updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
        }));
      }
      case 'room_labels': {
        const rows = await em.query('SELECT * FROM room_labels ORDER BY id ASC');
        return rows.map((r: any) => ({
          ...r,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
          updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
        }));
      }
      default: {
        const exhaustive: never = table;
        throw new Error(`Table non gérée : ${exhaustive}`);
      }
    }
  }

  /**
   * Writes a backup buffer atomically to disk (temp file in same folder + fsync + rename).
   */
  static writeArchiveAtomically(targetPath: string, buffer: Buffer): void {
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });

    const tempPath = path.join(dir, `.tmp-${path.basename(targetPath)}-${randomUUID()}`);
    try {
      fs.writeFileSync(tempPath, buffer);
      const fd = fs.openSync(tempPath, 'r+');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fs.renameSync(tempPath, targetPath);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch { /* ignore */ }
      throw error;
    }
  }

  /**
   * Cleans stale temporary files left by interrupted atomic writes.
   */
  static cleanStaleTempFiles(rootDirectory: string): void {
    if (!fs.existsSync(rootDirectory)) return;

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.startsWith('.tmp-') || entry.name.endsWith('.tmp')) {
          try {
            fs.unlinkSync(full);
          } catch { /* ignore */ }
        }
      }
    };

    walk(rootDirectory);
  }
}

