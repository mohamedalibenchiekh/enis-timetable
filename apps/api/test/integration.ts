/* CI integration test: start the API, upload fixture HTML files, download docx + zip, validate.
   usage: ts-node test/integration.ts
   Requires DATABASE_URL and API_PORT (defaults to 4000) env vars.
   Exit code 1 on any failure. */
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

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

/** Check if a buffer starts with the ZIP magic number (PK\x03\x04). */
function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

(async () => {
  console.log(`Testing API at ${BASE_URL}...`);

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
  const timetableId = timetable.id;
  assert(!!timetableId, `Got timetable ID: ${timetableId}`);
  console.log(`Uploaded timetable: ${timetableId}`);

  // 3. Download one day's .docx (day 0 = Lundi)
  const docxRes = await request('GET', `/api/timetables/${timetableId}/days/0/docx`);
  assert(docxRes.status === 200, `GET docx returned ${docxRes.status}`);
  assert(docxRes.body.length > 0, `docx body is non-empty (${docxRes.body.length} bytes)`);
  // DOCX files are ZIP archives
  assert(isZip(docxRes.body), 'docx response is a valid ZIP archive');

  // 4. Download the full zip
  const zipRes = await request('GET', `/api/timetables/${timetableId}/export.zip`);
  assert(zipRes.status === 200, `GET zip returned ${zipRes.status}`);
  assert(zipRes.body.length > 0, `zip body is non-empty (${zipRes.body.length} bytes)`);
  assert(isZip(zipRes.body), 'zip response is a valid ZIP archive');

  // 5. Cleanup: delete the timetable
  const delRes = await request('DELETE', `/api/timetables/${timetableId}`);
  assert(delRes.status === 200, `DELETE returned ${delRes.status}`);

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

