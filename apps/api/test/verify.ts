/* End-to-end check: parse HTML fixtures → cross-check rooms vs teachers → generate .docx files.
   usage: ts-node test/verify.ts [<dir with 3 html files>] [<out dir>]
   Defaults to test/fixtures when no directory is given.
   Exit code 1 on any assertion failure. */
import * as fs from 'fs';
import * as path from 'path';
import { detectKind, parseHtml } from '../src/parser/html-parser';
import { buildDayGrid } from '../src/export/grid-builder';
import { buildDayDocx } from '../src/export/docx-builder';
import { DEFAULT_OPTIONS } from '../src/export/options';

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failures++;
  } else {
    console.log(`  ok: ${message}`);
  }
}

const dir = process.argv[2] || path.join(__dirname, 'fixtures');
if (!fs.existsSync(dir)) {
  console.error(`Directory not found: ${dir}`);
  process.exit(1);
}
const out = process.argv[3] ?? path.join(process.cwd(), 'test-output');
fs.mkdirSync(out, { recursive: true });

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
assert(files.length >= 2, `At least 2 HTML files found (got ${files.length})`);

const parsed: Record<string, ReturnType<typeof parseHtml>> = {};
for (const f of files) {
  const html = fs.readFileSync(path.join(dir, f), 'utf8');
  const kind = detectKind(f, html)!;
  assert(!!kind, `detectKind recognised ${f} as ${kind}`);
  parsed[kind] = parseHtml(html, kind);
  const p = parsed[kind];
  console.log(kind.padEnd(8), 'owners', p.owners.length, 'sessions', p.sessions.length, '|', p.institution, '|', p.comment, '|', p.generatedAt);
}

assert(!!parsed.rooms, 'rooms view parsed');
assert(!!parsed.teachers, 'teachers view parsed');

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
onlyA.slice(0, 10).forEach((x) => console.log('  rooms only   ', x));
onlyB.slice(0, 10).forEach((x) => console.log('  teachers only', x));
assert(onlyA.length === 0 && onlyB.length === 0, 'rooms and teachers views give identical session sets');

// --- rowspan assertion --------------------------------------------------------------------------
const roomsSessions = parsed.rooms.sessions;
const rowspanSessions = roomsSessions.filter(
  (s) => s.subjectCode === 'T301' && s.room.toLowerCase() === 'a01',
);
const rowspanSlots = new Set(rowspanSessions.map((s) => s.slot));
assert(rowspanSlots.size >= 2, `rowspan session (T301/Physique) appears in ${rowspanSlots.size} slots (expected >= 2)`);

// --- split-cell filtering -----------------------------------------------------------------------
// In rooms view for B01, the split cell has two activities; only B01's should be kept
const b01Sessions = roomsSessions.filter((s) => s.owner.toLowerCase() === 'b01');
const b01Rooms = new Set(b01Sessions.map((s) => s.room.toLowerCase()));
assert(!b01Rooms.has('b02'), 'split-cell activity from other room (B02) is excluded from B01 owner');
assert(b01Sessions.length === 1, `B01 keeps exactly 1 session from split cell (got ${b01Sessions.length})`);

// --- time slot overrides ------------------------------------------------------------------------
const slots = parsed.rooms.slots;
const slotWithMS = slots.find((s) => s.raw.includes('M/S'));
assert(!!slotWithMS, 'found a slot with M/S override');
if (slotWithMS) {
  assert(slotWithMS.overrides[2] === '12:00-13:30', `Mercredi override is 12:00-13:30 (got ${slotWithMS.overrides[2]})`);
  assert(slotWithMS.overrides[5] === '12:00-13:30', `Samedi override is 12:00-13:30 (got ${slotWithMS.overrides[5]})`);
}
const slotWithV = slots.find((s) => s.raw.includes('V:') && s.base.startsWith('14'));
assert(!!slotWithV, 'found a slot with V: override');
if (slotWithV) {
  assert(slotWithV.overrides[4] === '14:00-15:30', `Vendredi override is 14:00-15:30 (got ${slotWithV.overrides[4]})`);
}

// --- bi-weekly frequency (1/15) -----------------------------------------------------------------
const freqSession = roomsSessions.find((s) => s.frequency === '1/15');
assert(!!freqSession, 'found a session with frequency 1/15');

// --- generate all days and assert 6 .docx files -----------------------------------------------
const src = parsed.rooms;
const meta = { days: src.days, slots: src.slots, rooms: src.owners };
(async () => {
  const docxFiles: string[] = [];
  for (let d = 0; d < src.days.length; d++) {
    const grid = buildDayGrid(src.sessions, meta, d, DEFAULT_OPTIONS);
    const buf = await buildDayDocx(grid);
    const filePath = path.join(out, `${src.days[d]}.docx`);
    fs.writeFileSync(filePath, buf);
    fs.writeFileSync(path.join(out, `${src.days[d]}.json`), JSON.stringify(grid, null, 1));
    docxFiles.push(filePath);
    console.log(src.days[d], 'sessions', grid.sessionCount, 'rooms', grid.blocs.map((bl) => bl.rows.length).join('+'), 'bytes', buf.length);
  }

  assert(docxFiles.length === 6, `6 .docx files generated (got ${docxFiles.length})`);
  for (const f of docxFiles) {
    const stat = fs.statSync(f);
    assert(stat.size > 0, `${path.basename(f)} is non-empty (${stat.size} bytes)`);
  }

  // Final result
  console.log('');
  if (failures > 0) {
    console.error(`${failures} assertion(s) FAILED`);
    process.exit(1);
  } else {
    console.log('All assertions passed.');
  }
})();
