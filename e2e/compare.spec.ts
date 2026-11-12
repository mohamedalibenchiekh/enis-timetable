import { test, expect } from '@playwright/test';
import * as path from 'node:path';

const fixtureDir = path.join(__dirname, '..', 'apps', 'api', 'test', 'fixtures');
const v2Dir = path.join(fixtureDir, 'v2');

test('imports a new version, compares changes, filters, highlights and exports', async ({ page }) => {
  const ids: string[] = [];
  try {
    // --- import v1 -------------------------------------------------------------
    await page.goto('/');
    await page.getByRole('button', { name: '+ Importer' }).click();
    await page.locator('input[type=file]').setInputFiles([
      path.join(fixtureDir, 'FET_rooms_test.html'),
      path.join(fixtureDir, 'FET_teachers_test.html'),
      path.join(fixtureDir, 'FET_groups_test.html'),
    ]);
    let uploadResponse = page.waitForResponse((r) => r.url().includes('/api/timetables') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Importer', exact: true }).click();
    const v1 = await (await uploadResponse).json() as { id: string };
    ids.push(v1.id);
    await expect(page.getByRole('heading', { name: 'Fixture test data' })).toBeVisible();

    // --- import v2 as a new version of v1 --------------------------------------
    await page.getByRole('button', { name: '+ Importer' }).click();
    await page.locator('input[type=file]').setInputFiles([
      path.join(v2Dir, 'FET_rooms_v2.html'),
      path.join(v2Dir, 'FET_teachers_v2.html'),
      path.join(v2Dir, 'FET_groups_v2.html'),
    ]);
    await page.getByLabel(/Nouvelle version de/).selectOption(v1.id);
    uploadResponse = page.waitForResponse((r) => r.url().includes('/api/timetables') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Importer', exact: true }).click();
    const v2 = await (await uploadResponse).json() as { id: string; previousTimetableId: string; comparison: { total: number } };
    ids.push(v2.id);
    expect(v2.previousTimetableId).toBe(v1.id);
    expect(v2.comparison.total).toBeGreaterThan(0);

    // --- open the Changements tab ------------------------------------------------
    await page.getByRole('button', { name: 'Changements' }).click();
    await expect(page.getByRole('heading', { name: 'Changements' })).toBeVisible();
    await expect(page.getByText('Déplacée : 2')).toBeVisible();
    await expect(page.getByText('Salle changée : 1')).toBeVisible();
    await expect(page.getByText('Ajoutée : 1')).toBeVisible();
    await expect(page.getByText('Supprimée : 1')).toBeVisible();
    await expect(page.getByText('Jours à rééditer')).toBeVisible();

    // Export links are present.
    await expect(page.getByRole('link', { name: 'Exporter la fiche (.docx)' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Exporter (.csv)' })).toBeVisible();

    // Filter by type.
    const selects = page.getByRole('combobox');
    await selects.nth(2).selectOption('moved');
    await expect(page.getByText('T301 | Physique')).toBeVisible();
    await expect(page.getByText('T201 | Algèbre')).toBeVisible();
    await expect(page.getByText('T802 | Projet tutoré')).toBeHidden();
    await selects.nth(2).selectOption('');

    // Search filter.
    await page.getByPlaceholder('Rechercher…').fill('T802');
    await expect(page.getByText('T802 | Projet tutoré')).toBeVisible();
    await expect(page.getByText('T301 | Physique')).toBeHidden();
    await page.getByPlaceholder('Rechercher…').fill('');

    // --- highlight changed cells in the schedule preview -------------------------
    await page.getByRole('button', { name: 'Emploi du temps' }).click();
    await page.getByLabel('Surligner les changements').check();
    await expect(page.locator('td.hl').first()).toBeVisible();
  } finally {
    for (const id of ids) await page.request.delete(`/api/timetables/${id}`);
  }
});
