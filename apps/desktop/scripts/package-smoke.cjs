const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local port.');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function isAddressInUse(error) {
  return /EADDRINUSE|address already in use/i.test(String(error));
}

async function startApi(apiDir, webDir, databaseUrl, logs) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = await reservePort();
    const child = spawn(process.execPath, [path.join(apiDir, 'dist', 'main.js')], {
      cwd: apiDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(port),
        DATABASE_URL: databaseUrl,
        WEB_DIR: webDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let spawnError;
    child.on('error', (error) => { spawnError = error; });
    const closed = new Promise((resolve) => child.once('close', resolve));
    const capture = (data) => { logs.push(data.toString()); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    try {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`The packaged API exited with code ${child.exitCode} and signal ${child.signalCode}.`);
        }
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`);
          if (response.ok) return { child, closed };
        } catch {
          // The API is still starting.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('The packaged API did not become healthy.');
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null && !spawnError) child.kill();
      await closed;
      if (isAddressInUse(error) && attempt < 4) continue;
      throw error;
    }
  }
  throw new Error('The packaged API could not bind to a free port after 5 attempts.');
}

async function startDatabase(startEmbeddedPostgres, databaseDir, log) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await startEmbeddedPostgres(databaseDir, await reservePort(), log);
    } catch (error) {
      if (!isAddressInUse(error) || attempt === 4) throw error;
    }
  }
  throw new Error('Embedded PostgreSQL could not bind to a free port after 5 attempts.');
}

async function main() {
  const releaseDir = path.resolve(__dirname, '..', 'release');
  const platformDirs = ['win-unpacked', 'linux-unpacked'];
  const resourcesDir = platformDirs
    .map((directory) => path.join(releaseDir, directory, 'resources'))
    .find((directory) => fs.existsSync(directory));
  if (!resourcesDir) throw new Error('Could not find an unpacked application resources directory.');

  const apiDir = path.join(resourcesDir, 'api', 'apps', 'api');
  const webDir = path.join(resourcesDir, 'web');
  const { startEmbeddedPostgres } = require(path.join(resourcesDir, 'app', 'dist', 'database.js'));
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enis-package-smoke-'));
  let database;
  let api;
  let apiClosed;
  const apiLogs = [];

  try {
    database = await startDatabase(startEmbeddedPostgres, databaseDir, (message) => {
      apiLogs.push(`${message}\n`);
    });
    const runningApi = await startApi(apiDir, webDir, database.url, apiLogs);
    api = runningApi.child;
    apiClosed = runningApi.closed;
    console.log('Packaged API and embedded PostgreSQL started successfully.');
    api.kill();
    await apiClosed;
    api = undefined;
    apiClosed = undefined;
  } catch (error) {
    if (apiLogs.length === 0) throw error;
    throw new Error(`${String(error)}\n${apiLogs.join('')}`, { cause: error });
  } finally {
    if (api && api.exitCode === null) {
      api.kill();
      if (apiClosed) await apiClosed;
    }
    if (database) await database.stop();
    fs.rmSync(databaseDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
