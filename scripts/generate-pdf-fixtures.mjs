import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURES_DIR = path.resolve('apps/api/test/fixtures');

function normalizePdfBuffer(buffer) {
  let str = buffer.toString('binary');
  // Normalize timestamps and document IDs while preserving exact byte lengths so xref offsets remain valid
  str = str.replace(/\/CreationDate\s*\(([^)]+)\)/g, (match, d) => {
    const fixed = 'D:20261115174200Z'.padEnd(d.length, '0').slice(0, d.length);
    return `/CreationDate (${fixed})`;
  });
  str = str.replace(/\/ModDate\s*\(([^)]+)\)/g, (match, d) => {
    const fixed = 'D:20261115174200Z'.padEnd(d.length, '0').slice(0, d.length);
    return `/ModDate (${fixed})`;
  });
  str = str.replace(/\/ID\s*\[\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\]/g, (match, id1, id2) => {
    return `/ID [<${'0'.repeat(id1.length)}> <${'0'.repeat(id2.length)}>]`;
  });
  return Buffer.from(str, 'binary');
}

async function generateFixtures() {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    if (err?.message?.includes("Executable doesn't exist")) {
      console.error(
        'Playwright Chromium is required to generate PDF fixtures. Please install it first with: npx playwright install chromium',
      );
      process.exit(1);
    }
    throw err;
  }

  const page = await browser.newPage();

  const kinds = [
    { html: 'FET_rooms_test.html', pdf: 'FET_rooms_test.pdf' },
    { html: 'FET_teachers_test.html', pdf: 'FET_teachers_test.pdf' },
    { html: 'FET_groups_test.html', pdf: 'FET_groups_test.pdf' },
  ];

  for (const { html, pdf } of kinds) {
    const htmlPath = path.join(FIXTURES_DIR, html);
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`Missing source HTML fixture: ${htmlPath}`);
    }

    const content = fs.readFileSync(htmlPath, 'utf8');

    await page.setContent(content, { waitUntil: 'domcontentloaded' });

    // Use DOM manipulation in Chromium to wrap complete outer timetable tables,
    // avoiding regex pitfalls with nested .detailed tables
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = `
        @page { size: A4 landscape; margin: 10mm; }
        body { margin: 0; font-family: "DejaVu Sans", Arial, sans-serif; font-size: 8pt; }
        .table-page { page-break-after: always; break-after: page; width: 100%; height: 95vh; display: flex; flex-direction: column; }
        .header-line { font-size: 9pt; font-weight: bold; margin-bottom: 4px; }
        table[id^="table_"] { width: 100%; border-collapse: collapse; margin-bottom: 8px; flex: 1; }
        table[id^="table_"] th, table[id^="table_"] td { border: 1px solid #000; padding: 2px 4px; text-align: center; vertical-align: middle; }
        .footer-line { font-size: 7pt; color: #333; margin-top: auto; }
      `;
      document.head.appendChild(style);

      const tables = Array.from(document.querySelectorAll('table[id^="table_"]'));
      for (const table of tables) {
        const wrapper = document.createElement('div');
        wrapper.className = 'table-page';

        const header = document.createElement('div');
        header.className = 'header-line';
        header.textContent = "Ecole Nationale d'Ingénieurs de Sousse ENISo";

        const footer = document.createElement('div');
        footer.className = 'footer-line';
        footer.textContent = 'Planning généré avec FET 6.7.1 le 15/11/2026 17:42';

        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(header);
        wrapper.appendChild(table);
        wrapper.appendChild(footer);
      }
    });

    const rawPdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
    });

    const normalizedPdfBuffer = normalizePdfBuffer(rawPdfBuffer);
    const outPdfPath = path.join(FIXTURES_DIR, pdf);
    fs.writeFileSync(outPdfPath, normalizedPdfBuffer);
    console.log(`Generated fixture: ${pdf} (${normalizedPdfBuffer.length} bytes)`);
  }

  await browser.close();
}

generateFixtures().catch((err) => {
  console.error(err);
  process.exit(1);
});
