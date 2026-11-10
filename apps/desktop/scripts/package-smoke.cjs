const { spawn } = require('node:child_process');
const { once } = require('node:events');
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

async function main() {
  const releaseDir = path.resolve(__dirname, '..', 'release');
  const platformDirs = ['win-unpacked', 'linux-unpacked', 'mac'];
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
  let apiLogs = '';

  try {
    database = await startEmbeddedPostgres(databaseDir, await reservePort(), (message) => {
      apiLogs += `${message}\n`;
    });
    const port = await reservePort();
    api = spawn(process.execPath, [path.join(apiDir, 'dist', 'main.js')], {
      cwd: apiDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(port),
        DATABASE_URL: database.url,
        WEB_DIR: webDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    api.stdout.on('data', (data) => { apiLogs += data.toString(); });
    api.stderr.on('data', (data) => { apiLogs += data.toString(); });
    apiClosed = once(api, 'close');

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (api.exitCode !== null) throw new Error(`The packaged API exited with code ${api.exitCode}:\n${apiLogs}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) {
          console.log('Packaged API and embedded PostgreSQL started successfully.');
          api.kill();
          await apiClosed;
          api = undefined;
          apiClosed = undefined;
          return;
        }
      } catch {
        // The API is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`The packaged API did not become healthy:\n${apiLogs}`);
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
