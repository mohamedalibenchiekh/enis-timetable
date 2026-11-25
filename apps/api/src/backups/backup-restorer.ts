import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { DataSource, EntityManager } from 'typeorm';
import { BackupCreator } from './backup-creator.js';
import { BackupData } from './backup-schema.js';
import { BackupCounts, BackupManifest, BackupMode, RestoreResult } from './backup-types.js';
import { SEEDED_ROOM_ALIASES } from '../masters/seeded-aliases.js';

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
        known_rooms: 0,
        programs: 0, program_slots: 0, program_sessions: 0, teacher_aliases: 0, room_aliases: 0, program_revisions: 0,
      };

      if (mode === 'replace') {
        // FK-safe deletion
        await em.query('DELETE FROM sessions');
        await em.query('DELETE FROM timetables');
        await em.query('DELETE FROM teacher_names');
        await em.query('DELETE FROM room_labels');
        await em.query('DELETE FROM known_rooms');
        await em.query('DELETE FROM program_revisions');
        await em.query('DELETE FROM program_sessions');
        await em.query('DELETE FROM program_slots');
        await em.query('DELETE FROM programs');
        await em.query('DELETE FROM teacher_aliases');
        await em.query('DELETE FROM room_aliases');
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

          // Restore previousTimetableId lineage (after all timetables exist to prevent FK issues)
          const timetableIdSet = new Set(data.timetables.map((t) => t.id));
          for (const t of data.timetables) {
            if (t.previousTimetableId && timetableIdSet.has(t.previousTimetableId)) {
              await em.query(
                `UPDATE timetables SET "previousTimetableId" = $1 WHERE id = $2`,
                [t.previousTimetableId, t.id],
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

        // Insert known_rooms
        if (data.known_rooms && data.known_rooms.length > 0) {
          const seenRoomNames = new Set<string>();
          for (const chunk of this.chunkArray(data.known_rooms, 500)) {
            for (const kr of chunk) {
              const normName = kr.name.trim().toLowerCase();
              if (seenRoomNames.has(normName)) {
                throw new BadRequestException(`Nom de salle en doublon détecté dans « known_rooms » (« ${kr.name} »).`);
              }
              seenRoomNames.add(normName);
              await em.query(
                `INSERT INTO known_rooms (id, name, "createdAt", "lastSeenAt")
                 VALUES ($1, $2, $3, $4)`,
                [kr.id, kr.name, kr.createdAt, kr.lastSeenAt],
              );
            }
          }
        }
        restoredCounts.known_rooms = data.known_rooms ? data.known_rooms.length : 0;

        for (const table of ['programs', 'program_slots', 'program_sessions', 'teacher_aliases', 'room_aliases', 'program_revisions'] as const) {
          await this.insertRows(em, table, data[table]);
          restoredCounts[table] = data[table].length;
        }
        for (const alias of SEEDED_ROOM_ALIASES) {
          await em.query('INSERT INTO room_aliases ("aliasName", "aliasKey", "canonicalName", seeded) VALUES ($1, $2, $3, TRUE) ON CONFLICT ("aliasKey") DO NOTHING', [alias.aliasName, alias.aliasKey, alias.canonicalName]);
        }

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

        // Restore remapped previousTimetableId lineage for merge mode
        for (const t of data.timetables) {
          if (t.previousTimetableId) {
            const remappedPrevId = idMap.get(t.previousTimetableId);
            if (remappedPrevId) {
              await em.query(
                `UPDATE timetables SET "previousTimetableId" = $1 WHERE id = $2`,
                [remappedPrevId, idMap.get(t.id)],
              );
            }
          }
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

        if (data.known_rooms && data.known_rooms.length > 0) {
          const existingRooms: Set<string> = new Set(
            (await em.query('SELECT name FROM known_rooms')).map((r: any) => r.name),
          );
          for (const kr of data.known_rooms) {
            if (!existingRooms.has(kr.name)) {
              await em.query(
                `INSERT INTO known_rooms (name, "createdAt", "lastSeenAt")
                 VALUES ($1, $2, $3)`,
                [kr.name, kr.createdAt, kr.lastSeenAt],
              );
              restoredCounts.known_rooms = (restoredCounts.known_rooms ?? 0) + 1;
            }
          }
        }

        const programIdMap = new Map<string, string>();
        for (const row of data.programs) {
          const id = randomUUID(); programIdMap.set(row.id, id);
          const newRevision = Number(await em.query('SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM programs WHERE code = $1', [row.code]).then((r: any[]) => r[0].revision));
          const hasCurrent = await em.query('SELECT 1 FROM programs WHERE code = $1 AND "isCurrent" = TRUE LIMIT 1', [row.code]);
          await this.insertRows(em, 'programs', [{ ...row, id, revision: newRevision, isCurrent: row.isCurrent && hasCurrent.length === 0 }]);
          restoredCounts.programs = (restoredCounts.programs ?? 0) + 1;
        }
        for (const row of data.program_slots) {
          const programId = programIdMap.get(row.programId);
          if (!programId) throw new BadRequestException(`Créneau orphelin : programme « ${row.programId} » introuvable dans la sauvegarde.`);
          const { id: _id, ...rest } = row; await this.insertRows(em, 'program_slots', [{ ...rest, programId }]);
          restoredCounts.program_slots = (restoredCounts.program_slots ?? 0) + 1;
        }
        for (const row of data.program_sessions) {
          const programId = programIdMap.get(row.programId);
          if (!programId) throw new BadRequestException(`Séance orpheline : programme « ${row.programId} » introuvable dans la sauvegarde.`);
          await this.insertRows(em, 'program_sessions', [{ ...row, id: randomUUID(), programId }]);
          restoredCounts.program_sessions = (restoredCounts.program_sessions ?? 0) + 1;
        }
        for (const row of (data.program_revisions ?? [])) {
          const programId = programIdMap.get(row.programId);
          if (!programId) continue;
          const { id: _id, ...rest } = row;
          await this.insertRows(em, 'program_revisions', [{ ...rest, programId }]);
          restoredCounts.program_revisions = (restoredCounts.program_revisions ?? 0) + 1;
        }
        for (const table of ['teacher_aliases', 'room_aliases'] as const) {
          for (const row of data[table]) {
            const exists = await em.query(`SELECT 1 FROM ${table} WHERE "aliasKey" = $1`, [row.aliasKey]);
            if (!exists.length) { const { id: _id, ...rest } = row; await this.insertRows(em, table, [rest]); restoredCounts[table] = (restoredCounts[table] ?? 0) + 1; }
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
      SELECT setval('known_rooms_id_seq', COALESCE((SELECT MAX(id) FROM known_rooms), 1), (SELECT MAX(id) FROM known_rooms) IS NOT NULL);
      SELECT setval('program_slots_id_seq', COALESCE((SELECT MAX(id) FROM program_slots), 1), (SELECT MAX(id) FROM program_slots) IS NOT NULL);
      SELECT setval('teacher_aliases_id_seq', COALESCE((SELECT MAX(id) FROM teacher_aliases), 1), (SELECT MAX(id) FROM teacher_aliases) IS NOT NULL);
      SELECT setval('room_aliases_id_seq', COALESCE((SELECT MAX(id) FROM room_aliases), 1), (SELECT MAX(id) FROM room_aliases) IS NOT NULL);
      SELECT setval('program_revisions_id_seq', COALESCE((SELECT MAX(id) FROM program_revisions), 1), (SELECT MAX(id) FROM program_revisions) IS NOT NULL);
    `);
  }

  private async insertRows(em: EntityManager, table: string, rows: Record<string, unknown>[]): Promise<void> {
    const allowedColumns: Record<string, Set<string>> = {
      programs: new Set(['id', 'code', 'title', 'kind', 'academicYear', 'semester', 'coordinator', 'formRef', 'effectiveFrom', 'footerText', 'version', 'revision', 'isCurrent', 'originalSnapshot', 'createdAt', 'updatedAt']),
      program_slots: new Set(['id', 'programId', 'index', 'label', 'rawLabel', 'base', 'dayOverrides', 'note']),
      program_sessions: new Set(['id', 'programId', 'day', 'slot', 'slotSpan', 'daySpan', 'title', 'code', 'teachers', 'teacherKeys', 'room', 'roomUnassigned', 'locationNote', 'frequency', 'tags', 'customTime', 'color', 'note', 'rawText', 'confidence', 'reasons', 'source']),
      teacher_aliases: new Set(['id', 'aliasKey', 'canonicalKey', 'aliasName', 'canonicalName', 'seeded', 'createdAt']),
      room_aliases: new Set(['id', 'aliasKey', 'canonicalName', 'aliasName', 'seeded', 'createdAt']),
      program_revisions: new Set(['id', 'programId', 'revision', 'snapshot', 'description', 'createdAt']),
    };
    const columnsForTable = allowedColumns[table];
    if (!columnsForTable) throw new Error(`Table non gérée : ${table}`);
    for (const row of rows) {
      const keys = Object.keys(row);
      if (!keys.length) continue;
      if (keys.some((key) => !columnsForTable.has(key))) throw new BadRequestException(`Champ inconnu dans la table de restauration « ${table} ».`);
      const columns = keys.map((key) => `"${key}"`).join(', ');
      const placeholders = keys.map((_key, index) => `$${index + 1}`).join(', ');
      const values = keys.map((key) => row[key] !== null && typeof row[key] === 'object' && !(row[key] instanceof Date) ? JSON.stringify(row[key]) : row[key]);
      await em.query(`INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`, values);
    }
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}

