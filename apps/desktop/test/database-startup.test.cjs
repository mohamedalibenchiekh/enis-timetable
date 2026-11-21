const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ensureDatabaseExists } = require('../dist/database.js');
const { inspectAndCleanPostmasterPid } = require('../dist/pid-manager.js');
const { classifyStartupError } = require('../dist/error-classifier.js');
const { maskUsername, rotateLogs } = require('../dist/logger.js');

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

test('stale postmaster.pid with live foreign PID is preserved and flagged', () => {
  const tmpDir = path.join(__dirname, 'temp-pid-foreign');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'postmaster.pid'), '12345\n/some/data\n');

  const fakeInspector = {
    isPidAlive: (pid) => pid === 12345,
    isPostgresPid: () => false, // not a postgres process
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
  };

  const res = inspectAndCleanPostmasterPid(tmpDir, fakeInspector);
  assert.equal(res.cleaned, true);
  assert.equal(fs.existsSync(path.join(tmpDir, 'postmaster.pid')), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('error classification maps errors to plain French messages', () => {
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
});

test('maskUsername anonymizes user paths without leaking usernames', () => {
  const user = process.env.USERNAME || process.env.USER || 'moham';
  const samplePath = `C:\\Users\\${user}\\AppData\\Roaming\\enis`;
  const masked = maskUsername(samplePath);
  assert.ok(!masked.includes(user), `Masked string should not contain ${user}: ${masked}`);
  assert.ok(masked.includes('***'));
});

test('rotateLogs keeps at most 5 files', () => {
  const tmpDir = path.join(__dirname, 'temp-rotate-logs');
  fs.mkdirSync(tmpDir, { recursive: true });
  for (let i = 1; i <= 8; i++) {
    fs.writeFileSync(path.join(tmpDir, `startup-2026112100000${i}.log`), `test log ${i}`);
  }
  rotateLogs(tmpDir, 5);
  const remaining = fs.readdirSync(tmpDir).filter((f) => f.startsWith('startup-'));
  assert.ok(remaining.length <= 5, `Expected <= 5 logs, got ${remaining.length}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
