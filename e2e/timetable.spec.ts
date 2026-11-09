import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const fixtureDir = path.join(__dirname, '..', 'apps', 'api', 'test', 'fixtures');
const JSZip = createRequire(path.join(__dirname, '..', 'apps', 'api', 'dist', 'main.js'))('jszip') as typeof import('../apps/api/node_modules/jszip');

test('imports fixtures, previews a day, downloads Word, and updates an export option', async ({ page }) => {
  let timetableId = '';
  let tempDir = '';
  const originalOptions = await (await page.request.get('/api/settings/export')).json();
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '+ Importer' }).click();
    await page.locator('input[type=file]').setInputFiles([
      path.join(fixtureDir, 'FET_rooms_test.html'),
      path.join(fixtureDir, 'FET_teachers_test.html'),
      path.join(fixtureDir, 'FET_groups_test.html'),
    ]);
    const uploadResponse = page.waitForResponse((response) =>
      response.url().includes('/api/timetables') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Importer', exact: true }).click();
    const uploaded = await (await uploadResponse).json() as { id: string };
    timetableId = uploaded.id;
    await expect(page.getByRole('heading', { name: 'Fixture test data' })).toBeVisible();
    await expect(page.getByText('Prof Dupont 1/15')).toBeVisible();

    await page.getByRole('button', { name: 'Mercredi' }).click();
    await expect(page.getByRole('columnheader', { name: 'Mercredi' })).toBeVisible();
    await page.getByRole('button', { name: 'Lundi' }).click();
    await expect(page.getByText('Prof Dupont')).toBeVisible();

    const downloadWait = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Télécharger Lundi.docx' }).click();
    const download = await downloadWait;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enis-e2e-'));
    const file = path.join(tempDir, download.suggestedFilename());
    await download.saveAs(file);
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const xml = await zip.file('word/document.xml')?.async('string');
    expect(xml).toContain('Prof Dupont 1/15');

    await page.getByRole('button', { name: /Options du document Word/ }).click();
    await page.getByLabel(/Afficher « 1\/15 »/).uncheck();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Prof Dupont', { exact: true })).toBeVisible();
  } finally {
    if (timetableId) await page.request.delete(`/api/timetables/${timetableId}`);
    await page.request.put('/api/settings/export', { data: originalOptions });
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
