import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDayDocx } from '../../src/export/docx-builder.js';
import { buildDayGrid } from '../../src/export/grid-builder.js';
import { DEFAULT_OPTIONS } from '../../src/export/options.js';
import { parseHtml } from '../../src/parser/html-parser.js';

const visualDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(visualDirectory, '../fixtures');
const baselineDir = path.resolve(visualDirectory, 'baselines');

export interface VisualCase {
  name: string;
  document: Buffer;
}

function readRoomsFixture(fileName: string) {
  const html = fs.readFileSync(path.join(fixturesDir, fileName), 'utf8');
  return parseHtml(html, 'rooms');
}

export async function buildVisualCases(): Promise<VisualCase[]> {
  const standard = readRoomsFixture('FET_rooms_test.html');
  const standardMeta = { days: standard.days, slots: standard.slots, rooms: standard.owners };
  const cases: VisualCase[] = [];

  for (let day = 0; day < standard.days.length; day++) {
    const grid = buildDayGrid(standard.sessions, standardMeta, day, DEFAULT_OPTIONS);
    cases.push({ name: standard.days[day], document: await buildDayDocx(grid) });
  }

  const stressHtml = fs.readFileSync(path.join(fixturesDir, 'visual', 'FET_rooms_visual_stress.html'), 'utf8');
  const stress = parseHtml(stressHtml, 'rooms');
  if (
    stress.sessions.length !== 1 ||
    stress.sessions[0].day !== 0 ||
    stress.sessions[0].teachers.split(',').length !== 3 ||
    stress.sessions[0].frequency !== '1/15' ||
    !stress.sessions[0].teachers.split(',').every((teacher) => teacher.length >= 30)
  ) {
    throw new Error('The visual stress fixture must contain one long-name cell with three teachers and frequency 1/15.');
  }
  const stressMeta = { days: stress.days, slots: stress.slots, rooms: stress.owners };
  const stressGrid = buildDayGrid(stress.sessions, stressMeta, 0, DEFAULT_OPTIONS);
  cases.push({ name: 'stress', document: await buildDayDocx(stressGrid) });

  return cases;
}

export function getBaselinePath(name: string): string {
  return path.join(baselineDir, `${name}.png`);
}
