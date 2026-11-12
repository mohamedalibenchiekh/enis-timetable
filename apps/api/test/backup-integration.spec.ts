import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { BackupsService } from '../src/backups/backups.service.js';
import type { TimetablesService } from '../src/timetables/timetables.service.js';
import type { SettingsService } from '../src/settings/settings.service.js';
import type { NamesService } from '../src/names/names.service.js';
import type { MaintenanceService } from '../src/backups/maintenance.guard.js';

const apiRequire = createRequire(import.meta.url);
const { Timetable, SessionEntity } = apiRequire('../dist/entities/timetable.entity.js') as typeof import('../src/entities/timetable.entity.js');
const { BackupsService: BackupsServiceClass } = apiRequire('../dist/backups/backups.service.js');
const { TimetablesService: TimetablesServiceClass } = apiRequire('../dist/timetables/timetables.service.js');
const { SettingsService: SettingsServiceClass } = apiRequire('../dist/settings/settings.service.js');
const { NamesService: NamesServiceClass } = apiRequire('../dist/names/names.service.js');
const { MaintenanceService: MaintenanceServiceClass } = apiRequire('../dist/backups/maintenance.guard.js');
const { BackupRestorer: BackupRestorerClass } = apiRequire('../dist/backups/backup-restorer.js');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

const fixtureDir = path.join(__dirname, 'fixtures');
const fixture = (name: string) => fs.readFileSync(path.join(fixtureDir, name));

describe('Backup and Restore Integration (PostgreSQL Round-Trip & Safety)', () => {
  let embeddedDb: any = null;
  let tmpBaseDir: string;
  let backupsDir: string;
  let dataSource: DataSource;
  let app: NestExpressApplication;
  let backupsService: BackupsService;
  let timetablesService: TimetablesService;
  let settingsService: SettingsService;
  let namesService: NamesService;
  let maintenanceService: MaintenanceService;

  beforeAll(async () => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enis-integration-'));
    backupsDir = path.join(tmpBaseDir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });

    let dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      const port = await freePort();
      const { default: EmbeddedPostgres } = await import('embedded-postgres');
      embeddedDb = new EmbeddedPostgres({
        databaseDir: path.join(tmpBaseDir, 'pgdata'),
        user: 'enis',
        password: 'integration-test-password',
        port,
        persistent: false,
        initdbFlags: ['--encoding=UTF8', '--locale=C'],
        postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
      });
      await embeddedDb.initialise();
      await embeddedDb.start();
      await embeddedDb.createDatabase('enis_timetable');
      dbUrl = `postgres://enis:integration-test-password@127.0.0.1:${port}/enis_timetable`;
    }

    process.env.DATABASE_URL = dbUrl;
    process.env.BACKUPS_DIR = backupsDir;
    process.env.APP_VERSION = '1.0.6';

    const { AppModule } = apiRequire('../dist/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>(new ExpressAdapter());
    app.useBodyParser('json', { limit: '10mb' });
    app.setGlobalPrefix('api');
    await app.init();

    dataSource = moduleRef.get(DataSource);
    backupsService = moduleRef.get(BackupsServiceClass);
    timetablesService = moduleRef.get(TimetablesServiceClass);
    settingsService = moduleRef.get(SettingsServiceClass);
    namesService = moduleRef.get(NamesServiceClass);
    maintenanceService = moduleRef.get(MaintenanceServiceClass);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    if (embeddedDb) await embeddedDb.stop().catch(() => {});
    fs.rmSync(tmpBaseDir, { recursive: true, force: true });
  });

  it('performs full round-trip: import, customize, backup, wipe, restore, and verify docx parity', async () => {
    // 1. Import fixture files
    const imported = await timetablesService.importFiles([
      { originalname: 'FET_rooms_test.html', buffer: fixture('FET_rooms_test.html') },
      { originalname: 'FET_teachers_test.html', buffer: fixture('FET_teachers_test.html') },
      { originalname: 'FET_groups_test.html', buffer: fixture('FET_groups_test.html') },
    ], { name: 'Semestre 1 Test' });

    expect(imported.id).toBeDefined();

    // 2. Add teacher and room overrides
    await namesService.save('teachers', {
      items: [{ key: 'ben_ahmed', sourceName: 'BEN AHMED', displayName: 'B. Ahmed Mohamed' }],
    });
    await namesService.save('rooms', {
      items: [{ key: 'a02', sourceName: 'A02', displayName: 'A 0-2 (Lab)' }],
    });

    // 3. Customize settings
    await settingsService.setExportOptions({
      pauseLabel: 'Pause Repas',
      abbreviateBen: true,
    });

    // 4. Generate reference DOCX for Day 0
    const docxBefore = await timetablesService.dayDocx(imported.id, 0);
    expect(docxBefore.buffer.length).toBeGreaterThan(1000);

    // Snapshot tables before backup
    const timetablesBefore = await dataSource.query('SELECT * FROM timetables ORDER BY id');
    const sessionsBefore = await dataSource.query('SELECT * FROM sessions ORDER BY id');
    const teacherNamesBefore = await dataSource.query('SELECT * FROM teacher_names ORDER BY id');
    const roomLabelsBefore = await dataSource.query('SELECT * FROM room_labels ORDER BY id');
    const settingsBefore = await dataSource.query("SELECT * FROM settings WHERE key != 'backup' ORDER BY key");

    // 5. Create backup
    const { buffer: backupBuffer, manifest } = await backupsService.createBackup(true);
    expect(manifest.counts.timetables).toBe(timetablesBefore.length);
    expect(manifest.counts.sessions).toBe(sessionsBefore.length);
    expect(manifest.counts.teacher_names).toBe(teacherNamesBefore.length);
    expect(manifest.counts.room_labels).toBe(roomLabelsBefore.length);

    // 6. Wipe database tables
    await dataSource.query('DELETE FROM sessions');
    await dataSource.query('DELETE FROM timetables');
    await dataSource.query('DELETE FROM teacher_names');
    await dataSource.query('DELETE FROM room_labels');
    await dataSource.query("DELETE FROM settings WHERE key != 'backup'");

    // Verify wiped
    const [{ count: tCount }] = await dataSource.query('SELECT COUNT(*)::int as count FROM timetables');
    expect(tCount).toBe(0);

    // 7. Inspect uploaded backup
    const inspectResult = await backupsService.inspectBackup({ fileBuffer: backupBuffer });
    expect(inspectResult.compatibility.compatible).toBe(true);
    expect(inspectResult.uploadToken).toBeDefined();

    // 8. Restore backup in replace mode
    const restoreResult = await backupsService.restoreBackup({
      uploadToken: inspectResult.uploadToken,
      mode: 'replace',
    });
    expect(restoreResult.ok).toBe(true);
    expect(restoreResult.mode).toBe('replace');
    expect(fs.existsSync(restoreResult.safetyBackupPath)).toBe(true);

    // 9. Deep compare restored data
    const timetablesAfter = await dataSource.query('SELECT * FROM timetables ORDER BY id');
    const sessionsAfter = await dataSource.query('SELECT * FROM sessions ORDER BY id');
    const teacherNamesAfter = await dataSource.query('SELECT * FROM teacher_names ORDER BY id');
    const roomLabelsAfter = await dataSource.query('SELECT * FROM room_labels ORDER BY id');
    const settingsAfter = await dataSource.query("SELECT * FROM settings WHERE key != 'backup' ORDER BY key");

    expect(timetablesAfter.length).toBe(timetablesBefore.length);
    expect(timetablesAfter[0].name).toBe(timetablesBefore[0].name);
    expect(timetablesAfter[0].id).toBe(timetablesBefore[0].id);

    expect(sessionsAfter.length).toBe(sessionsBefore.length);
    expect(sessionsAfter[0].owner).toBe(sessionsBefore[0].owner);
    expect(sessionsAfter[0].timetableId).toBe(sessionsBefore[0].timetableId);

    expect(teacherNamesAfter.length).toBe(teacherNamesBefore.length);
    expect(teacherNamesAfter[0].displayName).toBe('B. Ahmed Mohamed');

    expect(roomLabelsAfter.length).toBe(roomLabelsBefore.length);
    expect(roomLabelsAfter[0].displayName).toBe('A 0-2 (Lab)');

    expect(settingsAfter).toEqual(settingsBefore);

    // 10. Verify DOCX output is identical
    const docxAfter = await timetablesService.dayDocx(imported.id, 0);
    const JSZip = (await import('jszip')).default;
    const zipBefore = await JSZip.loadAsync(docxBefore.buffer);
    const zipAfter = await JSZip.loadAsync(docxAfter.buffer);
    const xmlBefore = await zipBefore.file('word/document.xml')!.async('text');
    const xmlAfter = await zipAfter.file('word/document.xml')!.async('text');
    expect(xmlAfter).toBe(xmlBefore);

    // 11. Verify sequence usability (inserting new items does not collide)
    const newSession = await dataSource.getRepository(SessionEntity).save({
      timetableId: imported.id,
      source: 'rooms',
      owner: 'A01',
      day: 1,
      slot: 1,
      groups: 'NEW',
      teachers: 'NEW',
      subjectCode: '',
      subject: '',
      room: 'A01',
      frequency: '',
    });
    expect(newSession.id).toBeGreaterThan(sessionsBefore.length);
  });

  it('restores in merge mode: generates new UUIDs, keeps existing data and overrides intact', async () => {
    // Current database has Semestre 1 Test
    const timetablesBefore = await dataSource.getRepository(Timetable).find();
    expect(timetablesBefore.length).toBeGreaterThan(0);
    const originalTimetable = timetablesBefore[0];

    // Create a backup archive
    const { buffer: backupBuffer } = await backupsService.createBackup(true);

    // Restore in merge mode
    const inspectResult = await backupsService.inspectBackup({ fileBuffer: backupBuffer });
    const restoreResult = await backupsService.restoreBackup({
      uploadToken: inspectResult.uploadToken,
      mode: 'merge',
    });

    expect(restoreResult.ok).toBe(true);

    // After merge, there should be 2 timetables
    const timetablesAfter = await dataSource.getRepository(Timetable).find();
    expect(timetablesAfter.length).toBe(timetablesBefore.length + 1);

    // Original timetable still exists with original id
    const foundOriginal = timetablesAfter.find((t) => t.id === originalTimetable.id);
    expect(foundOriginal).toBeDefined();

    // The merged timetable has a different UUID
    const mergedTimetable = timetablesAfter.find((t) => t.id !== originalTimetable.id);
    expect(mergedTimetable).toBeDefined();
    expect(mergedTimetable!.id).not.toBe(originalTimetable.id);
    expect(mergedTimetable!.name).toBe(originalTimetable.name);

    // Sessions for merged timetable point to the new timetable id
    const mergedSessions = await dataSource.getRepository(SessionEntity).findBy({ timetableId: mergedTimetable!.id });
    expect(mergedSessions.length).toBeGreaterThan(0);
  });

  it('triggers atomic rollback when an error occurs during restore: database remains unchanged and safety backup present', async () => {
    const timetablesBefore = await dataSource.query('SELECT * FROM timetables ORDER BY id');
    const sessionsBefore = await dataSource.query('SELECT * FROM sessions ORDER BY id');

    // Create a valid backup
    const { buffer: goodBackup } = await backupsService.createBackup(true);
    const inspectResult = await backupsService.inspectBackup({ fileBuffer: goodBackup });

    // Inject failure into restorer in the middle of restore (in resetSequences after deletes and inserts)
    const spy = vi.spyOn(BackupRestorerClass.prototype, 'resetSequences').mockRejectedValueOnce(new Error('Simulated failure during restore transaction'));

    // Expect restore to fail
    await expect(
      backupsService.restoreBackup({
        uploadToken: inspectResult.uploadToken,
        mode: 'replace',
      }),
    ).rejects.toThrow('Simulated failure during restore transaction');

    spy.mockRestore();

    // Verify database is completely unchanged!
    const timetablesAfter = await dataSource.query('SELECT * FROM timetables ORDER BY id');
    const sessionsAfter = await dataSource.query('SELECT * FROM sessions ORDER BY id');
    expect(timetablesAfter.length).toBe(timetablesBefore.length);
    expect(sessionsAfter.length).toBe(sessionsBefore.length);

    // Verify safety backup was created before the failed attempt
    const summary = await backupsService.listBackups();
    expect(summary.autoBackups.some((b) => b.fileName.startsWith('pre-restore-'))).toBe(true);
  });

  it('enforces maintenance mode 503 on mutating requests during restore', async () => {
    maintenanceService.setMaintenance(true, 'Restauration en cours');

    try {
      // Mutating request POST /api/timetables receives 503
      const res = await request(app.getHttpServer())
        .post('/api/timetables')
        .send({});

      expect(res.status).toBe(503);
      expect(res.body.message).toContain('Restauration en cours');

      // Read request GET /api/backups passes through
      const getRes = await request(app.getHttpServer()).get('/api/backups');
      expect(getRes.status).toBe(200);
    } finally {
      maintenanceService.setMaintenance(false);
    }
  });

  it('supports REST API endpoints: list, download, delete, settings', async () => {
    // 1. GET /api/backups
    const listRes = await request(app.getHttpServer()).get('/api/backups');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.autoBackups)).toBe(true);
    expect(listRes.body.settings.retention).toBeGreaterThanOrEqual(3);

    // 2. POST /api/backups?download=1
    const createRes = await request(app.getHttpServer())
      .post('/api/backups?download=1')
      .expect(201);
    expect(createRes.header['content-disposition']).toContain('ENISo-sauvegarde-');
    expect(createRes.body).toBeInstanceOf(Buffer);

    // 3. POST /api/backups (creates in auto)
    const autoRes = await request(app.getHttpServer())
      .post('/api/backups')
      .expect(201);
    expect(autoRes.body.ok).toBe(true);
    expect(autoRes.body.fileName).toMatch(/^auto-.+\.enisbackup$/);

    // Re-list to get the newly created backup id
    const listRes2 = await request(app.getHttpServer()).get('/api/backups');
    const createdItem = listRes2.body.autoBackups.find((b: any) => b.fileName === autoRes.body.fileName);
    expect(createdItem).toBeDefined();

    // 4. GET /api/backups/:id/download
    const dlRes = await request(app.getHttpServer())
      .get(`/api/backups/${createdItem.id}/download`)
      .expect(200);
    expect(dlRes.header['content-disposition']).toContain(createdItem.fileName);

    // 5. DELETE /api/backups/:id
    await request(app.getHttpServer())
      .delete(`/api/backups/${createdItem.id}`)
      .expect(200);

    // 6. PUT /api/backups/settings & GET /api/backups/settings
    const putSettingsRes = await request(app.getHttpServer())
      .put('/api/backups/settings')
      .send({ enabled: true, retention: 15 })
      .expect(200);
    expect(putSettingsRes.body.retention).toBe(15);

    const getSettingsRes = await request(app.getHttpServer())
      .get('/api/backups/settings')
      .expect(200);
    expect(getSettingsRes.body.retention).toBe(15);
  });
});
