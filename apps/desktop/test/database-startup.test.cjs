const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ensureDatabaseExists, assertEmbeddedDatabaseVersion, DatabaseVersionMismatchError, DatabaseVersionFileCorruptError } = require('../dist/database.js');
const { inspectAndCleanPostmasterPid, SystemProcessInspector } = require('../dist/pid-manager.js');
const { classifyStartupError } = require('../dist/error-classifier.js');
const { maskUsername, maskCredentials, rotateLogs } = require('../dist/logger.js');

test('startup succeeds when database enis_timetable already exists', async () => {
  let created = false;
  const fakePg = {
    getPgClient: () => ({
      connect: async () => {},
      query: async (sql, params) => {
        if (sql.includes('SELECT 1 FROM pg_database')) {
          return { rows: [{ '?column?': 1 }] }; // database already exists!
        }
        return { rows: [] };
      },
      end: async () => {},
    }),
    createDatabase: async () => {
      created = true;
    },
  };

  const logs = [];
  await ensureDatabaseExists(fakePg, 'enis_timetable', (m) => logs.push(m));
  assert.equal(created, false, 'createDatabase should not be called when database exists in pg_database');
  assert.ok(logs.some((l) => l.includes('déjà existante')));
});

test('ensureDatabaseExists catches SQLSTATE 42P04 duplicate_database as success', async () => {
  const fakePg = {
    getPgClient: () => ({
      connect: async () => {},
      query: async () => ({ rows: [] }), // simulates race: check didn't see it
      end: async () => {},
    }),
    createDatabase: async () => {
      const err = new Error('database "enis_timetable" already exists');
      err.code = '42P04';
      throw err;
    },
  };

  const logs = [];
  await assert.doesNotReject(async () => {
    await ensureDatabaseExists(fakePg, 'enis_timetable', (m) => logs.push(m));
  });
  assert.ok(logs.some((l) => l.includes('42P04')));
});

test('stale postmaster.pid with dead PID is cleaned safely', () => {
  const tmpDir = path.join(__dirname, 'temp-pid-dead');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'postmaster.pid'), '99999999\n/some/data\n');

  const fakeInspector = {
    isPidAlive: () => false,
    isPostgresPid: () => false,
    killPid: () => true,
  };

  const res = inspectAndCleanPostmasterPid(tmpDir, fakeInspector);
  assert.equal(res.cleaned, true);
  assert.equal(fs.existsSync(path.join(tmpDir, 'postmaster.pid')), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('unparseable postmaster.pid fails closed and is NOT unlinked', () => {
  const tmpDir = path.join(__dirname, 'temp-pid-corrupt');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'postmaster.pid'), 'NOT_A_NUMBER\n/some/data\n');

  const fakeInspector = {
    isPidAlive: () => false,
    isPostgresPid: () => false,
    killPid: () => false,
  };

  const res = inspectAndCleanPostmasterPid(tmpDir, fakeInspector);
  assert.equal(res.cleaned, false);
  assert.ok(res.error);
  assert.equal(fs.existsSync(path.join(tmpDir, 'postmaster.pid')), true, 'File must not be deleted');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('stale postmaster.pid with live foreign PID is preserved and flagged', () => {
  const tmpDir = path.join(__dirname, 'temp-pid-foreign');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'postmaster.pid'), '12345\n/some/data\n');

  const fakeInspector = {
    isPidAlive: (pid) => pid === 12345,
    isPostgresPid: () => false, // not our postgres process
    killPid: () => false,
  };

  const res = inspectAndCleanPostmasterPid(tmpDir, fakeInspector);
  assert.equal(res.cleaned, false);
  assert.equal(res.foreignProcessPid, 12345);
  assert.equal(fs.existsSync(path.join(tmpDir, 'postmaster.pid')), true);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('residual live postgres PID is stopped and postmaster.pid is cleaned', () => {
  const tmpDir = path.join(__dirname, 'temp-pid-pg');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'postmaster.pid'), '54321\n/some/data\n');

  let alive = true;
  const fakeInspector = {
    isPidAlive: () => alive,
    isPostgresPid: () => true,
    killPid: () => {
      alive = false;
      return true;
    },
    stopPostgres: () => {
      alive = false;
      return true;
    },
  };

  const res = inspectAndCleanPostmasterPid(tmpDir, fakeInspector);
  assert.equal(res.cleaned, true);
  assert.equal(fs.existsSync(path.join(tmpDir, 'postmaster.pid')), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('error classification maps errors to plain French messages and preserves error message in details', () => {
  const errLock = new Error('Un autre exemplaire de l’application est déjà ouvert');
  assert.match(classifyStartupError(errLock).userMessage, /autre exemplaire/i);

  const errPort = new Error('listen EADDRINUSE: address already in use 127.0.0.1:5432');
  assert.match(classifyStartupError(errPort).userMessage, /port réseau/i);

  const errLockDir = new Error('EBUSY: resource busy or locked');
  assert.match(classifyStartupError(errLockDir).userMessage, /dossier de données est verrouillé/i);

  const errSpace = new Error('ENOSPC: no space left on device');
  assert.match(classifyStartupError(errSpace).userMessage, /espace disque insuffisant/i);

  const errPerm = new Error('EACCES: permission denied');
  assert.match(classifyStartupError(errPerm).userMessage, /droits d’accès refusés/i);

  const classified = classifyStartupError(new Error('Fatal error occurred'), 'log line 1\nlog line 2');
  assert.ok(classified.technicalDetail.includes('Fatal error occurred'), 'Detail must include error message');
  assert.ok(classified.technicalDetail.includes('log line 2'), 'Detail must include log tail');
});

test('maskUsername anonymizes user paths without leaking usernames', () => {
  const originalUser = process.env.USER;
  const originalUsername = process.env.USERNAME;
  try {
    process.env.USERNAME = 'testuser';
    delete process.env.USER;

    const samplePath = `C:\\Users\\testuser\\AppData\\Roaming\\enis`;
    const masked = maskUsername(samplePath);
    assert.ok(!masked.includes('testuser'), `Masked string should not contain testuser: ${masked}`);
    assert.ok(masked.includes('***'));

    // Test with regex metacharacters in username
    process.env.USERNAME = 'user.name+test';
    const specialPath = `C:\\Users\\user.name+test\\Documents`;
    const maskedSpecial = maskUsername(specialPath);
    assert.ok(!maskedSpecial.includes('user.name+test'));
    assert.ok(maskedSpecial.includes('***'));
  } finally {
    if (originalUsername !== undefined) process.env.USERNAME = originalUsername;
    else delete process.env.USERNAME;
    if (originalUser !== undefined) process.env.USER = originalUser;
    else delete process.env.USER;
  }
});

test('maskCredentials masks passwords and usernames in postgres and postgresql URLs', () => {
  const pgUrl = 'postgres://admin:secret123@127.0.0.1:5432/enis_timetable';
  assert.equal(maskCredentials(pgUrl), 'postgres://***:***@127.0.0.1:5432/enis_timetable');

  const psqlUrl = 'postgresql://app_user:p@ss@@word@db.host.internal:5432/production';
  assert.equal(maskCredentials(psqlUrl), 'postgresql://***:***@db.host.internal:5432/production');

  const queryUrl = 'postgresql:///db?password=secret&other=val';
  assert.equal(maskCredentials(queryUrl), 'postgresql:///db?password=***&other=val');
});

test('assertEmbeddedDatabaseVersion validates exact major version without allowing prefix garbage', () => {
  const tmpDir = path.join(__dirname, 'temp-version-check');
  const pgdata = path.join(tmpDir, 'pgdata');
  fs.mkdirSync(pgdata, { recursive: true });

  // 17 exact matches
  fs.writeFileSync(path.join(pgdata, 'PG_VERSION'), '17\n');
  assert.doesNotThrow(() => assertEmbeddedDatabaseVersion(tmpDir));

  // 17garbage must fail with DatabaseVersionFileCorruptError
  fs.writeFileSync(path.join(pgdata, 'PG_VERSION'), '17garbage');
  assert.throws(() => assertEmbeddedDatabaseVersion(tmpDir), DatabaseVersionFileCorruptError);

  // Incompatible version must fail with DatabaseVersionMismatchError and preserve version string
  fs.writeFileSync(path.join(pgdata, 'PG_VERSION'), '16');
  assert.throws(
    () => assertEmbeddedDatabaseVersion(tmpDir),
    (err) => err instanceof DatabaseVersionMismatchError && err.message.includes('PostgreSQL 16'),
  );

  // Pre-10 dotted version (e.g. 9.6) must fail with DatabaseVersionMismatchError and preserve '9.6'
  fs.writeFileSync(path.join(pgdata, 'PG_VERSION'), '9.6\n');
  assert.throws(
    () => assertEmbeddedDatabaseVersion(tmpDir),
    (err) => err instanceof DatabaseVersionMismatchError && err.message.includes('PostgreSQL 9.6'),
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('rotateLogs keeps exactly maxFiles - 1 files', () => {
  const tmpDir = path.join(__dirname, 'temp-rotate-logs');
  fs.mkdirSync(tmpDir, { recursive: true });
  for (let i = 1; i <= 8; i++) {
    fs.writeFileSync(path.join(tmpDir, `startup-20261121T00000${i}.log`), `test log ${i}`);
  }
  rotateLogs(tmpDir, 5);
  const remaining = fs.readdirSync(tmpDir).filter((f) => f.startsWith('startup-'));
  assert.equal(remaining.length, 4, `Expected exactly 4 logs, got ${remaining.length}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
