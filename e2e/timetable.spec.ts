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
  const originalNames = await (await page.request.get('/api/names/export')).json() as {
    teachers: { key: string; sourceName: string; displayName: string }[];
    rooms: { key: string; sourceName: string; displayName: string }[];
  };
  const originalTeacher = originalNames.teachers.find((entry) => entry.key === 'prof dupont');
  const originalRoom = originalNames.rooms.find((entry) => entry.key === 'a01');
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

    await page.getByRole('button', { name: 'Noms' }).click();
    await page.getByRole('textbox', { name: 'Affiché dans Word pour Prof Dupont' }).fill('Hanafi Latifa');
    await page.getByRole('textbox', { name: 'Affiché dans Word pour A01' }).fill('Salle 01');
    await page.emulateMedia({ colorScheme: 'light' });
    await test.info().attach('noms-light.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await test.info().attach('noms-dark.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Noms enregistrés')).toBeVisible();

    await page.getByRole('button', { name: 'Emploi du temps' }).click();
    await expect(page.getByText('Hanafi Latifa 1/15')).toBeVisible();
    await expect(page.getByRole('row', { name: /Salle 01/ })).toBeVisible();
    await page.getByRole('button', { name: 'Mercredi' }).click();
    await expect(page.getByRole('columnheader', { name: 'Mercredi' })).toBeVisible();
    await page.getByRole('button', { name: 'Lundi' }).click();
    await expect(page.getByText('Hanafi Latifa')).toBeVisible();

    const downloadWait = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Télécharger Lundi.docx' }).click();
    const download = await downloadWait;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enis-e2e-'));
    const file = path.join(tempDir, download.suggestedFilename());
    await download.saveAs(file);
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const xml = await zip.file('word/document.xml')?.async('string');
    expect(xml).toContain('Hanafi Latifa 1/15');
    expect(xml).toContain('Salle 01');
    expect(xml).not.toContain('Prof Dupont');

    await page.getByRole('button', { name: /Options du document Word/ }).click();
    await page.getByLabel(/Afficher « 1\/15 »/).uncheck();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Hanafi Latifa', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Noms' }).click();
    await page.getByRole('button', { name: 'Réinitialiser Prof Dupont' }).click();
    await page.getByRole('button', { name: 'Réinitialiser A01' }).click();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Noms enregistrés')).toBeVisible();
    await page.getByRole('button', { name: 'Emploi du temps' }).click();
    await expect(page.getByText('Prof Dupont')).toBeVisible();
    await expect(page.getByRole('row', { name: /A 0-1/ })).toBeVisible();

    const resetDownloadWait = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Télécharger Lundi.docx' }).click();
    const resetDownload = await resetDownloadWait;
    const resetFile = path.join(tempDir, resetDownload.suggestedFilename());
    await resetDownload.saveAs(resetFile);
    const resetZip = await JSZip.loadAsync(fs.readFileSync(resetFile));
    const resetXml = await resetZip.file('word/document.xml')?.async('string');
    expect(resetXml).toContain('Prof Dupont');
    expect(resetXml).toContain('A 0-1');
    expect(resetXml).not.toContain('Hanafi Latifa');
  } finally {
    if (timetableId) await page.request.delete(`/api/timetables/${timetableId}`);
    await page.request.put('/api/names/teachers', {
      data: { items: [{ sourceName: originalTeacher?.sourceName ?? 'Prof Dupont', displayName: originalTeacher?.displayName ?? '' }] },
    });
    await page.request.put('/api/names/rooms', {
      data: { items: [{ sourceName: originalRoom?.sourceName ?? 'A01', displayName: originalRoom?.displayName ?? '' }] },
    });
    await page.request.put('/api/settings/export', { data: originalOptions });
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
