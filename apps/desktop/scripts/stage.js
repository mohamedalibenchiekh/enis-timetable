// Prepares the files electron-builder copies next to the app (extraResources):
//   stage/api  → compiled NestJS server + its production node_modules
//   stage/web  → static Next.js site
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const apps = path.join(__dirname, '..', '..');
const repoRoot = path.join(apps, '..');
const stage = path.join(__dirname, '..', 'stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'api'), { recursive: true });

fs.cpSync(path.join(apps, 'api', 'dist'), path.join(stage, 'api', 'dist'), { recursive: true });
fs.cpSync(path.join(apps, 'web', 'out'), path.join(stage, 'web'), { recursive: true });

// Install the API's production dependencies in a nested tree so workspace-only versions
// cannot overwrite root-hoisted packages with incompatible versions.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enis-stage-'));
fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(tmp, 'package.json'));
fs.copyFileSync(path.join(repoRoot, 'package-lock.json'), path.join(tmp, 'package-lock.json'));
['api', 'web', 'desktop'].forEach((w) => {
  fs.mkdirSync(path.join(tmp, 'apps', w), { recursive: true });
  fs.copyFileSync(path.join(apps, w, 'package.json'), path.join(tmp, 'apps', w, 'package.json'));
});

execSync('npm ci --omit=dev --workspace=@enis/api --install-strategy=nested --no-audit --no-fund', { cwd: tmp, stdio: 'inherit' });

fs.cpSync(path.join(tmp, 'apps', 'api', 'node_modules'), path.join(stage, 'api', 'node_modules'), { recursive: true });
if (fs.existsSync(path.join(stage, 'api', 'node_modules', '@enis'))) {
  fs.rmSync(path.join(stage, 'api', 'node_modules', '@enis'), { recursive: true, force: true });
}
fs.copyFileSync(path.join(apps, 'api', 'package.json'), path.join(stage, 'api', 'package.json'));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('staged in', stage);
