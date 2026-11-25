import { describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { BackupInspector } from '../src/backups/backup-inspector.js';
import { BACKUP_FORMAT_VERSION, BACKUP_SCHEMA_VERSION, BackupData, upgradeBackupData, validateRow, ValidationError } from '../src/backups/backup-schema.js';
import { BackupManifest } from '../src/backups/backup-types.js';

async function makeArchive(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

function validManifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  const defaults: BackupManifest = {
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
      known_rooms: 0,
      programs: 0,
      program_slots: 0,
      program_sessions: 0,
      teacher_aliases: 0,
      room_aliases: 0,
      program_revisions: 0,
    },
    sha256: {},
  };
  return {
    ...defaults,
    ...overrides,
    counts: { ...defaults.counts, ...overrides.counts },
    sha256: { ...defaults.sha256, ...overrides.sha256 },
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
      counts: { timetables: 1, sessions: 0, settings: 0, teacher_names: 0, room_labels: 0, known_rooms: 0, programs: 0, program_slots: 0, program_sessions: 0, teacher_aliases: 0, room_aliases: 0 },
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
    const emptyHash = createHash('sha256').update(Buffer.alloc(0)).digest('hex');

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
        counts: { timetables: 1, sessions: 0, settings: 0, teacher_names: 0, room_labels: 0, known_rooms: 0, programs: 0, program_slots: 0, program_sessions: 0, teacher_aliases: 0, room_aliases: 0 },
        sha256: {
          'data/timetables.ndjson': hash1,
          'data/sessions.ndjson': emptyHash,
          'data/settings.ndjson': emptyHash,
          'data/teacher_names.ndjson': emptyHash,
          'data/room_labels.ndjson': emptyHash,
          'data/known_rooms.ndjson': emptyHash,
        },
      })),
      'data/timetables.ndjson': badIdRow,
      'data/sessions.ndjson': '',
      'data/settings.ndjson': '',
      'data/teacher_names.ndjson': '',
      'data/room_labels.ndjson': '',
      'data/known_rooms.ndjson': '',
    });
    await expect(BackupInspector.inspectArchive(zip1)).rejects.toThrow(
      'Ligne 1 de « timetables » : identifiant UUID invalide.',
    );

    // 1b. Non-null invalid previousTimetableId (empty string, false, 0)
    for (const badPrevId of ['', false, 0, 'invalid-uuid']) {
      const badPrevIdRow = JSON.stringify({
        id: randomUUID(),
        name: 'Test',
        days: [],
        slots: [],
        previousTimetableId: badPrevId,
      }) + '\n';
      const hashPrev = createHash('sha256').update(badPrevIdRow).digest('hex');
      const zipPrev = await makeArchive({
        'manifest.json': JSON.stringify(validManifest({
          counts: { timetables: 1, sessions: 0, settings: 0, teacher_names: 0, room_labels: 0, known_rooms: 0, programs: 0, program_slots: 0, program_sessions: 0, teacher_aliases: 0, room_aliases: 0 },
          sha256: {
            'data/timetables.ndjson': hashPrev,
            'data/sessions.ndjson': emptyHash,
            'data/settings.ndjson': emptyHash,
            'data/teacher_names.ndjson': emptyHash,
            'data/room_labels.ndjson': emptyHash,
            'data/known_rooms.ndjson': emptyHash,
          },
        })),
        'data/timetables.ndjson': badPrevIdRow,
        'data/sessions.ndjson': '',
        'data/settings.ndjson': '',
        'data/teacher_names.ndjson': '',
        'data/room_labels.ndjson': '',
        'data/known_rooms.ndjson': '',
      });
      await expect(BackupInspector.inspectArchive(zipPrev)).rejects.toThrow(
        'Ligne 1 de « timetables » : previousTimetableId UUID invalide.',
      );
    }

    // 2. Sensitive key in settings
    const evilSetting = JSON.stringify({
      key: 'databaseUrl',
      value: 'postgres://root:secret@evil.com/db',
    }) + '\n';
    const hash2 = createHash('sha256').update(evilSetting).digest('hex');
    const zip2 = await makeArchive({
      'manifest.json': JSON.stringify(validManifest({
        counts: { timetables: 0, sessions: 0, settings: 1, teacher_names: 0, room_labels: 0, known_rooms: 0, programs: 0, program_slots: 0, program_sessions: 0, teacher_aliases: 0, room_aliases: 0 },
        sha256: {
          'data/timetables.ndjson': emptyHash,
          'data/sessions.ndjson': emptyHash,
          'data/settings.ndjson': hash2,
          'data/teacher_names.ndjson': emptyHash,
          'data/room_labels.ndjson': emptyHash,
          'data/known_rooms.ndjson': emptyHash,
        },
      })),
      'data/timetables.ndjson': '',
      'data/sessions.ndjson': '',
      'data/settings.ndjson': evilSetting,
      'data/teacher_names.ndjson': '',
      'data/room_labels.ndjson': '',
      'data/known_rooms.ndjson': '',
    });
    await expect(BackupInspector.inspectArchive(zip2)).rejects.toThrow(
      'Ligne 1 de « settings » : clé interdite (« databaseUrl »).',
    );
  });

  it('rejects archive when a mandatory data file is missing', async () => {
    const manifest = validManifest({
      counts: { timetables: 0, sessions: 0, settings: 0, teacher_names: 0, room_labels: 0, known_rooms: 0, programs: 0, program_slots: 0, program_sessions: 0, teacher_aliases: 0, room_aliases: 0 },
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

  it('rejects missing program table manifest entries and archive files', async () => {
    const emptyHash = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
    const tables = ['timetables', 'sessions', 'settings', 'teacher_names', 'room_labels', 'known_rooms', 'programs', 'program_slots', 'program_sessions', 'teacher_aliases', 'room_aliases', 'program_revisions'] as const;
    const emptyFiles = Object.fromEntries(tables.map((table) => [`data/${table}.ndjson`, '']));
    const hashes = Object.fromEntries(tables.map((table) => [`data/${table}.ndjson`, emptyHash]));

    const missingCount = validManifest();
    delete (missingCount.counts as Partial<BackupManifest['counts']>).programs;
    await expect(BackupInspector.inspectArchive(await makeArchive({
      'manifest.json': JSON.stringify(missingCount),
    }))).rejects.toThrow('Compte invalide dans le manifeste pour la table « programs ».');

    const zeroCounts: BackupManifest['counts'] = {
      timetables: 0, sessions: 0, settings: 0, teacher_names: 0, room_labels: 0, known_rooms: 0,
      programs: 0, program_slots: 0, program_sessions: 0, teacher_aliases: 0, room_aliases: 0, program_revisions: 0,
    };
    const missingHash = validManifest({ counts: zeroCounts, sha256: Object.fromEntries(Object.entries(hashes).filter(([path]) => path !== 'data/programs.ndjson')) });
    await expect(BackupInspector.inspectArchive(await makeArchive({
      ...emptyFiles,
      'manifest.json': JSON.stringify(missingHash),
    }))).rejects.toThrow('Somme de contrôle manquante dans le manifeste pour data/programs.ndjson.');

    const missingFileManifest = validManifest({ counts: zeroCounts, sha256: hashes });
    const { 'data/programs.ndjson': _missingProgramFile, ...filesWithoutPrograms } = emptyFiles;
    await expect(BackupInspector.inspectArchive(await makeArchive({
      ...filesWithoutPrograms,
      'manifest.json': JSON.stringify(missingFileManifest),
    }))).rejects.toThrow('Fichier de données obligatoire manquant dans l’archive : data/programs.ndjson.');
  });

  it('validates and whitelists program backup rows and cell spans', () => {
    const now = new Date().toISOString();
    const program = {
      id: randomUUID(), code: 'M1', title: 'Master', kind: '', academicYear: '2026-2027', semester: '',
      coordinator: '', formRef: '', effectiveFrom: '', footerText: '', version: 'v1.10', revision: 1,
      isCurrent: true, originalSnapshot: {}, createdAt: now, updatedAt: now, injected: 'ignored',
    };
    const validated = validateRow('programs', program, 0);
    expect(validated).not.toHaveProperty('injected');
    expect(validated.version).toBe('v1.10');
    expect(() => validateRow('programs', { ...program, createdAt: 'not a date' }, 0)).toThrow(ValidationError);
    expect(() => validateRow('programs', { ...program, title: 'x'.repeat(256) }, 0)).toThrow(ValidationError);
    expect(() => validateRow('program_slots', { id: 1, programId: program.id, index: 0, label: '08:30', rawLabel: '08:30', dayOverrides: {} }, 0)).toThrow(ValidationError);

    const validSession = { id: randomUUID(), programId: program.id, day: 4, slot: 4, slotSpan: 2, daySpan: 2 };
    expect(() => validateRow('program_sessions', validSession, 0)).not.toThrow();
    expect(() => validateRow('program_sessions', { ...validSession, slotSpan: 3 }, 0)).toThrow(ValidationError);
    expect(() => validateRow('program_sessions', { ...validSession, slot: 0, day: 0, slotSpan: 0 }, 0)).toThrow(ValidationError);
    expect(() => validateRow('program_sessions', { ...validSession, slot: 0, day: 0, daySpan: 0 }, 0)).toThrow(ValidationError);

    // Validate program_revisions rows
    const validRev = {
      id: 1,
      programId: program.id,
      revision: 1,
      snapshot: { sessions: [] },
      description: 'Initial',
      createdAt: new Date().toISOString(),
    };
    expect(() => validateRow('program_revisions', validRev, 0)).not.toThrow();
    expect(() => validateRow('program_revisions', { ...validRev, programId: 'bad-uuid' }, 0)).toThrow(ValidationError);
    expect(() => validateRow('program_revisions', { ...validRev, revision: 0 }, 0)).toThrow(ValidationError);
    expect(() => validateRow('program_revisions', { ...validRev, snapshot: 'not-an-object' }, 0)).toThrow(ValidationError);
    expect(() => validateRow('program_revisions', { ...validRev, createdAt: 'invalid-date' }, 0)).toThrow(ValidationError);

    const legacyData = {
      timetables: [], sessions: [], settings: [], teacher_names: [], room_labels: [], known_rooms: [],
      programs: [{ ...program, version: 12 }], program_slots: [], program_sessions: [], teacher_aliases: [], room_aliases: [],
    } as unknown as BackupData;
    const upgraded = upgradeBackupData(legacyData, 4);
    expect(upgraded.programs[0].version).toBe('12');
    expect(upgraded.program_revisions).toEqual([]);
  });

  it('rejects program slots and sessions with missing programs', async () => {
    const programId = randomUUID();
    const orphanProgramId = randomUUID();
    const programRow = JSON.stringify({
      id: programId, code: 'M1', title: 'Master', kind: '', academicYear: '2026-2027', semester: '',
      coordinator: '', formRef: '', effectiveFrom: '', footerText: '', version: '1', revision: 1,
      isCurrent: true, originalSnapshot: {},
    }) + '\n';
    const empty = '';
    const tables = ['timetables', 'sessions', 'settings', 'teacher_names', 'room_labels', 'known_rooms', 'programs', 'program_slots', 'program_sessions', 'teacher_aliases', 'room_aliases', 'program_revisions'] as const;
    const emptyHash = createHash('sha256').update(Buffer.alloc(0)).digest('hex');

    for (const [table, row] of [
      ['program_slots', JSON.stringify({ id: 1, programId: orphanProgramId, index: 0, label: '08:30', rawLabel: '08:30', base: '08:30', dayOverrides: {}, note: '' }) + '\n'],
      ['program_sessions', JSON.stringify({ id: randomUUID(), programId: orphanProgramId, day: 0, slot: 0 }) + '\n'],
      ['program_revisions', JSON.stringify({ id: 1, programId: orphanProgramId, revision: 1, snapshot: {}, createdAt: new Date().toISOString() }) + '\n'],
    ] as const) {
      const content = Object.fromEntries(tables.map((name) => [`data/${name}.ndjson`, name === 'programs' ? programRow : name === table ? row : empty]));
      const counts: BackupManifest['counts'] = {
        timetables: 0, sessions: 0, settings: 0, teacher_names: 0, room_labels: 0, known_rooms: 0,
        programs: 1, program_slots: 0, program_sessions: 0, teacher_aliases: 0, room_aliases: 0, program_revisions: 0,
        [table]: 1,
      };
      const hashes = Object.fromEntries(Object.entries(content).map(([path, value]) => [path, createHash('sha256').update(value).digest('hex') || emptyHash]));
      const manifest = validManifest({ counts, sha256: hashes });
      const archive = await makeArchive({ ...content, 'manifest.json': JSON.stringify(manifest) });
      await expect(BackupInspector.inspectArchive(archive)).rejects.toThrow(`L’archive contient une ligne orpheline dans « ${table} »`);
    }
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
      counts: { timetables: 0, sessions: 1, settings: 0, teacher_names: 0, room_labels: 0, known_rooms: 0, programs: 0, program_slots: 0, program_sessions: 0, teacher_aliases: 0, room_aliases: 0, program_revisions: 0 },
      sha256: {
        'data/timetables.ndjson': emptyHash,
        'data/sessions.ndjson': sHash,
        'data/settings.ndjson': emptyHash,
        'data/teacher_names.ndjson': emptyHash,
        'data/room_labels.ndjson': emptyHash,
        'data/known_rooms.ndjson': emptyHash,
        'data/programs.ndjson': emptyHash,
        'data/program_slots.ndjson': emptyHash,
        'data/program_sessions.ndjson': emptyHash,
        'data/teacher_aliases.ndjson': emptyHash,
        'data/room_aliases.ndjson': emptyHash,
        'data/program_revisions.ndjson': emptyHash,
      },
    });

    const zip = await makeArchive({
      'manifest.json': JSON.stringify(manifest),
      'data/timetables.ndjson': '',
      'data/sessions.ndjson': orphanSession,
      'data/settings.ndjson': '',
      'data/teacher_names.ndjson': '',
      'data/room_labels.ndjson': '',
      'data/known_rooms.ndjson': '',
      'data/programs.ndjson': '',
      'data/program_slots.ndjson': '',
      'data/program_sessions.ndjson': '',
      'data/teacher_aliases.ndjson': '',
      'data/room_aliases.ndjson': '',
      'data/program_revisions.ndjson': '',
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
      counts: { timetables: 1, sessions: 1, settings: 0, teacher_names: 0, room_labels: 0, known_rooms: 0, programs: 0, program_slots: 0, program_sessions: 0, teacher_aliases: 0, room_aliases: 0, program_revisions: 0 },
      sha256: {
        'data/timetables.ndjson': tHash,
        'data/sessions.ndjson': sHash,
        'data/settings.ndjson': emptyHash,
        'data/teacher_names.ndjson': emptyHash,
        'data/room_labels.ndjson': emptyHash,
        'data/known_rooms.ndjson': emptyHash,
        'data/programs.ndjson': emptyHash,
        'data/program_slots.ndjson': emptyHash,
        'data/program_sessions.ndjson': emptyHash,
        'data/teacher_aliases.ndjson': emptyHash,
        'data/room_aliases.ndjson': emptyHash,
        'data/program_revisions.ndjson': emptyHash,
      },
    });

    const zip = await makeArchive({
      'manifest.json': JSON.stringify(manifest),
      'data/timetables.ndjson': timetablesData,
      'data/sessions.ndjson': sessionsData,
      'data/settings.ndjson': '',
      'data/teacher_names.ndjson': '',
      'data/room_labels.ndjson': '',
      'data/known_rooms.ndjson': '',
      'data/programs.ndjson': '',
      'data/program_slots.ndjson': '',
      'data/program_sessions.ndjson': '',
      'data/teacher_aliases.ndjson': '',
      'data/room_aliases.ndjson': '',
      'data/program_revisions.ndjson': '',
    });

    const inspected = await BackupInspector.inspectArchive(zip);
    expect(inspected.manifest.counts.timetables).toBe(1);
    expect(inspected.inspectResult.compatibility.compatible).toBe(true);
    expect(inspected.inspectResult.summary.timetables[0].name).toBe('Emploi du temps S1');
    expect(inspected.inspectResult.summary.timetables[0].sessionCount).toBe(1);
  });
});

