import { describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { BackupInspector } from '../src/backups/backup-inspector.js';
import { BACKUP_FORMAT_VERSION, BACKUP_SCHEMA_VERSION } from '../src/backups/backup-schema.js';
import { BackupManifest } from '../src/backups/backup-types.js';

async function makeArchive(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

function validManifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: '1.0.6',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    counts: {
      timetables: 1,
      sessions: 1,
      settings: 0,
      teacher_names: 0,
      room_labels: 0,
    },
    sha256: {},
    ...overrides,
  };
}

describe('Hostile archive hardening & validation suite', () => {
  it('rejects empty or corrupt buffer', async () => {
    await expect(BackupInspector.inspectArchive(Buffer.alloc(0))).rejects.toThrow(
      'Fichier de sauvegarde vide ou manquant.',
    );
    await expect(BackupInspector.inspectArchive(Buffer.from('not a zip file'))).rejects.toThrow(
      'Le fichier sélectionné n’est pas une archive ZIP valide.',
    );
  });

  it('rejects archive with path traversal in entry names', async () => {
    const manifest = validManifest();
    const badZip = await makeArchive({
      'manifest.json': JSON.stringify(manifest),
      '../evil.txt': 'malicious content',
    });
    await expect(BackupInspector.inspectArchive(badZip)).rejects.toThrow(
      'L’archive contient des chemins de fichiers interdits (tentative d’évasion).',
    );

    const absoluteZip = await makeArchive({
      'manifest.json': JSON.stringify(manifest),
      '/etc/passwd': 'root:x:0:0',
    });
    await expect(BackupInspector.inspectArchive(absoluteZip)).rejects.toThrow(
      'L’archive contient des chemins de fichiers interdits (tentative d’évasion).',
    );
  });

  it('rejects unknown or unexpected entry names', async () => {
    const manifest = validManifest();
    const badZip = await makeArchive({
      'manifest.json': JSON.stringify(manifest),
      'data/users.ndjson': '{"name":"admin"}',
    });
    await expect(BackupInspector.inspectArchive(badZip)).rejects.toThrow(
      'L’archive contient un fichier inattendu ou non reconnu : « data/users.ndjson ».',
    );
  });

  it('rejects archive missing manifest.json', async () => {
    const zip = await makeArchive({
      'data/timetables.ndjson': '',
    });
    await expect(BackupInspector.inspectArchive(zip)).rejects.toThrow(
      'L’archive ne contient pas de fichier manifest.json.',
    );
  });

  it('rejects archive with unsupported format version or newer schema version', async () => {
    const futureFormat = validManifest({ formatVersion: 999 });
    const zip1 = await makeArchive({
      'manifest.json': JSON.stringify(futureFormat),
    });
    await expect(BackupInspector.inspectArchive(zip1)).rejects.toThrow(
      'Format d’archive non pris en charge (format v999).',
    );

    const futureSchema = validManifest({ schemaVersion: 999 });
    const zip2 = await makeArchive({
      'manifest.json': JSON.stringify(futureSchema),
    });
    await expect(BackupInspector.inspectArchive(zip2)).rejects.toThrow(
      'Cette sauvegarde a été créée avec une version plus récente de l’application (schéma v999). Mettez à jour l’application pour pouvoir la restaurer.',
    );
  });

  it('rejects archive with tampered data file (invalid SHA-256)', async () => {
    const timetableRow = JSON.stringify({
      id: randomUUID(),
      name: 'Semestre 1',
      days: ['Lundi'],
      slots: [{ start: '08:30', end: '10:00' }],
    });
    const fakeHash = '0000000000000000000000000000000000000000000000000000000000000000';
    const manifest = validManifest({
      counts: { timetables: 1, sessions: 0, settings: 0, teacher_names: 0, room_labels: 0 },
      sha256: { 'data/timetables.ndjson': fakeHash },
    });

    const zip = await makeArchive({
      'manifest.json': JSON.stringify(manifest),
      'data/timetables.ndjson': timetableRow + '\n',
    });

    await expect(BackupInspector.inspectArchive(zip)).rejects.toThrow(
      'Somme de contrôle (SHA-256) invalide pour le fichier data/timetables.ndjson. L’archive est corrompue ou a été modifiée.',
    );
  });

  it('rejects row validation errors in table data', async () => {
    // 1. Invalid UUID in timetables
    const badIdRow = JSON.stringify({
      id: 'not-a-valid-uuid',
      name: 'Test',
      days: [],
      slots: [],
    }) + '\n';
    const hash1 = createHash('sha256').update(badIdRow).digest('hex');
    const zip1 = await makeArchive({
      'manifest.json': JSON.stringify(validManifest({
        counts: { timetables: 1, sessions: 0, settings: 0, teacher_names: 0, room_labels: 0 },
        sha256: { 'data/timetables.ndjson': hash1 },
      })),
      'data/timetables.ndjson': badIdRow,
    });
    await expect(BackupInspector.inspectArchive(zip1)).rejects.toThrow(
      'Ligne 1 de « timetables » : identifiant UUID invalide.',
    );

    // 2. Sensitive key in settings
    const evilSetting = JSON.stringify({
      key: 'databaseUrl',
      value: 'postgres://root:secret@evil.com/db',
    }) + '\n';
    const hash2 = createHash('sha256').update(evilSetting).digest('hex');
    const zip2 = await makeArchive({
      'manifest.json': JSON.stringify(validManifest({
        counts: { timetables: 0, sessions: 0, settings: 1, teacher_names: 0, room_labels: 0 },
        sha256: { 'data/settings.ndjson': hash2 },
      })),
      'data/settings.ndjson': evilSetting,
    });
    await expect(BackupInspector.inspectArchive(zip2)).rejects.toThrow(
      'Ligne 1 de « settings » : clé interdite (« databaseUrl »).',
    );
  });

  it('rejects archive when a mandatory data file is missing', async () => {
    const manifest = validManifest({
      counts: { timetables: 0, sessions: 0, settings: 0, teacher_names: 0, room_labels: 0 },
      sha256: {},
    });
    // Missing data/timetables.ndjson
    const badZip = await makeArchive({
      'manifest.json': JSON.stringify(manifest),
    });
    await expect(BackupInspector.inspectArchive(badZip)).rejects.toThrow(
      'Fichier de données obligatoire manquant dans l’archive : data/timetables.ndjson.',
    );
  });

  it('rejects archive with orphan sessions referencing non-existent timetables', async () => {
    const emptyHash = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
    const orphanSession = JSON.stringify({
      id: 1,
      timetableId: randomUUID(), // not in timetables table!
      source: 'rooms',
      owner: 'A01',
      day: 0,
      slot: 0,
      groups: 'INFO1',
      teachers: 'BEN AHMED',
      room: 'A01',
    }) + '\n';
    const sHash = createHash('sha256').update(orphanSession).digest('hex');

    const manifest = validManifest({
      counts: { timetables: 0, sessions: 1, settings: 0, teacher_names: 0, room_labels: 0 },
      sha256: {
        'data/timetables.ndjson': emptyHash,
        'data/sessions.ndjson': sHash,
        'data/settings.ndjson': emptyHash,
        'data/teacher_names.ndjson': emptyHash,
        'data/room_labels.ndjson': emptyHash,
      },
    });

    const zip = await makeArchive({
      'manifest.json': JSON.stringify(manifest),
      'data/timetables.ndjson': '',
      'data/sessions.ndjson': orphanSession,
      'data/settings.ndjson': '',
      'data/teacher_names.ndjson': '',
      'data/room_labels.ndjson': '',
    });

    await expect(BackupInspector.inspectArchive(zip)).rejects.toThrow(
      /séance orpheline/,
    );
  });

  it('successfully inspects a fully valid archive', async () => {
    const tId = randomUUID();
    const timetablesData = JSON.stringify({
      id: tId,
      name: 'Emploi du temps S1',
      institution: 'ENISo',
      days: ['Lundi', 'Mardi'],
      slots: [{ raw: '08:30-10:00', base: '08:30-10:00', overrides: {}, note: '' }],
      rooms: ['A01'],
      files: [],
      createdAt: new Date().toISOString(),
    }) + '\n';

    const sessionsData = JSON.stringify({
      id: 1,
      timetableId: tId,
      source: 'rooms',
      owner: 'A01',
      day: 0,
      slot: 0,
      groups: 'INFO1',
      teachers: 'BEN AHMED',
      room: 'A01',
    }) + '\n';

    const emptyHash = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
    const tHash = createHash('sha256').update(timetablesData).digest('hex');
    const sHash = createHash('sha256').update(sessionsData).digest('hex');

    const manifest = validManifest({
      counts: { timetables: 1, sessions: 1, settings: 0, teacher_names: 0, room_labels: 0 },
      sha256: {
        'data/timetables.ndjson': tHash,
        'data/sessions.ndjson': sHash,
        'data/settings.ndjson': emptyHash,
        'data/teacher_names.ndjson': emptyHash,
        'data/room_labels.ndjson': emptyHash,
      },
    });

    const zip = await makeArchive({
      'manifest.json': JSON.stringify(manifest),
      'data/timetables.ndjson': timetablesData,
      'data/sessions.ndjson': sessionsData,
      'data/settings.ndjson': '',
      'data/teacher_names.ndjson': '',
      'data/room_labels.ndjson': '',
    });

    const inspected = await BackupInspector.inspectArchive(zip);
    expect(inspected.manifest.counts.timetables).toBe(1);
    expect(inspected.inspectResult.compatibility.compatible).toBe(true);
    expect(inspected.inspectResult.summary.timetables[0].name).toBe('Emploi du temps S1');
    expect(inspected.inspectResult.summary.timetables[0].sessionCount).toBe(1);
  });
});

