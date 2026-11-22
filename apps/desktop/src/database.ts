import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { inspectAndCleanPostmasterPid, ProcessInspector, SystemProcessInspector } from './pid-manager';

export const EMBEDDED_POSTGRES_VERSION = 17;

export class DatabaseVersionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseVersionMismatchError';
  }
}

export class DatabaseVersionFileCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseVersionFileCorruptError';
  }
}

/**
 * Asserts that the embedded PostgreSQL data directory is compatible with the bundled PostgreSQL version.
 * Throws DatabaseVersionMismatchError if an incompatible PG_VERSION is detected.
 */
export function assertEmbeddedDatabaseVersion(dir: string): void {
  const versionFile = path.join(dir, 'pgdata', 'PG_VERSION');
  if (!fs.existsSync(versionFile)) return; // Fresh install or not yet initialized
  const content = fs.readFileSync(versionFile, 'utf8').trim();
  if (!/^\d+(?:\.\d+)?$/.test(content)) {
    throw new DatabaseVersionFileCorruptError(
      `Le fichier de version PostgreSQL est vide ou corrompu (${content || 'vide'}). Les données n’ont pas été modifiées.`
    );
  }
  if (content !== String(EMBEDDED_POSTGRES_VERSION)) {
    throw new DatabaseVersionMismatchError(
      `La base de données existante utilise PostgreSQL ${content}, incompatible avec PostgreSQL ${EMBEDDED_POSTGRES_VERSION} fourni avec cette version. ` +
      `Restaurez une sauvegarde compatible ou utilisez une version précédente de l'application.`
    );
  }
}

export interface EmbeddedDb {
  url: string;
  stop: () => Promise<void>;
}

// Dynamically import ESM package in CommonJS context
async function importEsm(specifier: string): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const dynamicImport = new Function('s', 'return import(s)');
  return dynamicImport(specifier);
}

/**
 * Ensures the target database exists, checking pg_database first and tolerating
 * race conditions (SQLSTATE 42P04 duplicate_database) without failure.
 */
export async function ensureDatabaseExists(
  pg: any,
  databaseName: string,
  log: (s: string) => void = () => {},
): Promise<void> {
  const client = pg.getPgClient();
  await client.connect();
  try {
    const res = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [databaseName],
    );
    if (res.rows.length === 0) {
      log(`Création de la base de données « ${databaseName} »...`);
      try {
        await pg.createDatabase(databaseName);
        log(`Base de données « ${databaseName} » créée avec succès.`);
      } catch (createErr: any) {
        if (createErr?.code === '42P04' || /already exists/i.test(createErr?.message)) {
          log(`Base de données « ${databaseName} » déjà existante (42P04 ignoré).`);
        } else {
          throw createErr;
        }
      }
    } else {
      log(`Base de données « ${databaseName} » déjà existante.`);
    }
  } finally {
    try {
      await client.end();
    } catch {
      // client end error ignored
    }
  }
}

/**
 * Stops PostgreSQL cleanly. On Windows, runs pg_ctl stop -m fast before pg.stop()
 * to ensure checkpoints and file locks are cleanly released without crash recovery.
 */
export async function stopEmbeddedPostgresCleanly(
  pg: any,
  dataDir: string,
  log: (s: string) => void = () => {},
): Promise<void> {
  if (!pg || !pg.process) return;

  const inspector = new SystemProcessInspector();
  const pid = pg.process.pid;

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

  let stopError: unknown = null;
  try {
    await pg.stop();
  } catch (stopErr) {
    stopError = stopErr;
    log(`Avertissement lors de pg.stop(): ${String(stopErr)}`);
  }

  // Verify process exit
  if (pid && inspector.isPidAlive(pid)) {
    log(`Le processus PostgreSQL (PID ${pid}) est toujours actif après pg.stop().`);
    if (stopError) {
      throw stopError;
    }
    throw new Error(`Le processus PostgreSQL (PID ${pid}) n'a pas pu être arrêté.`);
  }
}

export interface StartDatabaseOptions {
  inspector?: ProcessInspector;
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
  if (pidCheck.error) {
    throw new Error(`Verrou postmaster.pid invalide ou corrompu : ${pidCheck.error}`);
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
      // Check if dataDir already exists and contains files other than empty dir
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir);
        if (files.length > 0) {
          // Data directory has files but lacks PG_VERSION: corrupt or incomplete cluster.
          // Never delete automatically to avoid data loss.
          throw new DatabaseVersionFileCorruptError(
            `Le dossier de base de données (${dataDir}) contient des fichiers mais le fichier PG_VERSION est absent. ` +
            `Pour éviter toute perte de données, le dossier n’a pas été supprimé automatiquement.`
          );
        }
      }
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
