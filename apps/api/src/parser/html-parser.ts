import * as cheerio from 'cheerio';
import { ParsedFile, ParsedSession, SlotLabel, SourceKind } from './types';

const DAY_CODES: Record<string, number> = { L: 0, MA: 1, M: 2, ME: 2, J: 3, V: 4, S: 5 };

export function clean(s: string | undefined | null): string {
  return (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** Guess the kind of export from its file name (…_teachers_…, …_rooms_…, …_groups_…). */
export function detectKind(fileName: string, html?: string): SourceKind | null {
  const n = fileName.toLowerCase();
  if (n.includes('teacher') || n.includes('enseignant')) return 'teachers';
  if (n.includes('room') || n.includes('salle')) return 'rooms';
  if (n.includes('group') || n.includes('groupe')) return 'groups';
  if (html) {
    if (/Table des mati/i.test(html)) {
      const hasGroupe = /<li><a href="#table_\d+">\s*(Ann[ée]e|Groupe)\s/i.test(html);
      if (hasGroupe) return 'groups';
    }
  }
  return null;
}

export function parseSlotLabel(raw: string): SlotLabel {
  const text = clean(raw);
  const m = text.match(/^(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})\s*(?:\((.*)\))?$/);
  if (!m) return { raw: text, base: text, overrides: {}, note: '' };
  const base = m[1].replace(/\s+/g, '');
  const overrides: Record<number, string> = {};
  let note = '';
  const inner = clean(m[2]);
  if (inner) {
    const o = inner.match(/^([A-Za-z/]+)\s*:\s*(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})$/);
    if (o) {
      for (const code of o[1].split('/')) {
        const d = DAY_CODES[code.toUpperCase()];
        if (d !== undefined) overrides[d] = o[2].replace(/\s+/g, '');
      }
    } else note = inner;
  }
  return { raw: text, base, overrides, note };
}

/** "T322 | Processus stochastiques (1/15)" → code, subject, frequency */
export function splitSubject(raw: string): { code: string; subject: string; frequency: string } {
  let text = clean(raw);
  let frequency = '';
  const f = text.match(/\((\d+\s*\/\s*\d+)\)\s*$/);
  if (f) {
    frequency = f[1].replace(/\s+/g, '');
    text = clean(text.slice(0, f.index));
  }
  const i = text.indexOf('|');
  if (i < 0) return { code: '', subject: text, frequency };
  return { code: clean(text.slice(0, i)), subject: clean(text.slice(i + 1)), frequency };
}

type Fields = { group: string; subject: string; teacher: string; room: string };

/** Position of each field inside a "<br/>"-separated simple cell, per export kind. */
function simpleCell(kind: SourceKind, owner: string, parts: string[]): Fields {
  const p = parts.map(clean);
  switch (kind) {
    case 'rooms': // group / teacher / subject
      return { group: p[0] ?? '', teacher: p[1] ?? '', subject: p[2] ?? '', room: owner };
    case 'teachers': // group / subject / room
      return { group: p[0] ?? '', subject: p[1] ?? '', room: p[2] ?? '', teacher: owner };
    case 'groups': // [group] / subject / teacher / room
      return p.length >= 4
        ? { group: p[0], subject: p[1], teacher: p[2], room: p[3] }
        : { group: owner, subject: p[0] ?? '', teacher: p[1] ?? '', room: p[2] ?? '' };
  }
}

/** Row order of a "detailed" (split) cell, per export kind. */
const DETAILED_ORDER: Record<SourceKind, (keyof Fields)[]> = {
  rooms: ['room', 'group', 'teacher', 'subject'],
  teachers: ['teacher', 'group', 'subject', 'room'],
  groups: ['group', 'subject', 'teacher', 'room'],
};

const norm = (s: string) => clean(s).toLowerCase();

export function parseHtml(html: string, kind: SourceKind): ParsedFile {
  const $ = cheerio.load(html);
  const institution = clean($('th:contains("Nom établissement")').next('td').text());
  const comment = clean($('th:contains("Commentaire")').next('td').text());
  const generatedAt = clean($('tr.foot td[colspan]').first().text()).replace(/^Planning généré avec\s*/i, '');

  const sessions: ParsedSession[] = [];
  const owners: string[] = [];
  let days: string[] = [];
  let slots: SlotLabel[] = [];
  const seen = new Set<string>();

  $('table[id^="table_"]').each((_, el) => {
    const tbl = $(el);
    const owner = clean(tbl.find('thead th[colspan]').first().text());
    owners.push(owner);
    const headDays = tbl.find('thead th.xAxis').map((_, th) => clean($(th).text())).get();
    if (headDays.length && !days.length) days = headDays;
    const slotLabels: SlotLabel[] = [];
    const carry: ({ left: number; td: any } | undefined)[] = [];

    tbl.find('tbody > tr').each((_i, tr) => {
      const row = $(tr);
      if (row.hasClass('foot')) return;
      const th = row.children('th.yAxis');
      if (!th.length) return;
      slotLabels.push(parseSlotLabel(th.text()));
      const slot = slotLabels.length - 1;

      // Resolve the real column of every <td>: a cell with rowspan="2" hides its twin in the next
      // row (<!-- span -->), so we carry it over and emit it again for the following slot(s).
      const placed: { day: number; td: any }[] = [];
      const cells = row.children('td').toArray();
      let ci = 0;
      for (let day = 0; day < Math.max(headDays.length, 6); day++) {
        const carried = carry[day];
        if (carried && carried.left > 0) {
          carried.left--;
          placed.push({ day, td: carried.td });
          continue;
        }
        const td = cells[ci++];
        if (!td) break;
        const rs = parseInt($(td).attr('rowspan') ?? '1', 10);
        if (rs > 1) carry[day] = { left: rs - 1, td };
        placed.push({ day, td });
      }

      for (const { day, td } of placed) {
        const cell = $(td);
        const detailed = cell.children('table.detailed');
        const push = (f: Fields) => {
          const sj = splitSubject(f.subject);
          const s: ParsedSession = {
            owner, day, slot,
            groups: clean(f.group), teachers: clean(f.teacher),
            subjectCode: sj.code, subject: sj.subject, room: clean(f.room), frequency: sj.frequency,
          };
          const key = [s.day, s.slot, s.groups, s.teachers, s.subjectCode, s.room, kind === 'groups' ? '' : s.owner].join('|');
          if (seen.has(key)) return;
          seen.add(key);
          sessions.push(s);
        };

        if (detailed.length) {
          const rows = detailed.find('tr').map((_, r) => [$(r).children('td').map((_, c) => clean($(c).text())).get()]).get() as unknown as string[][];
          const order = DETAILED_ORDER[kind];
          const ncols = Math.max(...rows.map((r) => r.length));
          for (let c = 0; c < ncols; c++) {
            const f: Fields = { group: '', subject: '', teacher: '', room: '' };
            order.forEach((name, i) => (f[name] = rows[i]?.[c] ?? ''));
            // A split cell lists every parallel activity of the table's students. Keep only the
            // activities that really belong to this room / teacher.
            if (kind === 'rooms' && norm(f.room) !== norm(owner)) continue;
            if (kind === 'teachers' && !f.teacher.split(',').some((t) => norm(t) === norm(owner))) continue;
            push(f);
          }
        } else {
          if (!clean(cell.text()) || clean(cell.text()) === '---') continue;
          const copy = cell.clone();
          copy.find('br').replaceWith('\n');
          const parts = copy.text().split('\n');
          parts.pop(); // every line ends with <br/>, so the last chunk is empty
          push(simpleCell(kind, owner, parts));
        }
      }
    });
    if (slotLabels.length && !slots.length) slots = slotLabels;
  });

  return { kind, institution, comment, generatedAt, days, slots, owners, sessions };
}
