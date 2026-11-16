import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURES_DIR = path.resolve('apps/api/test/fixtures');

async function generateFixtures() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const kinds = [
    { html: 'FET_rooms_test.html', pdf: 'FET_rooms_test.pdf' },
    { html: 'FET_teachers_test.html', pdf: 'FET_teachers_test.pdf' },
    { html: 'FET_groups_test.html', pdf: 'FET_groups_test.pdf' },
  ];

  for (const { html, pdf } of kinds) {
    const htmlPath = path.join(FIXTURES_DIR, html);
    if (!fs.existsSync(htmlPath)) continue;

    let content = fs.readFileSync(htmlPath, 'utf8');

    // Add print styles to ensure exactly one table per landscape A4 page
    const printStyle = `
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { margin: 0; font-family: "DejaVu Sans", Arial, sans-serif; font-size: 8pt; }
        .table-page { page-break-after: always; break-after: page; width: 100%; height: 95vh; display: flex; flex-direction: column; }
        .header-line { font-size: 9pt; font-weight: bold; margin-bottom: 4px; }
        table[id^="table_"] { width: 100%; border-collapse: collapse; margin-bottom: 8px; flex: 1; }
        table[id^="table_"] th, table[id^="table_"] td { border: 1px solid #000; padding: 2px 4px; text-align: center; vertical-align: middle; }
        .footer-line { font-size: 7pt; color: #333; margin-top: auto; }
      </style>
    `;

    // Wrap each table in a container with institution header and FET footer
    content = content.replace(
      /(<table id="table_\d+">[\s\S]*?<\/table>)/g,
      `<div class="table-page">
         <div class="header-line">Ecole Nationale d'Ingénieurs de Sousse ENISo</div>
         $1
         <div class="footer-line">Planning généré avec FET 6.7.1 le 15/11/2026 17:42</div>
       </div>`,
    );

    content = content.replace('<head>', `<head>${printStyle}`);

    await page.setContent(content, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
    });

    const outPdfPath = path.join(FIXTURES_DIR, pdf);
    fs.writeFileSync(outPdfPath, pdfBuffer);
    console.log(`Generated fixture: ${pdf} (${pdfBuffer.length} bytes)`);
  }

  await browser.close();
}

generateFixtures().catch((err) => {
  console.error(err);
  process.exit(1);
});
