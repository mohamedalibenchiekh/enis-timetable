/* End-to-end check of parser + grid + docx against the real files and the reference Jeudi.docx.
   usage: ts-node test/verify.ts <dir with the 3 html files and Jeudi.docx> <out dir> */
import * as fs from 'fs';
import * as path from 'path';
import { detectKind, parseHtml } from '../src/parser/html-parser';
import { buildDayGrid } from '../src/export/grid-builder';
import { buildDayDocx } from '../src/export/docx-builder';
import { DEFAULT_OPTIONS } from '../src/export/options';

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error('usage: npm test -w apps/api -- <folder containing the 3 FET .html files> [output folder]');
  process.exit(1);
}
const out = process.argv[3] ?? path.join(process.cwd(), 'test-output');
fs.mkdirSync(out, { recursive: true });

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
const parsed: Record<string, ReturnType<typeof parseHtml>> = {};
for (const f of files) {
  const html = fs.readFileSync(path.join(dir, f), 'utf8');
  const kind = detectKind(f, html)!;
  parsed[kind] = parseHtml(html, kind);
  const p = parsed[kind];
  console.log(kind.padEnd(8), 'owners', p.owners.length, 'sessions', p.sessions.length, '|', p.institution, '|', p.comment, '|', p.generatedAt);
}

// --- cross check rooms view vs teachers view ---------------------------------------------------
const split = (s: string) => s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const keyset = (sess: typeof parsed.rooms.sessions, needRoom: boolean) => {
  const set = new Set<string>();
  for (const s of sess) {
    if (needRoom && !s.room) continue;
    for (const t of split(s.teachers)) set.add([s.day, s.slot, s.room.toLowerCase(), t, s.subjectCode].join('|'));
  }
  return set;
};
const a = keyset(parsed.rooms.sessions, true);
const b = keyset(parsed.teachers.sessions, true);
const onlyA = [...a].filter((x) => !b.has(x));
const onlyB = [...b].filter((x) => !a.has(x));
console.log(`rooms-view vs teachers-view: ${a.size} / ${b.size}; only in rooms ${onlyA.length}, only in teachers ${onlyB.length}`);
onlyA.slice(0, 5).forEach((x) => console.log('  rooms only   ', x));
onlyB.slice(0, 5).forEach((x) => console.log('  teachers only', x));

// --- generate all days -------------------------------------------------------------------------
const src = parsed.rooms;
const meta = { days: src.days, slots: src.slots, rooms: src.owners };
(async () => {
  for (let d = 0; d < src.days.length; d++) {
    const grid = buildDayGrid(src.sessions, meta, d, DEFAULT_OPTIONS);
    const buf = await buildDayDocx(grid);
    fs.writeFileSync(path.join(out, `${src.days[d]}.docx`), buf);
    fs.writeFileSync(path.join(out, `${src.days[d]}.json`), JSON.stringify(grid, null, 1));
    console.log(src.days[d], 'sessions', grid.sessionCount, 'rooms', grid.blocs.map((b) => b.rows.length).join('+'), 'bytes', buf.length);
  }

  if (onlyA.length > 0 || onlyB.length > 0) {
    console.error(`Parity check failed: ${onlyA.length} session(s) only in rooms, ${onlyB.length} session(s) only in teachers.`);
    process.exit(1);
  }
})();
