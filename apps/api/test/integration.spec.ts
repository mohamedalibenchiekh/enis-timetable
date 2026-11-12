import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';

const schema = `enis_api_integration_tests_${process.pid}_${randomUUID().replace(/-/g, '')}`;
const baseUrl = process.env.DATABASE_URL ?? 'postgres://enis:enis@127.0.0.1:5432/enis_timetable';
const fixtureDir = path.join(__dirname, 'fixtures');
const fixture = (name: string) => fs.readFileSync(path.join(fixtureDir, name));
const apiRequire = createRequire(path.join(__dirname, 'integration-loader.cjs'));

it('Nest core resolves the HTTP adapter from the monorepo API workspace', () => {
  // @nestjs/core must be able to resolve platform-express in the monorepo layout.
  const requireFromNestCore = createRequire(apiRequire.resolve('@nestjs/core'));
  expect(requireFromNestCore.resolve('@nestjs/platform-express')).toBeTruthy();
});

async function probeDatabase(): Promise<boolean> {
  const connection = new DataSource({ type: 'postgres', url: baseUrl, connectTimeoutMS: 1500 });
  try { await connection.initialize(); await connection.destroy(); return true; }
  catch { if (connection.isInitialized) await connection.destroy(); return false; }
}

let databaseAvailable = false;
let app: NestExpressApplication | undefined;
let dataSource: DataSource | undefined;
let timetableId = '';

function databaseTest(name: string, fn: () => Promise<void>) {
  it(name, async ({ skip }) => {
    if (!databaseAvailable) skip();
    await fn();
  });
}

describe('API integration (PostgreSQL)', () => {
  beforeAll(async () => {
    databaseAvailable = await probeDatabase();
    if (!databaseAvailable) {
      console.info(`Skipping API integration suite: PostgreSQL is unreachable at ${baseUrl}. Set DATABASE_URL to enable it.`);
      return;
    }
    const admin = new DataSource({ type: 'postgres', url: baseUrl });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await admin.destroy();

    const url = new URL(baseUrl);
    url.searchParams.set('options', `-csearch_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    const { AppModule } = apiRequire('../dist/app.module.js') as typeof import('../src/app.module.js');
    const testing = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = testing.createNestApplication<NestExpressApplication>(new ExpressAdapter());
    app.useBodyParser('json', { limit: '2mb' });
    app.setGlobalPrefix('api');
    await app.init();
    dataSource = app.get(DataSource);
  }, 30_000);

  beforeEach(async () => {
    if (!databaseAvailable) return;
    await dataSource?.query('TRUNCATE TABLE sessions, timetables, settings, teacher_names, room_labels RESTART IDENTITY CASCADE');
    timetableId = '';
  });

  afterAll(async () => {
    if (!databaseAvailable) return;
    await app?.close();
    const admin = new DataSource({ type: 'postgres', url: baseUrl });
    try { await admin.initialize(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { if (admin.isInitialized) await admin.destroy(); }
  });

  const files = (): [string, Buffer][] => [
    ['FET_rooms_test.html', fixture('FET_rooms_test.html')],
    ['FET_teachers_test.html', fixture('FET_teachers_test.html')],
    ['FET_groups_test.html', fixture('FET_groups_test.html')],
  ] as const;
  function upload(items: readonly (readonly [string, Buffer])[] = files(), fields: Record<string, string> = {}) {
    let call = request(app!.getHttpServer()).post('/api/timetables');
    for (const [filename, content] of items) call = call.attach('files', content, filename);
    for (const [key, value] of Object.entries(fields)) call = call.field(key, value);
    return call;
  }
  async function createTimetable() {
    const response = await upload().expect(201);
    timetableId = response.body.id;
    return response.body;
  }

  databaseTest('imports three files and supports list, get, preview, delete with session cascade', async () => {
    const timetable = await createTimetable();
    expect(timetable.files).toHaveLength(3);
    expect((await request(app!.getHttpServer()).get('/api/timetables').expect(200)).body.map((x: { id: string }) => x.id)).toContain(timetable.id);
    await request(app!.getHttpServer()).get(`/api/timetables/${timetable.id}`).expect(200);
    const preview = await request(app!.getHttpServer()).get(`/api/timetables/${timetable.id}/days/0/preview`).expect(200);
    expect(preview.body.blocs.flatMap((b: { rows: { cells: string[] }[] }) => b.rows.flatMap((r) => r.cells)).join('|')).toContain('Prof Dupont 1/15');
    const before = await dataSource!.getRepository('sessions').count();
    expect(before).toBeGreaterThan(0);
    await request(app!.getHttpServer()).delete(`/api/timetables/${timetable.id}`).expect(200);
    expect(await dataSource!.getRepository('sessions').count()).toBe(0);
  });

  for (const [label, items] of [
    ['rooms only', [['FET_rooms_test.html', fixture('FET_rooms_test.html')]]],
    ['unknown kind', [['unknown.html', Buffer.from('<html/>')]]],
    ['duplicate kinds', [['a_rooms.html', fixture('FET_rooms_test.html')], ['b_rooms.html', fixture('FET_rooms_test.html')]]],
  ] as const) {
    databaseTest(`validates upload case: ${label}`, async () => {
    if (label === 'rooms only') await upload(items).expect(201);
    else await upload(items).expect(400);
    });
  }

  databaseTest('adds or replaces a view for an existing timetable ID', async () => {
    const timetable = await createTimetable();
    const response = await upload([['replacement_rooms.html', fixture('FET_rooms_test.html')]], { timetableId: timetable.id }).expect(201);
    expect(response.body.id).toBe(timetable.id);
    expect(response.body.files.filter((f: { kind: string }) => f.kind === 'rooms')).toHaveLength(1);
  });

  databaseTest('serves DOCX headers, valid Word ZIP content, and six-document export ZIP', async () => {
    const timetable = await createTimetable();
    const docx = await request(app!.getHttpServer()).get(`/api/timetables/${timetable.id}/days/0/docx`).buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(docx.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(docx.headers['content-disposition']).toContain("filename*=UTF-8''Lundi.docx");
    const docZip = await JSZip.loadAsync(docx.body);
    expect(await docZip.file('word/document.xml')?.async('string')).toContain('Prof Dupont');
    const exportZip = await request(app!.getHttpServer()).get(`/api/timetables/${timetable.id}/export.zip`).buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(Object.keys((await JSZip.loadAsync(exportZip.body)).files)).toHaveLength(6);
  });

  databaseTest('validates export paths and writes all six documents to an absolute temporary directory', async () => {
    const timetable = await createTimetable();
    await request(app!.getHttpServer()).post(`/api/timetables/${timetable.id}/export-to-folder`).send({ dir: 'relative-folder' }).expect(400);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'enis-export-test-'));
    try {
      const response = await request(app!.getHttpServer()).post(`/api/timetables/${timetable.id}/export-to-folder`).send({ dir: directory }).expect(201);
      expect(response.body.files).toHaveLength(6);
      expect(fs.readdirSync(directory).sort()).toEqual(['Jeudi.docx', 'Lundi.docx', 'Mardi.docx', 'Mercredi.docx', 'Samedi.docx', 'Vendredi.docx']);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  databaseTest('gets and updates export settings, rejects invalid regex, and applies options to preview', async () => {
    const timetable = await createTimetable();
    const current = await request(app!.getHttpServer()).get('/api/settings/export').expect(200);
    expect(current.body.abbreviateBen).toBe(true);
    await request(app!.getHttpServer()).put('/api/settings/export').send({ blocs: [{ title: 'broken', patterns: ['['] }] }).expect(400);
    await request(app!.getHttpServer()).put('/api/settings/export').send({ abbreviateBen: false, showFrequency: false }).expect(200);
    const preview = await request(app!.getHttpServer()).get(`/api/timetables/${timetable.id}/days/0/preview`).expect(200);
    expect(JSON.stringify(preview.body)).toContain('Prof Dupont');
    expect(JSON.stringify(preview.body)).not.toContain('1/15');
  });

  databaseTest('lists teacher and room names with counts, blocs, and unused overrides', async () => {
    const timetable = await createTimetable();
    await request(app!.getHttpServer()).put('/api/names/teachers').send({
      items: [{ sourceName: 'Ancien Prof', displayName: 'Professeur ancien' }],
    }).expect(200);
    const teachers = await request(app!.getHttpServer())
      .get(`/api/names/teachers?timetableId=${timetable.id}`).expect(200);
    expect(teachers.body.items.find((item: { sourceName: string }) => item.sourceName === 'Prof Dupont').sessions).toBe(1);
    expect(teachers.body.unused.map((item: { sourceName: string }) => item.sourceName)).toContain('Ancien Prof');
    const rooms = await request(app!.getHttpServer())
      .get(`/api/names/rooms?timetableId=${timetable.id}`).expect(200);
    expect(rooms.body.items.find((item: { sourceName: string }) => item.sourceName === 'A01').bloc).toBe('BLOC « A »');
  });

  databaseTest('keeps selected source session counts at zero when lower-priority views contain sessions', async () => {
    const timetable = await createTimetable();
    await dataSource!.getRepository('sessions').delete({ timetableId: timetable.id, source: 'rooms' });
    const teachers = await request(app!.getHttpServer())
      .get(`/api/names/teachers?timetableId=${timetable.id}`).expect(200);
    expect(teachers.body.items.find((item: { sourceName: string }) => item.sourceName === 'Prof Dupont').sessions).toBe(0);
    const rooms = await request(app!.getHttpServer())
      .get(`/api/names/rooms?timetableId=${timetable.id}`).expect(200);
    expect(rooms.body.items.find((item: { sourceName: string }) => item.sourceName === 'A01').sessions).toBe(0);
  });

  databaseTest('stores normalized Hangul keys longer than the source name column length', async () => {
    const sourceName = '가'.repeat(255);
    await request(app!.getHttpServer()).put('/api/names/teachers').send({
      items: [{ sourceName, displayName: 'Professeur' }],
    }).expect(200);
    const exported = await request(app!.getHttpServer()).get('/api/names/export').expect(200);
    expect(exported.body.teachers[0].key.length).toBeGreaterThan(255);
  });

  databaseTest('rejects a bulk name update atomically when one row is invalid', async () => {
    await createTimetable();
    const invalid = await request(app!.getHttpServer()).put('/api/names/teachers').send({
      items: [
        { sourceName: 'Prof Dupont', displayName: 'Dupont Jean' },
        { sourceName: 'Prof Benali', displayName: 'x'.repeat(61) },
      ],
    }).expect(400);
    expect(invalid.body.message).toContain('Ligne 2');
    const exported = await request(app!.getHttpServer()).get('/api/names/export').expect(200);
    expect(exported.body.teachers).toHaveLength(0);
  });

  databaseTest('applies teacher overrides to DOCX and restores automatic formatting after delete', async () => {
    const timetable = await createTimetable();
    await request(app!.getHttpServer()).put('/api/names/teachers').send({
      items: [{ sourceName: 'Prof Dupont', displayName: 'Hanafi Latifa' }],
    }).expect(200);
    const download = () => request(app!.getHttpServer())
      .get(`/api/timetables/${timetable.id}/days/0/docx`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const changed = await JSZip.loadAsync((await download()).body);
    const changedXml = await changed.file('word/document.xml')?.async('string');
    expect(changedXml).toContain('Hanafi Latifa');
    expect(changedXml).not.toContain('Prof Dupont');

    await request(app!.getHttpServer()).put('/api/names/teachers').send({
      items: [{ sourceName: 'Prof Dupont', displayName: '' }],
    }).expect(200);
    const emptyReset = await JSZip.loadAsync((await download()).body);
    const emptyResetXml = await emptyReset.file('word/document.xml')?.async('string');
    expect(emptyResetXml).toContain('Prof Dupont');
    expect(emptyResetXml).not.toContain('Hanafi Latifa');

    await request(app!.getHttpServer()).put('/api/names/teachers').send({
      items: [{ sourceName: 'Prof Dupont', displayName: 'Hanafi Latifa' }],
    }).expect(200);
    await request(app!.getHttpServer()).delete('/api/names/teachers/prof%20dupont').expect(200);
    const restored = await JSZip.loadAsync((await download()).body);
    const restoredXml = await restored.file('word/document.xml')?.async('string');
    expect(restoredXml).toContain('Prof Dupont');
    expect(restoredXml).not.toContain('Hanafi Latifa');
  });

  databaseTest('exports and imports name overrides and rejects malformed import files', async () => {
    await request(app!.getHttpServer()).put('/api/names/teachers').send({
      items: [{ sourceName: 'Prof Dupont', displayName: 'Jean Dupont' }],
    }).expect(200);
    await request(app!.getHttpServer()).put('/api/names/rooms').send({
      items: [{ sourceName: 'A01', displayName: 'Salle 01' }],
    }).expect(200);
    const exported = await request(app!.getHttpServer()).get('/api/names/export').expect(200);
    await request(app!.getHttpServer()).delete('/api/names/teachers/prof%20dupont').expect(200);
    await request(app!.getHttpServer()).delete('/api/names/rooms/a01').expect(200);
    const imported = await request(app!.getHttpServer()).post('/api/names/import').send(exported.body).expect(201);
    expect(imported.body).toMatchObject({ added: 2, updated: 0, ignored: 0 });
    const restored = await request(app!.getHttpServer()).get('/api/names/export').expect(200);
    expect(restored.body.teachers.find((item: { key: string }) => item.key === 'prof dupont').displayName).toBe('Jean Dupont');
    expect(restored.body.rooms.find((item: { key: string }) => item.key === 'a01').displayName).toBe('Salle 01');
    await request(app!.getHttpServer()).post('/api/names/import').send({ version: 2, teachers: [], rooms: [] }).expect(400);
  });

  databaseTest('returns the French import-size error for JSON bodies over one megabyte', async () => {
    const response = await request(app!.getHttpServer()).post('/api/names/import').send({
      version: 1,
      teachers: [{ sourceName: 'x'.repeat(1_100_000), displayName: 'Nom' }],
      rooms: [],
    }).expect(400);
    expect(response.body.message).toBe('Le fichier de noms dépasse 1 Mo');
  });

  const v2Dir = path.join(fixtureDir, 'v2');
  const v2Files = (): [string, Buffer][] => [
    ['FET_rooms_v2.html', fs.readFileSync(path.join(v2Dir, 'FET_rooms_v2.html'))],
    ['FET_teachers_v2.html', fs.readFileSync(path.join(v2Dir, 'FET_teachers_v2.html'))],
    ['FET_groups_v2.html', fs.readFileSync(path.join(v2Dir, 'FET_groups_v2.html'))],
  ] as const;

  async function createV1AndV2() {
    const v1 = await createTimetable();
    const v2 = await upload(v2Files(), { previousTimetableId: v1.id }).expect(201);
    return { v1: v1.id as string, v2: v2.body.id as string, v2Body: v2.body };
  }

  databaseTest('imports a new version linked to the previous one and returns a comparison summary', async () => {
    const { v1, v2, v2Body } = await createV1AndV2();
    expect(v2Body.previousTimetableId).toBe(v1);
    expect(v2Body.comparison).toMatchObject({ total: expect.any(Number), byType: expect.any(Object) });
    expect(v2Body.comparison.total).toBeGreaterThan(0);
  });

  databaseTest('rejects previousTimetableId combined with timetableId and unknown previous ids', async () => {
    const timetable = await createTimetable();
    await upload(v2Files(), { timetableId: timetable.id, previousTimetableId: timetable.id }).expect(400);
    await upload(v2Files(), { previousTimetableId: randomUUID() }).expect(404);
    await upload(v2Files(), { previousTimetableId: 'not-a-uuid' }).expect(400);
  });

  databaseTest('compares two timetables with summary, changes and day impact', async () => {
    const { v1, v2 } = await createV1AndV2();
    const res = await request(app!.getHttpServer()).get(`/api/timetables/${v1}/compare/${v2}`).expect(200);
    expect(res.body.base.id).toBe(v1);
    expect(res.body.target.id).toBe(v2);
    expect(res.body.source).toBe('teachers');
    expect(res.body.summary.byType.moved).toBe(2);
    expect(res.body.summary.byType.room_changed).toBe(1);
    expect(res.body.summary.byType.added).toBe(1);
    expect(res.body.summary.byType.removed).toBe(1);
    expect(res.body.changes.length).toBe(res.body.summary.total);
    expect(res.body.days.length).toBeGreaterThan(0);
    expect(res.body.days.every((d: { dayName: string; cells: unknown[] }) => d.dayName && Array.isArray(d.cells))).toBe(true);
  });

  databaseTest('honours the source query parameter and rejects invalid ones', async () => {
    const { v1, v2 } = await createV1AndV2();
    const rooms = await request(app!.getHttpServer()).get(`/api/timetables/${v1}/compare/${v2}?source=rooms`).expect(200);
    expect(rooms.body.source).toBe('rooms');
    expect(rooms.body.summary.byType.group_changed).toBe(1);
    await request(app!.getHttpServer()).get(`/api/timetables/${v1}/compare/${v2}?source=bogus`).expect(400);
  });

  databaseTest('rejects comparing a timetable with itself and unknown ids', async () => {
    const { v1 } = await createV1AndV2();
    await request(app!.getHttpServer()).get(`/api/timetables/${v1}/compare/${v1}`).expect(400);
    await request(app!.getHttpServer()).get(`/api/timetables/${v1}/compare/${randomUUID()}`).expect(404);
  });

  databaseTest('serves a valid compare DOCX fiche and a BOM CSV', async () => {
    const { v1, v2 } = await createV1AndV2();
    const docx = await request(app!.getHttpServer())
      .get(`/api/timetables/${v1}/compare/${v2}/export.docx`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(docx.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(docx.headers['content-disposition']).toContain('Fiche-des-changements');
    const zip = await JSZip.loadAsync(docx.body);
    const xml = await zip.file('word/document.xml')?.async('string');
    expect(xml).toContain('Fiche des changements');
    expect(xml).toContain('Jours à rééditer');

    const csv = await request(app!.getHttpServer()).get(`/api/timetables/${v1}/compare/${v2}/export.csv`).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const text = csv.text ?? String(csv.body);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.split('\n')[0]).toContain(';');
    expect(text).toContain('Déplacée');
  });
});
