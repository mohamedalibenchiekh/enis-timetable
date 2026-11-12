import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import '../dist/entities/timetable.entity.js';
import {
  BACKUP_SCHEMA_VERSION,
  computeSchemaFingerprint,
  SCHEMA_UPGRADERS,
  upgradeBackupData,
} from '../src/backups/backup-schema.js';

// If this committed fingerprint changes, you MUST:
// 1. Increment BACKUP_SCHEMA_VERSION in apps/api/src/backups/backup-schema.ts
// 2. Register an upgrader function in SCHEMA_UPGRADERS in apps/api/src/backups/backup-schema.ts
// 3. Update COMMITTED_SCHEMA_FINGERPRINT below to the new hash.
export const COMMITTED_SCHEMA_FINGERPRINT = 'f3f61cd5c33d873981d7f8da966186e7e6b69d0bbae9fe87a5c0a10991d90a80';

describe('Backup schema safety and fingerprint guard', () => {
  it('schema fingerprint matches committed entity definitions', () => {
    const currentFingerprint = computeSchemaFingerprint();
    expect(
      currentFingerprint,
      `
====================================================================================
ERREUR DE SÉCURITÉ DE SCHÉMA DE SAUVEGARDE :
Les entités TypeORM ont été modifiées !
L'empreinte actuelle (${currentFingerprint}) ne correspond plus à l'empreinte enregistrée (${COMMITTED_SCHEMA_FINGERPRINT}).

Procédure obligatoire :
1. Incrémentez BACKUP_SCHEMA_VERSION dans apps/api/src/backups/backup-schema.ts (actuellement v${BACKUP_SCHEMA_VERSION}).
2. Ajoutez une fonction de migration dans SCHEMA_UPGRADERS pour transformer les sauvegardes v${BACKUP_SCHEMA_VERSION} en v${BACKUP_SCHEMA_VERSION + 1}.
3. Mettez à jour COMMITTED_SCHEMA_FINGERPRINT dans ce fichier de test avec la nouvelle empreinte.
====================================================================================
`,
    ).toBe(COMMITTED_SCHEMA_FINGERPRINT);
  });

  it('upgradeBackupData applies sequential upgraders', () => {
    const initialData = {
      timetables: [{ id: '123' }],
      sessions: [],
      settings: [],
      teacher_names: [],
      room_labels: [],
    };

    // If target is same as fromVersion, returns input unchanged
    expect(upgradeBackupData(initialData, 1, 1)).toEqual(initialData);

    // Rejects non-integer or negative fromVersion
    expect(() => upgradeBackupData(initialData, 1.5, 2)).toThrow(/non valide/);
    expect(() => upgradeBackupData(initialData, 0, 1)).toThrow(/non valide/);

    // Register temporary sequential upgraders: v1 -> v2, v2 -> v3
    const originalUpgraders = { ...SCHEMA_UPGRADERS };
    try {
      SCHEMA_UPGRADERS[1] = (data) => ({
        ...data,
        timetables: data.timetables.map((t) => ({ ...t, step1: true })),
      });
      SCHEMA_UPGRADERS[2] = (data) => ({
        ...data,
        timetables: data.timetables.map((t) => ({ ...t, step2: true })),
      });

      const upgraded = upgradeBackupData(initialData, 1, 3);
      expect(upgraded.timetables[0]).toEqual({
        id: '123',
        step1: true,
        step2: true,
      });

      // Missing intermediate upgrader throws error
      delete SCHEMA_UPGRADERS[2];
      expect(() => upgradeBackupData(initialData, 1, 3)).toThrow(
        'Aucune fonction de migration (upgrader) enregistrée pour passer du schéma v2 à v3.',
      );
    } finally {
      // Restore shared map
      for (const key of Object.keys(SCHEMA_UPGRADERS)) {
        delete SCHEMA_UPGRADERS[Number(key)];
      }
      Object.assign(SCHEMA_UPGRADERS, originalUpgraders);
    }
  });
});
