import * as fs from 'fs';
import * as path from 'path';
import { parseHtml } from '../src/parser/html-parser.js';
import { compareSessions } from '../src/compare/compare.js';
import { DEFAULT_OPTIONS } from '../src/export/options.js';
import { createNameResolver } from '../src/export/name-resolver.js';
import type { CompareSource } from '../src/compare/types.js';

const dir = process.argv[2] ?? 'test/fixtures';
const source = (process.argv[3] ?? 'teachers') as CompareSource;

function load(versionDir: string, kind: CompareSource) {
  const file = fs.readdirSync(versionDir).find((f) => f.toLowerCase().includes(kind === 'teachers' ? 'teacher' : kind === 'rooms' ? 'room' : 'group'));
  if (!file) throw new Error(`no ${kind} file in ${versionDir}`);
  const html = fs.readFileSync(path.join(versionDir, file), 'utf8');
  return parseHtml(html, kind);
}

const v1Dir = dir.endsWith('v2') ? path.join(dir, '..') : dir;
const v2Dir = dir.endsWith('v2') ? dir : path.join(dir, 'v2');

const base = load(v1Dir, source);
const target = load(v2Dir, source);
const meta = (p: ReturnType<typeof parseHtml>) => ({ days: p.days, slots: p.slots, rooms: p.owners });
const summary = (p: ReturnType<typeof parseHtml>, id: string) => ({
  id, name: id, institution: p.institution, comment: p.comment, generatedAt: p.generatedAt, createdAt: '', files: [],
});
void 0;
const resolver = createNameResolver(new Map(), new Map());
const result = compareSessions(
  { summary: summary(base, 'v1'), meta: meta(base), sessions: base.sessions },
  { summary: summary(target, 'v2'), meta: meta(target), sessions: target.sessions },
  source,
  DEFAULT_OPTIONS,
  resolver,
);
const out = process.argv[4];
const json = JSON.stringify(result, null, 2);
if (out) fs.writeFileSync(out, json, 'utf8');
else console.log(json);
