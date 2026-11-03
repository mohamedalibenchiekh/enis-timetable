// Prepares the files electron-builder copies next to the app (extraResources):
//   stage/api  → compiled NestJS server + its production node_modules
//   stage/web  → static Next.js site
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const apps = path.join(__dirname, '..', '..');
const stage = path.join(__dirname, '..', 'stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'api'), { recursive: true });

fs.cpSync(path.join(apps, 'api', 'dist'), path.join(stage, 'api', 'dist'), { recursive: true });
fs.cpSync(path.join(apps, 'web', 'out'), path.join(stage, 'web'), { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(apps, 'api', 'package.json'), 'utf8'));
fs.writeFileSync(path.join(stage, 'api', 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, dependencies: pkg.dependencies }, null, 2));
execSync('npm install --omit=dev --no-audit --no-fund --workspaces=false', { cwd: path.join(stage, 'api'), stdio: 'inherit' });
console.log('staged in', stage);
