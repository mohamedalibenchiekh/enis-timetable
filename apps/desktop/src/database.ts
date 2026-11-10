import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// embedded-postgres is an ES module; keep a real dynamic import() in the CommonJS output.
const importEsm = new Function('s', 'return import(s)') as (s: string) => Promise<any>;

export interface EmbeddedDb {
  url: string;
  stop(): Promise<void>;
}

export const POSTGRES_MAJOR_VERSION = '17';

export class DatabaseVersionMismatchError extends Error {
  constructor(actualVersion: string, expectedVersion = POSTGRES_MAJOR_VERSION) {
    super(
      `La base de données utilise PostgreSQL ${actualVersion}, mais cette version de l’application nécessite PostgreSQL ${expectedVersion}. ` +
      'Les données n’ont pas été modifiées. Restaurez une sauvegarde compatible ou contactez le support.',
    );
    this.name = 'DatabaseVersionMismatchError';
  }
}

export class DatabaseVersionFileCorruptError extends Error {
  constructor() {
    super('Le fichier de version PostgreSQL est vide ou corrompu. Les données n’ont pas été modifiées.');
    this.name = 'DatabaseVersionFileCorruptError';
  }
}

export function assertEmbeddedDatabaseVersion(databaseDir: string): void {
  const versionPath = path.join(databaseDir, 'pgdata', 'PG_VERSION');
  if (!fs.existsSync(versionPath)) return;
  const actualVersion = fs.readFileSync(versionPath, 'utf8').trim();
  if (!actualVersion) throw new DatabaseVersionFileCorruptError();
  if (actualVersion !== POSTGRES_MAJOR_VERSION) {
    throw new DatabaseVersionMismatchError(actualVersion);
  }
}

/**
 * Starts a private PostgreSQL server bundled with the app (no installation needed).
 * Data lives in <dir>/pgdata and survives updates; the server listens on 127.0.0.1 only, on a free port.
 */
export async function startEmbeddedPostgres(dir: string, port: number, log: (s: string) => void): Promise<EmbeddedDb> {
  assertEmbeddedDatabaseVersion(dir);
  const { default: EmbeddedPostgres } = await importEsm('embedded-postgres');
  fs.mkdirSync(dir, { recursive: true });

  const metaFile = path.join(dir, 'pg.json');
  let meta: { password: string } | null = null;
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { /* first run */ }
  if (!meta?.password) {
    meta = { password: randomBytes(18).toString('hex') };
    fs.writeFileSync(metaFile, JSON.stringify(meta));
  }

  const dataDir = path.join(dir, 'pgdata');
  const initialised = fs.existsSync(path.join(dataDir, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'enis',
    password: meta.password,
    port,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: (m: unknown) => log(String(m)),
    onError: (m: unknown) => log(String(m)),
  });

  if (!initialised) {
    fs.rmSync(dataDir, { recursive: true, force: true }); // drop a half-initialised folder
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase('enis_timetable');
  } catch (e) {
    if (!/already exists/i.test(String((e as Error)?.message ?? e))) throw e;
  }

  return {
    url: `postgres://enis:${meta.password}@127.0.0.1:${port}/enis_timetable`,
    stop: () => pg.stop(),
  };
}
