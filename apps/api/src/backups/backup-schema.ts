import { createHash } from 'node:crypto';
import { getMetadataArgsStorage } from 'typeorm';
import { BackupCounts, BackupManifest } from './backup-types.js';

export const BACKUP_SCHEMA_VERSION = 2;
export const BACKUP_FORMAT_VERSION = 1;

export const BACKUP_TABLES = [
  'timetables',
  'sessions',
  'settings',
  'teacher_names',
  'room_labels',
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SENSITIVE_KEY_REGEX = /(?:password|secret|database.*url|auth.*token)/i;

export interface BackupData {
  timetables: any[];
  sessions: any[];
  settings: any[];
  teacher_names: any[];
  room_labels: any[];
}

export type SchemaUpgrader = (data: BackupData) => BackupData;

export const SCHEMA_UPGRADERS: Record<number, SchemaUpgrader> = {
  // Key N upgrades schema from version N to version N + 1.
  1: (data) => ({
    ...data,
    timetables: data.timetables.map((t) => ({
      ...t,
      previousTimetableId: t.previousTimetableId ?? null,
    })),
  }),
};

export function upgradeBackupData(data: BackupData, fromVersion: number, targetVersion = BACKUP_SCHEMA_VERSION): BackupData {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new ValidationError(`Version de schéma de sauvegarde non valide (${fromVersion}).`);
  }
  let current = data;
  let v = fromVersion;
  while (v < targetVersion) {
    const upgrader = SCHEMA_UPGRADERS[v];
    if (!upgrader) {
      throw new Error(`Aucune fonction de migration (upgrader) enregistrée pour passer du schéma v${v} à v${v + 1}.`);
    }
    current = upgrader(current);
    v++;
  }
  return current;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateRow(table: BackupTableName, row: unknown, index: number): Record<string, any> {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new ValidationError(`Ligne ${index + 1} de « ${table} » invalide : objet attendu.`);
  }
  const r = row as Record<string, any>;

  switch (table) {
    case 'timetables': {
      if (typeof r.id !== 'string' || !UUID_REGEX.test(r.id)) {
        throw new ValidationError(`Ligne ${index + 1} de « timetables » : identifiant UUID invalide.`);
      }
      if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 255) {
        throw new ValidationError(`Ligne ${index + 1} de « timetables » : nom manquant ou trop long.`);
      }
      if (typeof r.institution !== 'string') r.institution = '';
      if (typeof r.comment !== 'string') r.comment = '';
      if (typeof r.generatedAt !== 'string') r.generatedAt = '';
      if (!Array.isArray(r.days)) throw new ValidationError(`Ligne ${index + 1} de « timetables » : liste des jours invalide.`);
      if (!Array.isArray(r.slots)) throw new ValidationError(`Ligne ${index + 1} de « timetables » : liste des créneaux invalide.`);
      for (let sIdx = 0; sIdx < r.slots.length; sIdx++) {
        const slot = r.slots[sIdx];
        if (!slot || typeof slot !== 'object' || typeof slot.raw !== 'string' || typeof slot.base !== 'string') {
          throw new ValidationError(`Ligne ${index + 1} de « timetables » : format du créneau ${sIdx + 1} invalide.`);
        }
      }
      if (!Array.isArray(r.rooms)) r.rooms = [];
      if (!Array.isArray(r.files)) r.files = [];
      if (r.createdAt && (typeof r.createdAt !== 'string' || isNaN(Date.parse(r.createdAt)))) {
        throw new ValidationError(`Ligne ${index + 1} de « timetables » : date de création invalide.`);
      }
      if (r.previousTimetableId && (typeof r.previousTimetableId !== 'string' || !UUID_REGEX.test(r.previousTimetableId))) {
        throw new ValidationError(`Ligne ${index + 1} de « timetables » : previousTimetableId UUID invalide.`);
      }
      return {
        id: r.id,
        name: r.name.trim(),
        institution: r.institution,
        comment: r.comment,
        generatedAt: r.generatedAt,
        days: r.days,
        slots: r.slots,
        rooms: r.rooms,
        files: r.files,
        previousTimetableId: r.previousTimetableId ?? null,
        createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
      };
    }

    case 'sessions': {
      if (typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id <= 0) {
        throw new ValidationError(`Ligne ${index + 1} de « sessions » : identifiant numérique invalide.`);
      }
      if (typeof r.timetableId !== 'string' || !UUID_REGEX.test(r.timetableId)) {
        throw new ValidationError(`Ligne ${index + 1} de « sessions » : timetableId UUID invalide.`);
      }
      if (r.source !== 'rooms' && r.source !== 'teachers' && r.source !== 'groups') {
        throw new ValidationError(`Ligne ${index + 1} de « sessions » : source invalide (« ${r.source} »).`);
      }
      if (typeof r.owner !== 'string' || !r.owner.trim()) {
        throw new ValidationError(`Ligne ${index + 1} de « sessions » : propriétaire manquant.`);
      }
      if (typeof r.day !== 'number' || !Number.isInteger(r.day) || r.day < 0 || r.day > 15) {
        throw new ValidationError(`Ligne ${index + 1} de « sessions » : indice de jour invalide.`);
      }
      if (typeof r.slot !== 'number' || !Number.isInteger(r.slot) || r.slot < 0 || r.slot > 30) {
        throw new ValidationError(`Ligne ${index + 1} de « sessions » : indice de créneau invalide.`);
      }
      return {
        id: r.id,
        timetableId: r.timetableId,
        source: r.source,
        owner: r.owner.trim(),
        day: r.day,
        slot: r.slot,
        groups: typeof r.groups === 'string' ? r.groups : '',
        teachers: typeof r.teachers === 'string' ? r.teachers : '',
        subjectCode: typeof r.subjectCode === 'string' ? r.subjectCode : '',
        subject: typeof r.subject === 'string' ? r.subject : '',
        room: typeof r.room === 'string' ? r.room : '',
        frequency: typeof r.frequency === 'string' ? r.frequency : '',
      };
    }

    case 'settings': {
      if (typeof r.key !== 'string' || !r.key.trim() || r.key.length > 255) {
        throw new ValidationError(`Ligne ${index + 1} de « settings » : clé invalide.`);
      }
      if (SENSITIVE_KEY_REGEX.test(r.key)) {
        throw new ValidationError(`Ligne ${index + 1} de « settings » : clé interdite (« ${r.key} »).`);
      }
      if (r.value === undefined) {
        throw new ValidationError(`Ligne ${index + 1} de « settings » : valeur manquante.`);
      }
      return {
        key: r.key.trim(),
        value: r.value,
      };
    }

    case 'teacher_names':
    case 'room_labels': {
      if (typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id <= 0) {
        throw new ValidationError(`Ligne ${index + 1} de « ${table} » : identifiant numérique invalide.`);
      }
      if (typeof r.key !== 'string' || !r.key.trim()) {
        throw new ValidationError(`Ligne ${index + 1} de « ${table} » : clé manquante.`);
      }
      if (typeof r.sourceName !== 'string' || !r.sourceName.trim() || r.sourceName.length > 255) {
        throw new ValidationError(`Ligne ${index + 1} de « ${table} » : sourceName invalide.`);
      }
      if (typeof r.displayName !== 'string' || !r.displayName.trim() || r.displayName.length > 60) {
        throw new ValidationError(`Ligne ${index + 1} de « ${table} » : displayName invalide.`);
      }
      if (r.createdAt && (typeof r.createdAt !== 'string' || isNaN(Date.parse(r.createdAt)))) {
        throw new ValidationError(`Ligne ${index + 1} de « ${table} » : date de création invalide.`);
      }
      if (r.updatedAt && (typeof r.updatedAt !== 'string' || isNaN(Date.parse(r.updatedAt)))) {
        throw new ValidationError(`Ligne ${index + 1} de « ${table} » : date de modification invalide.`);
      }
      return {
        id: r.id,
        key: r.key.trim(),
        sourceName: r.sourceName.trim(),
        displayName: r.displayName.trim(),
        createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
        updatedAt: r.updatedAt ? new Date(r.updatedAt) : new Date(),
      };
    }

    default: {
      const exhaustive: never = table;
      throw new ValidationError(`Table inconnue : ${exhaustive}`);
    }
  }
}

/**
 * Computes a SHA-256 fingerprint of the current TypeORM entity schemas.
 * Used in tests to guarantee that any entity modification requires updating
 * BACKUP_SCHEMA_VERSION and adding a migration upgrader.
 */
export function computeSchemaFingerprint(): string {
  const storage = getMetadataArgsStorage();

  const tables = storage.tables
    .filter((t) => typeof t.name === 'string' && BACKUP_TABLES.includes(t.name as BackupTableName))
    .map((t) => {
      const tableName = t.name as string;
      const targetFunc = typeof t.target === 'function' ? t.target : null;
      const target = targetFunc ? targetFunc.name : String(t.target);
      const cols = storage.columns
        .filter((c) => {
          if (c.target === t.target) return true;
          if (targetFunc && typeof c.target === 'function') {
            return targetFunc.prototype instanceof c.target;
          }
          return false;
        })
        .map((c) => ({
          propertyName: c.propertyName,
          mode: c.mode,
          options: c.options,
        }))
        .sort((a, b) => a.propertyName.localeCompare(b.propertyName));

      return {
        table: tableName,
        target,
        columns: cols,
      };
    })
    .sort((a, b) => a.table.localeCompare(b.table));

  const json = JSON.stringify(tables);
  return createHash('sha256').update(json).digest('hex');
}
