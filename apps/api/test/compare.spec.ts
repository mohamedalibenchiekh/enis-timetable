import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildBlocks } from '../src/compare/blocks.js';
import { matchBlocks, type BlockMatch } from '../src/compare/diff.js';
import { compareSessions } from '../src/compare/compare.js';
import { parseHtml } from '../src/parser/html-parser.js';
import { DEFAULT_OPTIONS } from '../src/export/options.js';
import { createNameResolver } from '../src/export/name-resolver.js';
import type { Block, CompareInput, SessionLike } from '../src/compare/types.js';

const META = {
  days: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
  slots: [
    { raw: '8:00-9:30', base: '8:00-9:30', overrides: {}, note: '' },
    { raw: '9:45-11:15', base: '9:45-11:15', overrides: {}, note: '' },
    { raw: '11:30-13:00', base: '11:30-13:00', overrides: {}, note: '' },
  ],
  rooms: ['A01', 'B01'],
};

const SUMMARY = { id: 'x', name: 'x', institution: '', comment: '', generatedAt: '', createdAt: '', files: [] };

function sess(partial: Partial<SessionLike> & Pick<SessionLike, 'day' | 'slot'>): SessionLike {
  return {
    room: 'A01',
    teachers: 'Prof A',
    groups: 'Grp-1',
    subjectCode: 'T1',
    subject: 'Maths',
    frequency: '',
    ...partial,
  };
}

function input(sessions: SessionLike[], id = 'x'): CompareInput {
  return { summary: { ...SUMMARY, id }, meta: META, sessions };
}

const resolver = createNameResolver(new Map(), new Map());
const compare = (a: SessionLike[], b: SessionLike[]) =>
  compareSessions(input(a, 'a'), input(b, 'b'), 'teachers', DEFAULT_OPTIONS, resolver);

/** Deterministic PRNG (mulberry32) — no dependency. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe('buildBlocks', () => {
  it('merges consecutive slots of the same session into one block', () => {
    const blocks = buildBlocks([sess({ day: 0, slot: 1 }), sess({ day: 0, slot: 2 })]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].firstSlot).toBe(1);
    expect(blocks[0].lastSlot).toBe(2);
  });

  it('does not merge non-consecutive slots or different rooms', () => {
    const blocks = buildBlocks([
      sess({ day: 0, slot: 0 }),
      sess({ day: 0, slot: 2 }),
      sess({ day: 0, slot: 1, room: 'B01' }),
    ]);
    expect(blocks).toHaveLength(3);
  });

  it('merges a rowspan session even when a parallel activity is interleaved', () => {
    // Same room+activity on slots 0-2, another activity in between must not split the block.
    const blocks = buildBlocks([
      sess({ day: 0, slot: 0 }),
      sess({ day: 0, slot: 1, teachers: 'Prof X', subjectCode: 'TX', groups: 'GX' }),
      sess({ day: 0, slot: 1 }),
      sess({ day: 0, slot: 2 }),
    ]);
    const main = blocks.filter((b) => b.activity.subjectCode === 'T1');
    expect(main).toHaveLength(1);
    expect(main[0].firstSlot).toBe(0);
    expect(main[0].lastSlot).toBe(2);
  });

  it('deduplicates identical same-slot rows (one row per teacher table)', () => {
    const blocks = buildBlocks([sess({ day: 0, slot: 0 }), sess({ day: 0, slot: 0 })]);
    expect(blocks).toHaveLength(1);
  });
});

describe('matchBlocks passes', () => {
  const types = (a: SessionLike[], b: SessionLike[]) => matchBlocks(buildBlocks(a), buildBlocks(b)).matches.map((m) => m.type);

  it('identical inputs produce no changes', () => {
    const s = [sess({ day: 0, slot: 0 }), sess({ day: 1, slot: 1, room: 'B01' })];
    expect(types(s, s)).toEqual([]);
  });

  it('detects room_changed when only the room differs', () => {
    expect(types([sess({ day: 0, slot: 0, room: 'A01' })], [sess({ day: 0, slot: 0, room: 'B01' })])).toEqual(['room_changed']);
  });

  it('detects moved when day or slots differ', () => {
    expect(types([sess({ day: 0, slot: 0 })], [sess({ day: 2, slot: 0 })])).toEqual(['moved']);
    expect(types([sess({ day: 0, slot: 0 })], [sess({ day: 0, slot: 1 })])).toEqual(['moved']);
  });

  it('detects group_changed when only the group differs', () => {
    expect(types([sess({ day: 0, slot: 0, groups: 'Grp-1' })], [sess({ day: 0, slot: 0, groups: 'Grp-2' })])).toEqual(['group_changed']);
  });

  it('does not report group_changed when the subject or frequency also changed', () => {
    expect(types([sess({ day: 0, slot: 0, groups: 'Grp-1' })], [sess({ day: 0, slot: 0, groups: 'Grp-2', subject: 'Autre' })]).sort()).toEqual(['added', 'removed']);
    expect(types([sess({ day: 0, slot: 0, groups: 'Grp-1' })], [sess({ day: 0, slot: 0, groups: 'Grp-2', frequency: '1/15' })]).sort()).toEqual(['added', 'removed']);
    expect(types([sess({ day: 0, slot: 0, groups: 'Grp-1' })], [sess({ day: 0, slot: 0, groups: 'Grp-2', room: 'B01' })]).sort()).toEqual(['added', 'removed']);
  });

  it('detects teachers_changed when only the teacher set differs', () => {
    expect(types([sess({ day: 0, slot: 0, teachers: 'Prof A' })], [sess({ day: 0, slot: 0, teachers: 'Prof B' })])).toEqual(['teachers_changed']);
  });

  it('detects added and removed', () => {
    expect(types([], [sess({ day: 0, slot: 0 })])).toEqual(['added']);
    expect(types([sess({ day: 0, slot: 0 })], [])).toEqual(['removed']);
  });

  it('treats a frequency-only change as removed + added (no dedicated type)', () => {
    expect(types([sess({ day: 0, slot: 0, frequency: '' })], [sess({ day: 0, slot: 0, frequency: '1/15' })]).sort()).toEqual(['added', 'removed']);
  });

  it('pairs surplus blocks of the same activity as added/removed', () => {
    const two = [sess({ day: 0, slot: 0 }), sess({ day: 1, slot: 0 })];
    const one = [sess({ day: 0, slot: 0 })];
    expect(types(two, one)).toEqual(['removed']);
    expect(types(one, two)).toEqual(['added']);
    // Same activity on both sides but different locations → moved, not added/removed.
    const moved = [sess({ day: 0, slot: 0 }), sess({ day: 1, slot: 0 })];
    const relocated = [sess({ day: 0, slot: 0 }), sess({ day: 3, slot: 0 })];
    expect(types(moved, relocated).sort()).toEqual(['moved']);
  });
});

describe('compare invariants', () => {
  const base = [
    sess({ day: 0, slot: 0, teachers: 'Prof A', subjectCode: 'T1' }),
    sess({ day: 0, slot: 1, teachers: 'Prof B', subjectCode: 'T2', room: 'B01' }),
    sess({ day: 1, slot: 0, teachers: 'Prof C', subjectCode: 'T3', groups: 'Grp-2' }),
    sess({ day: 2, slot: 0, teachers: 'Prof D', subjectCode: 'T4' }),
    sess({ day: 2, slot: 1, teachers: 'Prof D', subjectCode: 'T4' }),
  ];
  const target = [
    sess({ day: 0, slot: 0, teachers: 'Prof A', subjectCode: 'T1' }),
    sess({ day: 3, slot: 0, teachers: 'Prof B', subjectCode: 'T2', room: 'B01' }),
    sess({ day: 1, slot: 0, teachers: 'Prof C', subjectCode: 'T3', groups: 'Grp-9' }),
    sess({ day: 2, slot: 2, teachers: 'Prof D', subjectCode: 'T4' }),
    sess({ day: 2, slot: 3, teachers: 'Prof D', subjectCode: 'T4' }),
    sess({ day: 4, slot: 0, teachers: 'Prof E', subjectCode: 'T5' }),
  ];

  it('diff(a, a) is empty', () => {
    const r = compare(base, base);
    expect(r.changes).toEqual([]);
    expect(r.summary.total).toBe(0);
    expect(r.summary.similarity).toBe(1);
    expect(r.days).toEqual([]);
  });

  it('diff(a, b) and diff(b, a) are mirror images', () => {
    const ab = compare(base, target);
    const ba = compare(target, base);
    const mirror: Record<string, string> = { added: 'removed', removed: 'added' };
    const norm = (r: typeof ab) =>
      r.changes
        .map((c) => ({
          type: c.type,
          subject: c.activity.subjectCode,
          teachers: c.activity.teachers,
          before: c.before ? [c.before.day, c.before.firstSlot, c.before.roomKey].join('/') : null,
          after: c.after ? [c.after.day, c.after.firstSlot, c.after.roomKey].join('/') : null,
        }))
        .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    const flipped = norm(ba)
      .map((c) => ({ ...c, type: mirror[c.type] ?? c.type, before: c.after, after: c.before }))
      .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    expect(norm(ab)).toEqual(flipped);
  });

  it('no block is counted twice', () => {
    const r = compare(base, target);
    const involved = r.changes.flatMap((c) =>
      [c.before, c.after].filter(Boolean).map((s) => `${s!.day}/${s!.firstSlot}/${s!.roomKey}/${s!.activity.subjectCode}/${s!.activity.groups}/${s!.activity.teachers}`),
    );
    expect(new Set(involved).size).toBe(involved.length);
  });

  it('shuffling input order never changes the output', () => {
    const rand = rng(42);
    const shuffled = (arr: SessionLike[]) => [...arr].sort(() => rand() - 0.5);
    const a = compare(base, target);
    const b = compare(shuffled(base), shuffled(target));
    expect(b.changes).toEqual(a.changes);
    expect(b.summary).toEqual(a.summary);
    expect(b.days).toEqual(a.days);
  });

  it('matches names with accents and spacing differences', () => {
    const a = [sess({ day: 0, slot: 0, teachers: 'Prof  Élodie  ', groups: '  Grp-1 ' })];
    const b = [sess({ day: 0, slot: 0, teachers: 'prof elodie', groups: 'Grp-1' })];
    expect(compare(a, b).changes).toEqual([]);
  });

  it('warns when more than 50% of blocks changed', () => {
    const a = [sess({ day: 0, slot: 0 }), sess({ day: 0, slot: 1 }), sess({ day: 1, slot: 0 })];
    const b = [sess({ day: 0, slot: 0 }), sess({ day: 3, slot: 0 }), sess({ day: 4, slot: 0 })];
    const r = compare(a, b);
    expect(r.summary.warning).toBe('Ces deux emplois du temps semblent très différents');
  });

  it('keeps comparison keys injective when names contain the separator', () => {
    // "A|B" as one teacher must not collide with teachers "A" and "B".
    const a = [sess({ day: 0, slot: 0, teachers: 'Prof|X' })];
    const b = [sess({ day: 0, slot: 0, teachers: 'Prof, X' })];
    expect(compare(a, b).changes.length).toBeGreaterThan(0);
  });

  it('matches 2000 sessions in under 200 ms (O(n log n) guard)', () => {
    const rand = rng(7);
    const gen = (): SessionLike[] =>
      Array.from({ length: 2000 }, (_, i) =>
        sess({
          day: Math.floor(rand() * 6),
          slot: Math.floor(rand() * META.slots.length),
          room: rand() > 0.5 ? 'A01' : 'B01',
          teachers: `Prof ${i % 50}`,
          groups: `Grp-${i % 20}`,
          subjectCode: `T${i % 30}`,
          subject: `Sujet ${i % 30}`,
          frequency: rand() > 0.9 ? '1/15' : '',
        }),
      );
    const a = gen();
    const b = gen().map((s, i) => (i % 10 === 0 ? { ...s, day: (s.day + 1) % 6 } : s));
    // Best of 3 runs: parallel test files can starve the CPU, so the minimum is the stable signal.
    let elapsed = Infinity;
    let matches: BlockMatch[] = [];
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      matches = matchBlocks(buildBlocks(a), buildBlocks(b)).matches;
      elapsed = Math.min(elapsed, performance.now() - t0);
    }
    expect(elapsed).toBeLessThan(200);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('compares 2000 sessions end-to-end without errors', () => {
    const rand = rng(7);
    const gen = (): SessionLike[] =>
      Array.from({ length: 2000 }, (_, i) =>
        sess({
          day: Math.floor(rand() * 6),
          slot: Math.floor(rand() * META.slots.length),
          room: rand() > 0.5 ? 'A01' : 'B01',
          teachers: `Prof ${i % 50}`,
          groups: `Grp-${i % 20}`,
          subjectCode: `T${i % 30}`,
          subject: `Sujet ${i % 30}`,
          frequency: rand() > 0.9 ? '1/15' : '',
        }),
      );
    const a = gen();
    const b = gen().map((s, i) => (i % 10 === 0 ? { ...s, day: (s.day + 1) % 6 } : s));
    const r = compare(a, b);
    expect(r.summary.total).toBeGreaterThan(0);
    expect(r.changes.length).toBe(r.summary.total);
  });
});

describe('day impact highlight coordinates', () => {
  it('uses the target slot header for removed cells', () => {
    const baseMeta = {
      ...META,
      slots: [
        { raw: '8:00-9:30', base: '8:00-9:30', overrides: {}, note: '' },
        { raw: '9:45-11:15', base: '9:45-11:15', overrides: {}, note: '' },
      ],
    };
    const targetMeta = {
      ...META,
      slots: [
        { raw: '8:00-10:00', base: '8:00-10:00', overrides: {}, note: '' },
        { raw: '10:15-11:45', base: '10:15-11:45', overrides: {}, note: '' },
      ],
    };
    const baseInput: CompareInput = {
      summary: { ...SUMMARY, id: 'a' },
      meta: baseMeta,
      sessions: [sess({ day: 0, slot: 0, room: 'A01' })],
    };
    const targetInput: CompareInput = {
      summary: { ...SUMMARY, id: 'b' },
      meta: targetMeta,
      sessions: [sess({ day: 0, slot: 1, room: 'B01', subjectCode: 'T9' })],
    };
    const result = compareSessions(baseInput, targetInput, 'teachers', DEFAULT_OPTIONS, resolver);
    const removed = result.days[0].cells.find((c) => c.roomKey && c.after === '');
    expect(removed).toBeDefined();
    // The preview renders the target timetable: the highlight key must use its header.
    expect(removed!.slotHeader).toBe('8:00-10:00');
  });
});

describe('golden fixtures v1 → v2', () => {
  const fixtures = path.join(__dirname, 'fixtures');
  const load = (dir: string, kind: 'teachers' | 'rooms' | 'groups') => {
    const file = fs.readdirSync(dir).find((f) => f.toLowerCase().includes(kind === 'teachers' ? 'teacher' : kind === 'rooms' ? 'room' : 'group'))!;
    return parseHtml(fs.readFileSync(path.join(dir, file), 'utf8'), kind);
  };
  const toInput = (p: ReturnType<typeof parseHtml>, id: string): CompareInput => ({
    summary: { ...SUMMARY, id, name: id, institution: p.institution, comment: p.comment, generatedAt: p.generatedAt },
    meta: { days: p.days, slots: p.slots, rooms: p.owners },
    sessions: p.sessions,
  });

  it('matches the committed golden JSON (teachers view)', () => {
    const golden = JSON.parse(fs.readFileSync(path.join(fixtures, 'v2-compare.golden.json'), 'utf8'));
    const base = load(fixtures, 'teachers');
    const target = load(path.join(fixtures, 'v2'), 'teachers');
    const result = compareSessions(toInput(base, 'v1'), toInput(target, 'v2'), 'teachers', DEFAULT_OPTIONS, resolver);
    expect(result).toEqual(golden);
  });

  it('rooms view detects the group rename (Grp-Z1 → Grp-Z1b)', () => {
    const base = load(fixtures, 'rooms');
    const target = load(path.join(fixtures, 'v2'), 'rooms');
    const result = compareSessions(toInput(base, 'v1'), toInput(target, 'v2'), 'rooms', DEFAULT_OPTIONS, resolver);
    const groupChanged = result.changes.filter((c) => c.type === 'group_changed');
    expect(groupChanged).toHaveLength(1);
    expect(groupChanged[0].activity.groups).toBe('Grp-Z1b');
    expect(groupChanged[0].activity.subjectCode).toBe('T700');
  });

  it('groups view detects the frequency toggle as removed + added', () => {
    const base = load(fixtures, 'groups');
    const target = load(path.join(fixtures, 'v2'), 'groups');
    const result = compareSessions(toInput(base, 'v1'), toInput(target, 'v2'), 'groups', DEFAULT_OPTIONS, resolver);
    const freq = result.changes.filter((c) => c.activity.subjectCode === 'T700');
    expect(freq.map((c) => c.type).sort()).toEqual(['added', 'removed']);
    expect(freq.find((c) => c.type === 'added')?.activity.frequency).toBe('1/15');
  });
});
