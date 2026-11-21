import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { inspectAndCleanPostmasterPid, ProcessInspector, SystemProcessInspector } from './pid-manager';

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
 * Ensures the target database exists in an idempotent manner.
 * Queries pg_database first, and catches SQLSTATE 42P04 (duplicate_database) gracefully.
 */
export async function ensureDatabaseExists(pg: any, dbName: string, log: (s: string) => void): Promise<void> {
  let client: any = null;
  try {
    client = pg.getPgClient('postgres');
    await client.connect();
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (res.rows && res.rows.length > 0) {
      log(`Base de données « ${dbName} » déjà existante.`);
      return;
    }
  } catch (err) {
    log(`Avertissement lors de la vérification de pg_database: ${String(err)}`);
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
  }

  try {
    await pg.createDatabase(dbName);
    log(`Base de données « ${dbName} » créée.`);
  } catch (err: any) {
    const code = err?.code;
    const msg = String(err?.message ?? err);
    if (code === '42P04' || /already exists/i.test(msg)) {
      log(`Base de données « ${dbName} » déjà existante (tolérée par code SQLSTATE 42P04).`);
      return;
    }
    throw err;
  }
}

/**
 * Stops PostgreSQL cleanly using pg_ctl stop -m fast, falling back to pg.stop().
 */
export async function stopEmbeddedPostgresCleanly(
  pg: any,
  dataDir: string,
  log: (s: string) => void = () => {},
): Promise<void> {
  if (!pg || !pg.process) return;

  // On Windows, taskkill /f causes abnormal termination unless stopped with pg_ctl
  if (process.platform === 'win32') {
    try {
      const binModule = await importEsm('@embedded-postgres/windows-x64');
      const pgCtl = binModule?.pg_ctl;
      if (pgCtl && fs.existsSync(pgCtl)) {
        log(`Arrêt propre de PostgreSQL via pg_ctl sur ${dataDir}...`);
        const res = spawnSync(pgCtl, ['stop', '-m', 'fast', '-D', dataDir], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10000,
        });
        if (res.status === 0) {
          log(`PostgreSQL arrêté proprement via pg_ctl.`);
        }
      }
    } catch (ctlError) {
      log(`Avertissement pg_ctl stop: ${String(ctlError)}`);
    }
  }

  try {
    await pg.stop();
  } catch (stopErr) {
    log(`Avertissement lors de pg.stop(): ${String(stopErr)}`);
  }
}

export interface StartDatabaseOptions {
  inspector?: ProcessInspector;
  maxRetries?: number;
}

/**
 * Starts a private PostgreSQL server bundled with the app (no installation needed).
 * Data lives in <dir>/pgdata and survives updates; the server listens on 127.0.0.1 only, on a free port.
 */
export async function startEmbeddedPostgres(
  dir: string,
  port: number,
  log: (s: string) => void,
  options: StartDatabaseOptions = {},
): Promise<EmbeddedDb> {
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

  // Clean stale lock or residual process if any
  const inspector = options.inspector ?? new SystemProcessInspector();
  const pidCheck = inspectAndCleanPostmasterPid(dataDir, inspector, log);
  if (pidCheck.foreignProcessPid) {
    throw new Error(`Un processus étranger (PID ${pidCheck.foreignProcessPid}) occupe le verrou postmaster.pid.`);
  }

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

  let started = false;
  try {
    if (!initialised) {
      // Never delete if PG_VERSION is present. If folder is completely fresh or half-init without PG_VERSION:
      fs.rmSync(dataDir, { recursive: true, force: true });
      await pg.initialise();
    }
    await pg.start();
    started = true;
    await ensureDatabaseExists(pg, 'enis_timetable', log);
  } catch (e: any) {
    const isDup = started && (e?.code === '42P04' || /already exists/i.test(String(e?.message ?? e)));
    if (isDup) {
      return {
        url: `postgres://enis:${meta.password}@127.0.0.1:${port}/enis_timetable`,
        stop: () => stopEmbeddedPostgresCleanly(pg, dataDir, log),
      };
    }
    try {
      await stopEmbeddedPostgresCleanly(pg, dataDir, log);
    } catch (stopError) {
      log(`Impossible d’arrêter PostgreSQL après l’échec du démarrage: ${String(stopError)}`);
    }
    throw e;
  }

  return {
    url: `postgres://enis:${meta.password}@127.0.0.1:${port}/enis_timetable`,
    stop: () => stopEmbeddedPostgresCleanly(pg, dataDir, log),
  };
}
