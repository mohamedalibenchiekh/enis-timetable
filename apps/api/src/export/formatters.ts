import { clean } from '../parser/html-parser.js';

const titleCase = (w: string) =>
  w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());

export function formatTeacher(name: string, abbreviateBen: boolean): string {
  const s = clean(name);
  if (!s || s === '-') return '';
  const words = s.split(' ').map(titleCase);
  if (abbreviateBen && words.length >= 3 && words[0] === 'Ben') words[0] = 'B';
  return words.join(' ');
}

/** "A02" → "A 0-2", "B12 (Labo Anglais)" → "B 1-2", "Amphi" → "Amphi" */
export function roomLabel(room: string): string {
  const name = clean(room).replace(/\s*\(.*\)\s*$/, '');
  const match = name.match(/^([A-Za-z])(\d)(\d)$/);
  return match ? `${match[1].toUpperCase()} ${match[2]}-${match[3]}` : name;
}
