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
const apiPackage = path.join(apps, 'api', 'package.json');
const stagedApi = path.join(stage, 'api', 'apps', 'api');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stagedApi, { recursive: true });

fs.cpSync(path.join(apps, 'api', 'dist'), path.join(stagedApi, 'dist'), { recursive: true });
fs.cpSync(path.join(apps, 'web', 'out'), path.join(stage, 'web'), { recursive: true });

// Install only the API workspace so dependencies from the web and desktop workspaces
// cannot change the API's production dependency tree.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enis-stage-'));
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
rootPackage.workspaces = ['apps/api'];
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify(rootPackage, null, 2));
fs.copyFileSync(path.join(repoRoot, 'package-lock.json'), path.join(tmp, 'package-lock.json'));
fs.mkdirSync(path.join(tmp, 'apps', 'api'), { recursive: true });
fs.copyFileSync(apiPackage, path.join(tmp, 'apps', 'api', 'package.json'));

execSync('npm ci --omit=dev --workspace=@enis/api --no-audit --no-fund', { cwd: tmp, stdio: 'inherit' });

fs.cpSync(path.join(tmp, 'node_modules'), path.join(stage, 'api', 'node_modules'), { recursive: true });
fs.cpSync(path.join(tmp, 'apps', 'api', 'node_modules'), path.join(stagedApi, 'node_modules'), { recursive: true });
for (const nodeModules of [path.join(stage, 'api', 'node_modules'), path.join(stagedApi, 'node_modules')]) {
  const workspaceLink = path.join(nodeModules, '@enis');
  if (fs.existsSync(workspaceLink)) fs.rmSync(workspaceLink, { recursive: true, force: true });
}
fs.copyFileSync(apiPackage, path.join(stagedApi, 'package.json'));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('staged in', stage);
