/* CI integration test: start the API, upload fixture HTML files, download docx + zip, validate.
   usage: ts-node test/integration.ts
   Requires DATABASE_URL and API_PORT (defaults to 4000) env vars.
   Exit code 1 on any failure. */
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import JSZip = require('jszip');

const API_PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
const BASE_URL = `http://127.0.0.1:${API_PORT}`;
const FIXTURE_DIR = path.join(__dirname, 'fixtures');

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failures++;
  } else {
    console.log(`  ok: ${message}`);
  }
}

/** Simple HTTP request returning {status, headers, body} */
function request(
  method: string,
  urlPath: string,
  options?: { body?: Buffer; headers?: Record<string, string> },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const req = http.request(url, { method, headers: options?.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}

/** Build a multipart/form-data body for file uploads. */
function buildMultipart(files: { name: string; filename: string; content: Buffer }[]): { body: Buffer; contentType: string } {
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: text/html\r\n\r\n`,
    ));
    parts.push(f.content);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Wait for the API to respond on /api/health */
async function waitForApi(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`API did not respond on ${BASE_URL}/api/health within ${timeoutMs}ms`);
}

/** Parse and validate that a buffer is a readable, uncorrupted ZIP archive. */
async function validateZip(buf: Buffer, expectedMinFiles = 1): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const files = Object.keys(zip.files);
    return files.length >= expectedMinFiles;
  } catch (e) {
    console.error('ZIP archive parsing failed:', e);
    return false;
  }
}

(async () => {
  let timetableId: string | null = null;
  console.log(`Testing API at ${BASE_URL}...`);

  try {
    // 1. Wait for health endpoint
    await waitForApi();
    console.log('API is healthy.');

    // 2. Upload fixture HTML files
    const htmlFiles = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.html'));
    assert(htmlFiles.length >= 2, `Found ${htmlFiles.length} fixture HTML files`);

    const parts = htmlFiles.map((f) => ({
      name: 'files',
      filename: f,
      content: fs.readFileSync(path.join(FIXTURE_DIR, f)),
    }));
    const { body: uploadBody, contentType } = buildMultipart(parts);

    const uploadRes = await request('POST', '/api/timetables', {
      body: uploadBody,
      headers: { 'Content-Type': contentType },
    });
    assert(uploadRes.status === 201 || uploadRes.status === 200, `Upload returned ${uploadRes.status} (expected 200 or 201)`);

    const timetable = JSON.parse(uploadRes.body.toString());
    timetableId = timetable.id;
    assert(!!timetableId, `Got timetable ID: ${timetableId}`);
    console.log(`Uploaded timetable: ${timetableId}`);

    // 3. Download one day's .docx (day 0 = Lundi) and parse as readable ZIP
    const docxRes = await request('GET', `/api/timetables/${timetableId}/days/0/docx`);
    assert(docxRes.status === 200, `GET docx returned ${docxRes.status}`);
    assert(docxRes.body.length > 0, `docx body is non-empty (${docxRes.body.length} bytes)`);
    const docxValid = await validateZip(docxRes.body, 1);
    assert(docxValid, 'docx response is a readable, valid ZIP archive containing document files');

    // 4. Download the full zip and verify it contains 6 day documents
    const zipRes = await request('GET', `/api/timetables/${timetableId}/export.zip`);
    assert(zipRes.status === 200, `GET zip returned ${zipRes.status}`);
    assert(zipRes.body.length > 0, `zip body is non-empty (${zipRes.body.length} bytes)`);
    const zipValid = await validateZip(zipRes.body, 6);
    assert(zipValid, 'zip response is a readable, valid ZIP archive containing all 6 daily documents');
  } finally {
    // Always clean up created timetable even if earlier steps failed
    if (timetableId) {
      try {
        const delRes = await request('DELETE', `/api/timetables/${timetableId}`);
        assert(delRes.status === 200, `DELETE cleanup returned ${delRes.status}`);
      } catch (err) {
        console.error('Failed to clean up timetable:', err);
      }
    }
  }

  // Final result
  console.log('');
  if (failures > 0) {
    console.error(`${failures} assertion(s) FAILED`);
    process.exit(1);
  } else {
    console.log('All integration assertions passed.');
  }
})().catch((err) => {
  console.error('Integration test error:', err);
  process.exit(1);
});
