// Prepares the files electron-builder copies next to the app (extraResources):
//   stage/api  → compiled NestJS server + its production node_modules
//   stage/web  → static Next.js site
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const apps = path.join(__dirname, '..', '..');
const stage = path.join(__dirname, '..', 'stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'api'), { recursive: true });

fs.cpSync(path.join(apps, 'api', 'dist'), path.join(stage, 'api', 'dist'), { recursive: true });
fs.cpSync(path.join(apps, 'web', 'out'), path.join(stage, 'web'), { recursive: true });

// Install the API's production dependencies in a temp folder OUTSIDE the project: running npm inside
// the workspace tree would modify the root node_modules.
const pkg = JSON.parse(fs.readFileSync(path.join(apps, 'api', 'package.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enis-stage-'));
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, dependencies: pkg.dependencies }, null, 2));
execSync('npm install --omit=dev --no-audit --no-fund', { cwd: tmp, stdio: 'inherit' });
fs.cpSync(path.join(tmp, 'node_modules'), path.join(stage, 'api', 'node_modules'), { recursive: true });
fs.copyFileSync(path.join(tmp, 'package.json'), path.join(stage, 'api', 'package.json'));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('staged in', stage);
