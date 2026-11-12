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
export const COMMITTED_SCHEMA_FINGERPRINT = '82e2087ed8643b5af0eab6afc30cdc4c7c1308cebefd495d8c1cb199b4d5ca15';

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

    // If an upgrader is missing for an older version, throws a clear French error
    expect(() => upgradeBackupData(initialData, 0, 1)).toThrow(
      'Aucune fonction de migration (upgrader) enregistrée pour passer du schéma v0 à v1.',
    );
  });
});
