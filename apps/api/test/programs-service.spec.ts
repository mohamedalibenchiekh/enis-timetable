import { describe, expect, it } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import { KnownRoom, Program, ProgramRevision, ProgramSessionEntity, ProgramSlotEntity, RoomAlias, SessionEntity, TeacherAlias } from '../src/entities/timetable.entity.js';
import { vi } from 'vitest';
import type { ProgramAnalysis } from '../src/masters/types.js';

vi.mock('@nestjs/typeorm', () => ({ InjectRepository: () => () => undefined }));
const { ProgramsService } = await import('../src/masters/programs.service.js');

describe('ProgramsService save modes', () => {
  it('preserves session history for new versions and replaces the current revision in place', async () => {
    const programs: Program[] = [];
    const slots: ProgramSlotEntity[] = [];
    const sessions: ProgramSessionEntity[] = [];
    let sequence = 0;
    const programRepo = {
      findOneBy: async (criteria: Partial<Program>) => programs.find((row) => Object.entries(criteria).every(([key, value]) => row[key as keyof Program] === value)) ?? null,
      findOne: async ({ where }: { where: Partial<Program> }) => {
        const row = programs.find((item) => Object.entries(where).every(([key, value]) => item[key as keyof Program] === value));
        return row ? { ...row, slots: slots.filter((slot) => slot.programId === row.id), sessions: sessions.filter((session) => session.programId === row.id) } : null;
      },
      create: (value: Partial<Program>) => value as Program,
      save: async (value: Program) => {
        const saved = { ...value, id: value.id ?? `program-${++sequence}` } as Program;
        const index = programs.findIndex((row) => row.id === saved.id);
        if (index === -1) programs.push(saved); else programs[index] = saved;
        return saved;
      },
      update: async (criteria: Partial<Program>, patch: Partial<Program>) => {
        for (const row of programs) if (Object.entries(criteria).every(([key, value]) => row[key as keyof Program] === value)) Object.assign(row, patch);
        return { affected: 1 };
      },
    };
    const slotRepo = {
      create: (value: Partial<ProgramSlotEntity>) => value as ProgramSlotEntity,
      save: async (values: ProgramSlotEntity[]) => {
        const saved = values.map((value) => {
          const existing = value.id === undefined ? undefined : slots.find((slot) => slot.id === value.id);
          if (existing) { Object.assign(existing, value); return existing; }
          const created = { ...value, id: ++sequence } as ProgramSlotEntity;
          slots.push(created);
          return created;
        });
        return saved;
      },
      delete: async (criteria: Partial<ProgramSlotEntity>) => {
        for (let index = slots.length - 1; index >= 0; index--) if (Object.entries(criteria).every(([key, value]) => slots[index][key as keyof ProgramSlotEntity] === value)) slots.splice(index, 1);
        return { affected: 1 };
      },
    };
    const sessionRepo = {
      create: (value: Partial<ProgramSessionEntity>) => value as ProgramSessionEntity,
      save: async (values: ProgramSessionEntity[]) => {
        const saved = values.map((value) => ({ ...value, id: value.id ?? `session-${++sequence}` } as ProgramSessionEntity));
        sessions.push(...saved);
        return saved;
      },
      delete: async (criteria: Partial<ProgramSessionEntity>) => {
        for (let index = sessions.length - 1; index >= 0; index--) if (Object.entries(criteria).every(([key, value]) => sessions[index][key as keyof ProgramSessionEntity] === value)) sessions.splice(index, 1);
        return { affected: 1 };
      },
    };
    const revisionRepo = {
      create: (value: any) => value,
      save: async (value: any) => value,
      find: async () => [],
      findOneBy: async () => null,
      query: async () => [],
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === Program ? programRepo : entity === ProgramSlotEntity ? slotRepo : entity === ProgramRevision ? revisionRepo : sessionRepo,
      query: async () => [{ revision: Math.max(0, ...programs.map((row) => row.revision)) }],
    };
    const dataSource = { transaction: async (work: (transactionManager: typeof manager) => Promise<unknown>) => work(manager) };
    const emptyRepo = {};
    const service = new ProgramsService(
      programRepo as unknown as Repository<Program>,
      slotRepo as unknown as Repository<ProgramSlotEntity>,
      sessionRepo as unknown as Repository<ProgramSessionEntity>,
      revisionRepo as unknown as Repository<ProgramRevision>,
      emptyRepo as unknown as Repository<RoomAlias>,
      emptyRepo as unknown as Repository<TeacherAlias>,
      emptyRepo as unknown as Repository<SessionEntity>,
      emptyRepo as unknown as Repository<Timetable>,
      emptyRepo as unknown as Repository<KnownRoom>,
      dataSource as unknown as DataSource,
    );
    const analysis: ProgramAnalysis = {
      code: 'M1', title: 'Programme', kind: '', academicYear: '2026-2027', semester: '', coordinator: '', formRef: '', effectiveFrom: '', footerText: '',
      version: 'v1.10', slots: Array.from({ length: 6 }, (_, index) => ({ index, label: `Slot ${index}`, rawLabel: `Slot ${index}`, base: '08:30-10:00', dayOverrides: {}, note: '' })),
      sessions: [{ day: 0, slot: 0, slotSpan: 1, daySpan: 1, title: 'Cours', code: '', teachers: [], teacherKeys: [], room: null, roomUnassigned: false, locationNote: '', frequency: '', tags: [], customTime: null, color: null, note: '', rawText: '', confidence: 1, reasons: [], source: 'docx' }],
      warnings: [], confidence: 1, rawSnapshot: {}, source: 'docx',
    };

    const first = await service.save({ program: analysis, mode: 'new-version' });
    const firstProgram = first as Program & { sessions: ProgramSessionEntity[]; slots: ProgramSlotEntity[] };
    const firstSessionId = firstProgram.sessions[0].id;
    const firstSlotId = firstProgram.slots[0].id;
    expect(firstProgram).toMatchObject({ revision: 1, version: 'v1.10', isCurrent: true });

    const second = await service.save({ program: { ...analysis, title: 'Édition', id: first.id, sessions: firstProgram.sessions, slots: firstProgram.slots }, mode: 'new-version' });
    expect(programs.map((row) => row.isCurrent)).toEqual([false, true]);
    expect(sessions.find((session) => session.id === firstSessionId)?.programId).toBe(first.id);
    expect(sessions).toHaveLength(2);
    expect(slots.filter((slot) => slot.programId === first.id)).toHaveLength(6);
    expect(slots.find((slot) => slot.id === firstSlotId)?.programId).toBe(first.id);
    const secondProgram = second as Program & { sessions: ProgramSessionEntity[]; slots: ProgramSlotEntity[] };
    expect(secondProgram.slots[0].id).not.toBe(firstSlotId);

    const current = programs[1];
    const currentSession = sessions.find((session) => session.programId === current.id)!;
    const currentSlots = secondProgram.slots;
    const replaced = await service.save({ program: { ...analysis, title: 'Remplacé', id: current.id, sessions: [currentSession], slots: currentSlots }, mode: 'replace' });
    expect(programs).toHaveLength(2);
    expect(replaced).toMatchObject({ id: current.id, revision: 2, title: 'Remplacé', isCurrent: true });
    expect(sessions.find((session) => session.programId === first.id)?.id).toBe(firstSessionId);
    expect(sessions.filter((session) => session.programId === current.id)).toHaveLength(1);
    expect(sessions.find((session) => session.programId === current.id)?.id).not.toBe(currentSession.id);
    expect(slots.filter((slot) => slot.programId === current.id)).toHaveLength(6);
    expect(slots.find((slot) => slot.programId === current.id)?.id).not.toBe(currentSlots[0].id);
  });
});
