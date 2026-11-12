import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { DataSource, EntityManager } from 'typeorm';
import { BackupCreator } from './backup-creator.js';
import { BackupData } from './backup-schema.js';
import { BackupCounts, BackupManifest, BackupMode, RestoreResult } from './backup-types.js';

export interface ExecuteRestoreOptions {
  data: BackupData;
  manifest: BackupManifest;
  mode: BackupMode;
  backupsDirectory: string;
  appVersion: string;
}

export class BackupRestorer {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Restores a backup in ONE atomic database transaction, after producing a safety backup.
   */
  async executeRestore(options: ExecuteRestoreOptions): Promise<RestoreResult> {
    const { data, manifest, mode, backupsDirectory, appVersion } = options;

    // 1. Create a safety backup first
    let safetyBackupPath: string;
    try {
      const creator = new BackupCreator(this.dataSource);
      const { buffer } = await creator.createArchive({ appVersion });

      const now = new Date();
      const timestamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const suffix = randomBytes(2).toString('hex');
      const autoDir = path.join(backupsDirectory, 'auto');
      safetyBackupPath = path.join(autoDir, `pre-restore-${timestamp}-${ms}-${suffix}.enisbackup`);

      BackupCreator.writeArchiveAtomically(safetyBackupPath, buffer);
    } catch (err) {
      throw new InternalServerErrorException(
        `Impossible de créer la sauvegarde de sécurité préalable. La restauration a été annulée et aucune donnée n’a été modifiée (${(err as Error).message}).`,
      );
    }

    // 2. Perform restoration inside ONE database transaction
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const em = queryRunner.manager;
      const restoredCounts: BackupCounts = {
        timetables: 0,
        sessions: 0,
        settings: 0,
        teacher_names: 0,
        room_labels: 0,
      };

      if (mode === 'replace') {
        // FK-safe deletion
        await em.query('DELETE FROM sessions');
        await em.query('DELETE FROM timetables');
        await em.query('DELETE FROM teacher_names');
        await em.query('DELETE FROM room_labels');
        await em.query("DELETE FROM settings WHERE key != 'backup'");

        // Insert timetables
        if (data.timetables.length > 0) {
          for (const chunk of this.chunkArray(data.timetables, 500)) {
            for (const t of chunk) {
              await em.query(
                `INSERT INTO timetables (id, name, institution, comment, "generatedAt", days, slots, rooms, files, "createdAt")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                  t.id,
                  t.name,
                  t.institution,
                  t.comment,
                  t.generatedAt,
                  JSON.stringify(t.days),
                  JSON.stringify(t.slots),
                  JSON.stringify(t.rooms),
                  JSON.stringify(t.files),
                  t.createdAt,
                ],
              );
            }
          }
        }
        restoredCounts.timetables = data.timetables.length;

        // Insert sessions
        if (data.sessions.length > 0) {
          for (const chunk of this.chunkArray(data.sessions, 500)) {
            for (const s of chunk) {
              await em.query(
                `INSERT INTO sessions (id, "timetableId", source, owner, day, slot, groups, teachers, "subjectCode", subject, room, frequency)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                  s.id,
                  s.timetableId,
                  s.source,
                  s.owner,
                  s.day,
                  s.slot,
                  s.groups,
                  s.teachers,
                  s.subjectCode,
                  s.subject,
                  s.room,
                  s.frequency,
                ],
              );
            }
          }
        }
        restoredCounts.sessions = data.sessions.length;

        // Insert settings (preserve backup settings)
        const seenKeys = new Set<string>();
        for (const setting of data.settings) {
          if (setting.key === 'backup') continue;
          if (seenKeys.has(setting.key)) {
            throw new BadRequestException(`Clé de paramètre en doublon détectée dans l’archive (« ${setting.key} »).`);
          }
          seenKeys.add(setting.key);
          await em.query(
            `INSERT INTO settings (key, value) VALUES ($1, $2)`,
            [setting.key, JSON.stringify(setting.value)],
          );
          restoredCounts.settings++;
        }

        // Insert teacher_names
        if (data.teacher_names.length > 0) {
          for (const chunk of this.chunkArray(data.teacher_names, 500)) {
            for (const tn of chunk) {
              await em.query(
                `INSERT INTO teacher_names (id, key, "sourceName", "displayName", "createdAt", "updatedAt")
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [tn.id, tn.key, tn.sourceName, tn.displayName, tn.createdAt, tn.updatedAt],
              );
            }
          }
        }
        restoredCounts.teacher_names = data.teacher_names.length;

        // Insert room_labels
        if (data.room_labels.length > 0) {
          for (const chunk of this.chunkArray(data.room_labels, 500)) {
            for (const rl of chunk) {
              await em.query(
                `INSERT INTO room_labels (id, key, "sourceName", "displayName", "createdAt", "updatedAt")
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [rl.id, rl.key, rl.sourceName, rl.displayName, rl.createdAt, rl.updatedAt],
              );
            }
          }
        }
        restoredCounts.room_labels = data.room_labels.length;

        // Reset sequences to max(id)
        await this.resetSequences(em);

        // Verification of counts
        const [[{ count: finalTimetables }], [{ count: finalSessions }]] = await Promise.all([
          em.query('SELECT COUNT(*)::int as count FROM timetables'),
          em.query('SELECT COUNT(*)::int as count FROM sessions'),
        ]);

        if (finalTimetables !== manifest.counts.timetables || finalSessions !== manifest.counts.sessions) {
          throw new BadRequestException(
            `Incohérence détectée après restauration (emplois du temps: ${finalTimetables}/${manifest.counts.timetables}, séances: ${finalSessions}/${manifest.counts.sessions}). Annulation.`,
          );
        }
      } else if (mode === 'merge') {
        // Merge mode: new UUIDs for timetables and sessions, overrides only where missing, settings untouched
        const idMap = new Map<string, string>();

        for (const t of data.timetables) {
          const newId = randomUUID();
          idMap.set(t.id, newId);

          await em.query(
            `INSERT INTO timetables (id, name, institution, comment, "generatedAt", days, slots, rooms, files, "createdAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              newId,
              t.name,
              t.institution,
              t.comment,
              t.generatedAt,
              JSON.stringify(t.days),
              JSON.stringify(t.slots),
              JSON.stringify(t.rooms),
              JSON.stringify(t.files),
              t.createdAt,
            ],
          );
          restoredCounts.timetables++;
        }

        // Sessions with remapped timetableId (serial IDs generated by DB)
        for (const s of data.sessions) {
          const remappedTimetableId = idMap.get(s.timetableId);
          if (!remappedTimetableId) {
            throw new BadRequestException(
              `Séance orpheline détectée pour l’emploi du temps « ${s.timetableId} ». Restauration interrompue.`,
            );
          }

          await em.query(
            `INSERT INTO sessions ("timetableId", source, owner, day, slot, groups, teachers, "subjectCode", subject, room, frequency)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              remappedTimetableId,
              s.source,
              s.owner,
              s.day,
              s.slot,
              s.groups,
              s.teachers,
              s.subjectCode,
              s.subject,
              s.room,
              s.frequency,
            ],
          );
          restoredCounts.sessions++;
        }

        // Overrides: only where key does not exist
        const existingTeacherKeys: Set<string> = new Set(
          (await em.query('SELECT key FROM teacher_names')).map((r: any) => r.key),
        );
        for (const tn of data.teacher_names) {
          if (!existingTeacherKeys.has(tn.key)) {
            await em.query(
              `INSERT INTO teacher_names (key, "sourceName", "displayName", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, $5)`,
              [tn.key, tn.sourceName, tn.displayName, tn.createdAt, tn.updatedAt],
            );
            restoredCounts.teacher_names++;
          }
        }

        const existingRoomKeys: Set<string> = new Set(
          (await em.query('SELECT key FROM room_labels')).map((r: any) => r.key),
        );
        for (const rl of data.room_labels) {
          if (!existingRoomKeys.has(rl.key)) {
            await em.query(
              `INSERT INTO room_labels (key, "sourceName", "displayName", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, $5)`,
              [rl.key, rl.sourceName, rl.displayName, rl.createdAt, rl.updatedAt],
            );
            restoredCounts.room_labels++;
          }
        }

        await this.resetSequences(em);
      }

      await queryRunner.commitTransaction();

      return {
        ok: true,
        mode,
        restoredCounts,
        safetyBackupPath,
      };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction().catch(() => {});
      }
      throw error;
    } finally {
      await queryRunner.release().catch(() => {});
    }
  }

  private async resetSequences(em: EntityManager): Promise<void> {
    await em.query(`
      SELECT setval('sessions_id_seq', COALESCE((SELECT MAX(id) FROM sessions), 1), (SELECT MAX(id) FROM sessions) IS NOT NULL);
      SELECT setval('teacher_names_id_seq', COALESCE((SELECT MAX(id) FROM teacher_names), 1), (SELECT MAX(id) FROM teacher_names) IS NOT NULL);
      SELECT setval('room_labels_id_seq', COALESCE((SELECT MAX(id) FROM room_labels), 1), (SELECT MAX(id) FROM room_labels) IS NOT NULL);
    `);
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}

