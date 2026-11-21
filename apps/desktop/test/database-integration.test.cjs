const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startEmbeddedPostgres } = require('../dist/database.js');

const hasPostgres = (() => {
  try {
    const pkg = process.platform === 'win32'
      ? '@embedded-postgres/windows-x64'
      : `@embedded-postgres/${process.platform}-${process.arch}`;
    const p = require.resolve(pkg);
    return Boolean(p);
  } catch {
    return false;
  }
})();

test('Integration: Embedded PostgreSQL lifecycle (3x start/stop, kill, data persistence)', {
  skip: !hasPostgres ? 'Embedded postgres binary unavailable for this platform' : false,
  timeout: 180_000,
}, async () => {
  const testDir = path.join(__dirname, 'temp-integration-db');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  const getClient = (url) => {
    const { Client } = require('pg');
    return new Client({ connectionString: url });
  };

  try {
    // 1. First launch
    const db1 = await startEmbeddedPostgres(testDir, 54361, () => {});
    assert.ok(db1.url.includes('enis_timetable'));

    const client1 = getClient(db1.url);
    await client1.connect();
    await client1.query('CREATE TABLE persistence_test (id serial primary key, val text)');
    await client1.query("INSERT INTO persistence_test (val) VALUES ('first_run_val')");
    await client1.end();
    await db1.stop();

    // 2. Second launch on existing data folder
    const db2 = await startEmbeddedPostgres(testDir, 54362, () => {});
    const client2 = getClient(db2.url);
    await client2.connect();
    const res2 = await client2.query('SELECT val FROM persistence_test');
    assert.equal(res2.rows.length, 1);
    assert.equal(res2.rows[0].val, 'first_run_val');
    await client2.query("INSERT INTO persistence_test (val) VALUES ('second_run_val')");
    await client2.end();
    await db2.stop();

    // 3. Third launch
    const db3 = await startEmbeddedPostgres(testDir, 54363, () => {});
    const client3 = getClient(db3.url);
    await client3.connect();
    const res3 = await client3.query('SELECT COUNT(*)::int AS count FROM persistence_test');
    assert.equal(res3.rows[0].count, 2);
    await client3.end();

    // 4. Force kill simulation (kill -9 style while running)
    const pidFile = path.join(testDir, 'pgdata', 'postmaster.pid');
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').split('\n')[0].trim(), 10);
    assert.ok(pid > 0);

    // Hard kill via taskkill or SIGKILL
    const { spawnSync } = require('child_process');
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], { timeout: 5000 });
    } else {
      process.kill(pid, 'SIGKILL');
    }

    // Ensure pid file or process is in unclean state, then relaunch
    const db4 = await startEmbeddedPostgres(testDir, 54364, () => {});
    const client4 = getClient(db4.url);
    await client4.connect();
    const res4 = await client4.query('SELECT COUNT(*)::int AS count FROM persistence_test');
    assert.equal(res4.rows[0].count, 2); // Data intact!
    await client4.end();
    await db4.stop();

  } finally {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
