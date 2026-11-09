import 'reflect-metadata';
import 'ts-node/register';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip = require('jszip');
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ExpressAdapter } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';

const schema = 'enis_api_integration_tests';
const baseUrl = process.env.DATABASE_URL ?? 'postgres://enis:enis@127.0.0.1:5432/enis_timetable';
const fixtureDir = path.join(__dirname, 'fixtures');
const fixture = (name: string) => fs.readFileSync(path.join(fixtureDir, name));
const requireApiSource = createRequire(path.join(__dirname, 'integration-loader.cjs'));

it.fails('Nest core resolves the HTTP adapter from the monorepo API workspace', () => {
  // @nestjs/core is hoisted to the root while platform-express stays under apps/api/node_modules.
  const requireFromNestCore = createRequire(requireApiSource.resolve('@nestjs/core'));
  expect(requireFromNestCore.resolve('@nestjs/platform-express')).toBeTruthy();
});

async function probeDatabase(): Promise<boolean> {
  const connection = new DataSource({ type: 'postgres', url: baseUrl, connectTimeoutMS: 1500 });
  try { await connection.initialize(); await connection.destroy(); return true; }
  catch { if (connection.isInitialized) await connection.destroy(); return false; }
}

let databaseAvailable = false;
let app: INestApplication | undefined;
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
    const { AppModule } = requireApiSource('../src/app.module.ts') as typeof import('../src/app.module');
    const testing = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = testing.createNestApplication(new ExpressAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    dataSource = app.get(DataSource);
  }, 30_000);

  beforeEach(async () => {
    if (!databaseAvailable) return;
    await dataSource?.query('TRUNCATE TABLE sessions, timetables, settings RESTART IDENTITY CASCADE');
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
});
