import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'apps/api/test/fixtures');
const outputDir = path.join(root, 'apps/web/public/guide');
const previewDir = path.join(root, 'apps/web/test-output/guide-preview');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enis-guide-'));
const stagedOutputDir = path.join(tempDir, 'guide-assets');
const children = [];
let postgres;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Impossible d’obtenir un port local.'));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function start(command, args, options) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-6000); });
  child.stderr.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-6000); });
  child.guideLogs = () => logs;
  children.push(child);
  return child;
}

async function waitFor(url, child, label) {
  const stopAt = Date.now() + 120_000;
  while (Date.now() < stopAt) {
    if (child.exitCode !== null) throw new Error(`${label} s’est arrêté :\n${child.guideLogs()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* server is starting */ }
    await delay(350);
  }
  throw new Error(`${label} ne répond pas à temps :\n${child.guideLogs()}`);
}

async function startDatabase() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const port = await freePort();
  const password = 'guide-test-only';
  postgres = new EmbeddedPostgres({
    databaseDir: path.join(tempDir, 'postgres'), user: 'enis', password, port, persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('enis_timetable');
  return `postgres://enis:${password}@127.0.0.1:${port}/enis_timetable`;
}

async function capture(page, file, selector) {
  await page.addStyleTag({ content: `.tlist .small { visibility: hidden !important; } ${selector} { outline: 4px solid #ff2828 !important; outline-offset: 4px !important; }` });
  const buffer = await page.screenshot({ fullPage: false, animations: 'disabled' });
  await sharp(buffer).png({ palette: true, quality: 86, effort: 10 }).toFile(path.join(stagedOutputDir, file));
  await page.evaluate(() => document.querySelectorAll('style').item(document.querySelectorAll('style').length - 1)?.remove());
}

function runTool(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} a échoué : ${result.stderr || result.stdout}`);
}

async function createBeforeAfter(fixtureFile, docxFile) {
  const pdfDir = path.join(tempDir, 'word-pdf');
  fs.mkdirSync(pdfDir, { recursive: true });
  runTool('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', pdfDir, docxFile]);
  const pdf = path.join(pdfDir, `${path.parse(docxFile).name}.pdf`);
  const wordImage = path.join(pdfDir, 'word-page');
  runTool('pdftoppm', ['-f', '1', '-l', '1', '-png', '-r', '100', '-singlefile', pdf, wordImage]);
  const htmlPage = path.join(pdfDir, 'fet-table.png');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 760 }, deviceScaleFactor: 1.5, colorScheme: 'light' });
  const fixture = fs.readFileSync(fixtureFile, 'utf8');
  await page.setContent(fixture, { waitUntil: 'load' });
  await page.screenshot({ path: htmlPage, fullPage: false });
  await browser.close();
  const left = await sharp(htmlPage).resize(620, 720, { fit: 'contain', background: '#fff' }).png().toBuffer();
  const right = await sharp(`${wordImage}.png`).resize(620, 720, { fit: 'contain', background: '#fff' }).png().toBuffer();
  const caption = (label) => Buffer.from(`<svg width="620" height="44"><rect width="100%" height="100%" fill="#eef3f8"/><text x="18" y="29" font-family="Arial" font-size="19" fill="#182331">${label}</text></svg>`);
  const composed = await sharp({ create: { width: 1280, height: 800, channels: 4, background: '#ffffff' } })
    .composite([
      { input: caption('Tableau HTML exporté depuis FET'), left: 12, top: 12 },
      { input: caption('Document Word généré par ENISo'), left: 648, top: 12 },
      { input: left, left: 12, top: 58 },
      { input: right, left: 648, top: 58 },
    ]).png({ palette: true, quality: 86, effort: 10 }).toBuffer();
  await sharp(composed).toFile(path.join(stagedOutputDir, 'apercu-html-vers-word.png'));
}

function publishScreenshots() {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const file of fs.readdirSync(stagedOutputDir).filter((entry) => entry.endsWith('.png'))) {
    const destination = path.join(outputDir, file);
    const temporaryFile = `${destination}.tmp-${process.pid}`;
    fs.copyFileSync(path.join(stagedOutputDir, file), temporaryFile);
    fs.renameSync(temporaryFile, destination);
  }
}

async function main() {
  fs.mkdirSync(stagedOutputDir, { recursive: true });
  fs.mkdirSync(previewDir, { recursive: true });
  const apiPort = await freePort();
  const webPort = await freePort();
  const databaseUrl = await startDatabase();
  runTool('npm', ['run', 'build', '-w', 'apps/api']);
  const apiServer = start(process.execPath, [path.join(root, 'apps/api/dist/main.js')], {
    cwd: path.join(root, 'apps/api'), env: { ...process.env, PORT: String(apiPort), WEB_DIR: path.join(root, 'apps/web/out'), DATABASE_URL: databaseUrl },
  });
  await waitFor(`http://127.0.0.1:${apiPort}/api/health`, apiServer, 'API');
  const webServer = start(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '-p', String(webPort), '-H', '127.0.0.1'], {
    cwd: path.join(root, 'apps/web'), env: { ...process.env, API_URL: `http://127.0.0.1:${apiPort}`, NEXT_TELEMETRY_DISABLED: '1' },
  });
  await waitFor(`http://127.0.0.1:${webPort}`, webServer, 'Interface');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, colorScheme: 'light', acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${webPort}`, { waitUntil: 'networkidle' });
  await capture(page, 'importer-fichiers.png', '.drop');
  const files = ['FET_rooms_test.html', 'FET_teachers_test.html', 'FET_groups_test.html'].map((name) => path.join(fixtureDir, name));
  await page.locator('input[type=file]').setInputFiles(files);
  await page.getByRole('button', { name: 'Importer', exact: true }).last().click();
  await page.getByRole('table').waitFor({ state: 'visible' });
  await capture(page, 'apercu-emploi-du-temps.png', 'table.grid');

  const dayLink = page.getByRole('link', { name: 'Télécharger le document du jour' });
  let downloadedDocx;
  for (const day of ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']) {
    await page.getByRole('button', { name: day, exact: true }).click();
    await page.locator('.dayhead').getByText(day, { exact: true }).waitFor({ state: 'visible' });
    const dayDownload = page.waitForEvent('download');
    await dayLink.click();
    const download = await dayDownload;
    if (!download.suggestedFilename().endsWith('.docx')) throw new Error(`Le téléchargement de ${day} ne produit pas de fichier .docx.`);
    if (day === 'Jeudi') downloadedDocx = download;
  }
  if (!downloadedDocx) throw new Error('Le document Word de jeudi est introuvable.');
  const docxPath = path.join(tempDir, downloadedDocx.suggestedFilename());
  await downloadedDocx.saveAs(docxPath);
  await createBeforeAfter(files[0], docxPath);
  const zipDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Tous les jours (.zip)' }).click();
  if (!(await zipDownload).suggestedFilename().endsWith('.zip')) throw new Error('Le téléchargement de tous les jours ne produit pas de fichier .zip.');

  await page.getByRole('button', { name: /Options du document Word/ }).click();
  await page.locator('.options').waitFor({ state: 'visible' });
  await capture(page, 'options-document-word.png', '.options');
  await page.getByLabel('Abréger « BEN » en « B » (ex. B Rhouma Asma)').check();
  await page.getByLabel('Afficher « 1/15 » pour les séances une semaine sur deux').check();
  await page.getByLabel('Lister aussi les salles libres').check();
  await page.getByLabel('Libellé de la pause').fill('Pause déjeuner');
  await page.locator('.blocrow input').first().fill('BLOC « A »');
  await page.locator('.blocrow input').nth(1).fill('^A\\d\\d, ^A\\d\\d');
  await page.getByRole('button', { name: '+ ajouter un bloc' }).click();
  await page.getByRole('button', { name: 'supprimer' }).last().click();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.getByText('Options enregistrées').waitFor({ state: 'visible' });

  await page.getByRole('button', { name: 'Noms' }).click();
  await page.locator('.names-section').first().waitFor({ state: 'visible' });
  await capture(page, 'noms-et-libelles.png', '.names-toolbar');
  const teacherName = page.locator('.names-input').first();
  await teacherName.fill('Enseignant Exemple');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.getByText('Noms enregistrés').waitFor({ state: 'visible' });
  const nameExport = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter les noms (.json)' }).click();
  const exportedNames = await nameExport;
  if (!exportedNames.suggestedFilename().endsWith('.json')) throw new Error('L’export des noms ne produit pas de fichier JSON.');
  const namesPath = path.join(tempDir, 'noms-enis.json');
  await exportedNames.saveAs(namesPath);
  await page.getByRole('button', { name: 'Importer des noms…' }).click();
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles(namesPath);
  await page.getByText(/Import terminé/).waitFor({ state: 'visible' });

  const exportFolder = path.join(tempDir, 'documents');
  fs.mkdirSync(exportFolder);
  const timetable = await (await fetch(`http://127.0.0.1:${apiPort}/api/timetables`)).json();
  const folderResult = await fetch(`http://127.0.0.1:${apiPort}/api/timetables/${timetable[0].id}/export-to-folder`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: exportFolder }),
  });
  if (!folderResult.ok || fs.readdirSync(exportFolder).filter((name) => name.endsWith('.docx')).length !== 6) {
    throw new Error('L’enregistrement des six documents dans un dossier n’a pas fonctionné.');
  }

  const { buildGuide } = await import('./guide-build.mjs');
  buildGuide(root);
  await page.goto(`http://127.0.0.1:${webPort}`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Aide', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.pathname.startsWith('/aide'));
  await page.screenshot({ path: path.join(previewDir, 'aide-clair.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'Noms et libellés' }).click();
  await page.waitForFunction(() => location.hash === '#noms-et-libelles');
  const headingPosition = await page.locator('#noms-et-libelles').evaluate((element) => ({ top: element.getBoundingClientRect().top, height: window.innerHeight }));
  if (headingPosition.top < 0 || headingPosition.top > headingPosition.height) throw new Error('Le lien du sommaire ne positionne pas le bon chapitre.');
  await page.getByLabel('Rechercher dans le guide').fill('salles libres');
  await page.locator('.guide-content mark').first().waitFor({ state: 'visible' });
  if (await page.getByRole('heading', { name: 'Installer l’application' }).isVisible()) throw new Error('La recherche ne filtre pas les chapitres.');
  await page.getByLabel('Rechercher dans le guide').fill('');
  await page.setViewportSize({ width: 1024, height: 768 });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (horizontalOverflow) throw new Error('Le guide défile horizontalement à 1024 px.');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(previewDir, 'aide-sombre.png'), fullPage: true, animations: 'disabled' });
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.screenshot({ path: path.join(previewDir, 'aide-impression.png'), fullPage: true, animations: 'disabled' });
  const hiddenNav = await page.locator('.guide-nav').evaluate((node) => getComputedStyle(node).display === 'none');
  if (!hiddenNav) throw new Error('La navigation reste visible dans le média d’impression.');
  const brokenImages = await page.locator('.guide-content img').evaluateAll((images) => images.filter((image) => !(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0).length);
  if (brokenImages) throw new Error(`${brokenImages} image(s) du guide ne se chargent pas.`);
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const child of children) if (child === apiServer && child.exitCode === null) child.kill('SIGTERM');
  await page.reload({ waitUntil: 'networkidle' });
  if (!(await page.getByRole('heading', { name: 'Guide d’utilisation d’ENISo' }).isVisible())) throw new Error('Le guide ne s’ouvre pas sans l’API.');
  if (pageErrors.length) throw new Error(`Erreurs JavaScript dans l’interface : ${pageErrors.join('\n')}`);
  await browser.close();

  const sizes = fs.readdirSync(stagedOutputDir).filter((file) => file.endsWith('.png'))
    .map((file) => [file, fs.statSync(path.join(stagedOutputDir, file)).size]);
  const total = sizes.reduce((sum, [, size]) => sum + size, 0);
  if (sizes.some(([, size]) => size > 200 * 1024) || total > 3 * 1024 * 1024) {
    throw new Error(`Captures trop volumineuses : ${JSON.stringify(sizes)} (total ${total} octets)`);
  }
  publishScreenshots();
  console.log(`Captures générées (${total} octets) : ${sizes.map(([name]) => name).join(', ')}`);
  console.log(`Aperçus du guide : ${previewDir}`);
}

try {
  await main();
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  if (postgres) await postgres.stop().catch(() => {});
  fs.rmSync(tempDir, { recursive: true, force: true });
}
