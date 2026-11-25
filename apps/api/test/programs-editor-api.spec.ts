import { describe, expect, it, vi } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import {
  KnownRoom,
  Program,
  ProgramRevision,
  ProgramSessionEntity,
  ProgramSlotEntity,
  RoomAlias,
  SessionEntity,
  TeacherAlias,
  Timetable,
} from '../src/entities/timetable.entity.js';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';

vi.mock('@nestjs/typeorm', () => ({ InjectRepository: () => () => undefined }));
const { ProgramsService } = await import('../src/masters/programs.service.js');

describe('Programs Editor API (Revisions, Batch, Revert, Conflicts)', () => {
  function createTestContext() {
    const programs: Program[] = [];
    const slots: ProgramSlotEntity[] = [];
    let sessions: ProgramSessionEntity[] = [];
    const revisions: ProgramRevision[] = [];
    const fetSessions: SessionEntity[] = [];
    const roomAliases: RoomAlias[] = [
      { id: 1, aliasKey: 'salle paq', aliasName: 'Salle PAQ', canonicalName: 'PAQ/DGSE', seeded: true, createdAt: new Date() },
      { id: 2, aliasKey: 'salle dgse', aliasName: 'Salle DGSE', canonicalName: 'PAQ/DGSE', seeded: true, createdAt: new Date() },
    ];
    const teacherAliases: TeacherAlias[] = [];
    const knownRooms: KnownRoom[] = [{ id: 1, name: 'A 0-1', createdAt: new Date(), lastSeenAt: new Date() }];

    let sequence = 0;

    const programRepo = {
      findOneBy: async (criteria: Partial<Program>) =>
        programs.find((row) => Object.entries(criteria).every(([k, v]) => row[k as keyof Program] === v)) ?? null,
      findOne: async ({ where }: { where: Partial<Program> }) => {
        const row = programs.find((item) => Object.entries(where).every(([k, v]) => item[k as keyof Program] === v));
        return row
          ? {
              ...row,
              slots: slots.filter((slot) => slot.programId === row.id),
              sessions: sessions.filter((session) => session.programId === row.id),
            }
          : null;
      },
      find: async ({ where }: any = {}) => {
        if (!where) return programs;
        return programs
          .filter((p) => Object.entries(where).every(([k, v]) => p[k as keyof Program] === v))
          .map((row) => ({
            ...row,
            slots: slots.filter((slot) => slot.programId === row.id),
            sessions: sessions.filter((session) => session.programId === row.id),
          }));
      },
      create: (value: Partial<Program>) => value as Program,
      save: async (value: Program) => {
        const saved = { ...value, id: value.id ?? `prog-${++sequence}`, revision: value.revision ?? 1 } as Program;
        const idx = programs.findIndex((p) => p.id === saved.id);
        if (idx === -1) programs.push(saved);
        else programs[idx] = saved;
        return saved;
      },
      update: async (criteria: Partial<Program>, patch: Partial<Program>) => {
        for (const p of programs) {
          if (Object.entries(criteria).every(([k, v]) => p[k as keyof Program] === v)) {
            Object.assign(p, patch);
          }
        }
        return { affected: 1 };
      },
    };

    const slotRepo = {
      create: (val: Partial<ProgramSlotEntity>) => val as ProgramSlotEntity,
      save: async (vals: ProgramSlotEntity[]) => {
        slots.push(...vals);
        return vals;
      },
      delete: async () => ({ affected: 1 }),
    };

    const sessionRepo = {
      create: (val: Partial<ProgramSessionEntity>) => val as ProgramSessionEntity,
      save: async (vals: ProgramSessionEntity | ProgramSessionEntity[]) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        for (const item of arr) {
          const saved = { ...item, id: item.id ?? `sess-${++sequence}` } as ProgramSessionEntity;
          const idx = sessions.findIndex((s) => s.id === saved.id);
          if (idx === -1) sessions.push(saved);
          else sessions[idx] = saved;
        }
        return Array.isArray(vals) ? arr : arr[0];
      },
      findBy: async (criteria: Partial<ProgramSessionEntity>) =>
        sessions.filter((s) => Object.entries(criteria).every(([k, v]) => s[k as keyof ProgramSessionEntity] === v)),
      findOneBy: async (criteria: Partial<ProgramSessionEntity>) =>
        sessions.find((s) => Object.entries(criteria).every(([k, v]) => s[k as keyof ProgramSessionEntity] === v)) ?? null,
      update: async (criteria: Partial<ProgramSessionEntity>, patch: Partial<ProgramSessionEntity>) => {
        for (const s of sessions) {
          if (Object.entries(criteria).every(([k, v]) => s[k as keyof ProgramSessionEntity] === v)) {
            Object.assign(s, patch);
          }
        }
        return { affected: 1 };
      },
      delete: async (criteria: Partial<ProgramSessionEntity>) => {
        sessions = sessions.filter((s) => !Object.entries(criteria).every(([k, v]) => s[k as keyof ProgramSessionEntity] === v));
        return { affected: 1 };
      },
    };

    const revRepo = {
      create: (val: Partial<ProgramRevision>) => val as ProgramRevision,
      save: async (val: ProgramRevision) => {
        const saved = { ...val, id: ++sequence, createdAt: new Date() } as ProgramRevision;
        revisions.push(saved);
        return saved;
      },
      find: async ({ where }: any = {}) =>
        revisions.filter((r) => Object.entries(where).every(([k, v]) => r[k as keyof ProgramRevision] === v)),
      findOneBy: async (criteria: Partial<ProgramRevision>) =>
        revisions.find((r) => Object.entries(criteria).every(([k, v]) => r[k as keyof ProgramRevision] === v)) ?? null,
      query: async () => [],
    };

    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Program) return programRepo;
        if (entity === ProgramSlotEntity) return slotRepo;
        if (entity === ProgramRevision) return revRepo;
        return sessionRepo;
      },
      query: async () => [{ revision: Math.max(0, ...programs.map((row) => row.revision)) }],
    };

    const dataSource = {
      transaction: async (work: (m: typeof manager) => Promise<unknown>) => work(manager),
    };

    const service = new ProgramsService(
      programRepo as unknown as Repository<Program>,
      slotRepo as unknown as Repository<ProgramSlotEntity>,
      sessionRepo as unknown as Repository<ProgramSessionEntity>,
      revRepo as unknown as Repository<ProgramRevision>,
      { find: async () => roomAliases, findOneBy: async () => null } as unknown as Repository<RoomAlias>,
      { find: async () => teacherAliases, findOneBy: async () => null } as unknown as Repository<TeacherAlias>,
      { find: async () => fetSessions } as unknown as Repository<SessionEntity>,
      { find: async () => [] } as unknown as Repository<Timetable>,
      { find: async () => knownRooms } as unknown as Repository<KnownRoom>,
      dataSource as unknown as DataSource,
    );

    return { service, programs, sessions, revisions, fetSessions };
  }

  it('rejects batch operations when expectedRevision does not match current program revision (HTTP 409)', async () => {
    const { service, programs } = createTestContext();
    const baseAnalysis = {
      code: 'GT-M1',
      title: 'Master GT M1',
      kind: 'Mastère Recherche',
      academicYear: '2026-2027',
      semester: 'S1',
      coordinator: 'Coordinateur',
      formRef: 'PED-FR-02',
      effectiveFrom: '16/11/2026',
      footerText: 'ENISo 2026-2027',
      version: '1',
      slots: Array.from({ length: 6 }, (_, index) => ({
        index,
        label: `Slot ${index}`,
        rawLabel: `Slot ${index}`,
        base: '08:30-10:00',
        dayOverrides: {},
        note: '',
      })),
      warnings: [],
      confidence: 1,
      rawSnapshot: {},
      source: 'docx' as const,
    };

    const prog = await service.save({
      program: {
        ...baseAnalysis,
        sessions: [],
      },
      mode: 'new-version',
    });

    expect(prog.revision).toBe(1);

    // Mismatched expectedRevision = 99
    await expect(
      service.batchSessions(prog.id, {
        expectedRevision: 99,
        operations: [{ type: 'create', session: { day: 0, slot: 0, title: 'Cours Test' } }],
      }),
    ).rejects.toThrow(ConflictException);

    // Matching expectedRevision = 1 -> succeeds and increments revision to 2
    const result = await service.batchSessions(prog.id, {
      expectedRevision: 1,
      operations: [{ type: 'create', session: { day: 0, slot: 0, title: 'Cours Test' } }],
    });

    expect(result.ok).toBe(true);
    expect(result.revision).toBe(2);
  });

  it('rejects batch creating overlapping sessions inside the same program', async () => {
    const { service } = createTestContext();
    const baseAnalysis = {
      code: 'GT-M1',
      title: 'Master GT M1',
      kind: 'Mastère Recherche',
      academicYear: '2026-2027',
      semester: 'S1',
      coordinator: 'Coordinateur',
      formRef: 'PED-FR-02',
      effectiveFrom: '16/11/2026',
      footerText: 'ENISo 2026-2027',
      version: '1',
      slots: Array.from({ length: 6 }, (_, index) => ({
        index,
        label: `Slot ${index}`,
        rawLabel: `Slot ${index}`,
        base: '08:30-10:00',
        dayOverrides: {},
        note: '',
      })),
      warnings: [],
      confidence: 1,
      rawSnapshot: {},
      source: 'docx' as const,
    };

    const prog = await service.save({
      program: {
        ...baseAnalysis,
        sessions: [],
      },
      mode: 'new-version',
    });

    // Two sessions both occupying day: 0, slot: 0
    await expect(
      service.batchSessions(prog.id, {
        expectedRevision: 1,
        operations: [
          { type: 'create', session: { day: 0, slot: 0, title: 'Cours A' } },
          { type: 'create', session: { day: 0, slot: 0, title: 'Cours B' } },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('reverts program back to originalSnapshot and tracks revisions', async () => {
    const { service, programs, sessions } = createTestContext();
    const initialSession = {
      day: 1,
      slot: 1,
      slotSpan: 1,
      daySpan: 1,
      title: 'Séance Originale',
      code: 'SO',
      teachers: [],
      teacherKeys: [],
      room: null,
      roomUnassigned: false,
      locationNote: '',
      frequency: '',
      tags: [],
      customTime: null,
      color: null,
      note: '',
      rawText: 'Séance Originale',
      confidence: 1,
      reasons: [],
      source: 'docx' as const,
    };

    const prog = await service.save({
      program: {
        code: 'GT-M1',
        title: 'Master GT M1',
        kind: 'Mastère Recherche',
        academicYear: '2026-2027',
        semester: 'S1',
        coordinator: 'Coordinateur',
        formRef: 'PED-FR-02',
        effectiveFrom: '16/11/2026',
        footerText: 'ENISo 2026-2027',
        version: '1',
        slots: Array.from({ length: 6 }, (_, index) => ({ index, label: `Slot ${index}`, rawLabel: `Slot ${index}`, base: '08:30-10:00', dayOverrides: {}, note: '' })),
        sessions: [initialSession],
        warnings: [],
        confidence: 1,
        rawSnapshot: {},
        source: 'docx',
      },
      mode: 'new-version',
    });

    // Add another session via batch
    await service.batchSessions(prog.id, {
      expectedRevision: 1,
      operations: [{ type: 'create', session: { day: 2, slot: 2, title: 'Séance Ajoutée' } }],
    });

    let current = await service.get(prog.id);
    expect(current.sessions).toHaveLength(2);

    // Revert to import
    const reverted = await service.revert(prog.id);
    expect(reverted.sessions).toHaveLength(1);
    expect(reverted.sessions[0].title).toBe('Séance Originale');

    // Revisions list
    const revs = await service.listRevisions(prog.id);
    expect(revs.length).toBeGreaterThanOrEqual(3);
  });
});
