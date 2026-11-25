import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
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
} from '../entities/timetable.entity.js';
import { parseMastersDocx } from './docx-importer.js';
import { parseMastersPdf } from './pdf-importer.js';
import { ProgramAnalysis, ProgramSession } from './types.js';
import { normalizeName } from '../names/name-normalization.js';
import { BackupsService } from '../backups/backups.service.js';
import { SEEDED_ROOM_ALIASES } from './seeded-aliases.js';
import {
  areSessionsOverlapping,
  buildOccupancyState,
  canonicalTeacherKey,
  detectConflicts,
  findBestRoom,
  findFreeRooms,
  findFreeSlots,
  OccupancyState,
  parseCustomTime,
  resolveCanonicalRoom,
} from '../occupancy/index.js';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_REVISIONS_KEPT = 50;

@Injectable()
export class ProgramsService implements OnModuleInit {
  constructor(
    @InjectRepository(Program) private readonly programs: Repository<Program>,
    @InjectRepository(ProgramSlotEntity) private readonly slots: Repository<ProgramSlotEntity>,
    @InjectRepository(ProgramSessionEntity) private readonly sessions: Repository<ProgramSessionEntity>,
    @InjectRepository(ProgramRevision) private readonly programRevisions: Repository<ProgramRevision>,
    @InjectRepository(RoomAlias) private readonly roomAliases: Repository<RoomAlias>,
    @InjectRepository(TeacherAlias) private readonly teacherAliases: Repository<TeacherAlias>,
    @InjectRepository(SessionEntity) private readonly fetSessions: Repository<SessionEntity>,
    @InjectRepository(Timetable) private readonly timetables: Repository<Timetable>,
    @InjectRepository(KnownRoom) private readonly knownRooms: Repository<KnownRoom>,
    private readonly dataSource: DataSource,
    @Optional() private readonly backups?: BackupsService,
  ) {}

  async onModuleInit() {
    for (const alias of SEEDED_ROOM_ALIASES) {
      const existing = await this.roomAliases.findOneBy({ aliasKey: alias.aliasKey });
      if (!existing) await this.roomAliases.save(this.roomAliases.create({ ...alias, seeded: true }));
    }
  }

  async analyze(
    files: { originalname: string; buffer: Buffer; size: number }[],
    referenceSlots?: string[],
    referenceTimetableId?: string,
    referenceOverrides?: Record<number, Record<number, string>>,
  ): Promise<ProgramAnalysis[]> {
    if (!files?.length) throw new BadRequestException('Sélectionnez au moins un fichier Word ou PDF.');
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_FILE_BYTES) throw new BadRequestException('La taille totale des fichiers dépasse la limite de 20 Mo.');
    if (referenceTimetableId && !/^[0-9a-f-]{36}$/iu.test(referenceTimetableId)) throw new BadRequestException('Emploi FET de référence invalide.');

    const [rooms, teachers, knownRooms, fetSessions] = await Promise.all([
      this.roomAliases.find(),
      this.teacherAliases.find(),
      this.knownRooms.find(),
      this.fetSessions.find(),
    ]);

    const roomAliases = Object.fromEntries(rooms.map((row) => [row.aliasKey, row.canonicalName]));
    const teacherAliasMap = Object.fromEntries(teachers.map((row) => [row.aliasKey, row.canonicalName]));
    const catalogs = {
      rooms: [...new Set([...knownRooms.map((row) => row.name), ...fetSessions.map((row) => row.room).filter(Boolean)])],
      teachers: [...new Set(fetSessions.flatMap((row) => row.teachers.split(',').map((teacher) => teacher.trim()).filter(Boolean)))],
      roomAliases,
      teacherAliases: teacherAliasMap,
    };

    const analyses = await Promise.all(
      files.map(async (file) => {
        if (file.size > MAX_FILE_BYTES) throw new BadRequestException(`Le fichier dépasse la limite de 20 Mo : ${file.originalname}`);
        const ext = file.originalname.toLowerCase().split('.').pop();
        if (ext === 'docx') return parseMastersDocx(file.buffer, file.originalname, referenceSlots, catalogs, referenceOverrides);
        if (ext === 'pdf') return parseMastersPdf(file.buffer, file.originalname, referenceSlots, catalogs, referenceOverrides);
        throw new BadRequestException(`Format non pris en charge : ${file.originalname} (DOCX ou PDF attendu).`);
      }),
    );

    const referenceSessions = referenceTimetableId ? fetSessions.filter((session) => session.timetableId === referenceTimetableId) : [];

    return analyses.map((analysis) => {
      let conflictWarnings: string[] = [];
      if (referenceTimetableId && referenceSessions.length) {
        const state = buildOccupancyState(
          referenceSessions.map((session) => ({
            id: session.id,
            day: session.day,
            slot: session.slot,
            room: session.room,
            teachers: session.teachers.split(',').map((t) => t.trim()).filter(Boolean),
            subject: session.subject,
          })),
          analysis.sessions.map((s, idx) => ({ ...s, id: `analysis-${idx}`, programCode: analysis.code })),
          { catalogs },
        );
        const found = detectConflicts(state, { targetProgramCode: analysis.code });
        conflictWarnings = found.map((item) => item.message);
      }

      return {
        ...analysis,
        warnings: [...new Set([...analysis.warnings, ...conflictWarnings])],
        rawSnapshot: { ...analysis.rawSnapshot, referenceSlots: referenceSlots ?? undefined },
      };
    });
  }

  async save(body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Données de programme invalides.');
    const input = body as Record<string, unknown>;
    const analysis = input.program as ProgramAnalysis;
    if (!analysis || typeof analysis !== 'object' || typeof analysis.code !== 'string' || !analysis.code.trim() || typeof analysis.title !== 'string' || !analysis.title.trim()) {
      throw new BadRequestException('Le code et le titre du programme sont obligatoires.');
    }
    if (analysis.academicYear !== '2026-2027') throw new BadRequestException('L’année universitaire doit être 2026-2027.');
    if (!Array.isArray(analysis.slots) || analysis.slots.length !== 6 || !Array.isArray(analysis.sessions) || analysis.sessions.length > 5_000) throw new BadRequestException('Créneaux ou séances invalides.');
    for (const [index, slot] of analysis.slots.entries()) {
      if (!slot || slot.index !== index || typeof slot.label !== 'string' || !slot.label.trim() || slot.label.length > 80 || typeof slot.rawLabel !== 'string' || slot.rawLabel.length > 500 || typeof slot.base !== 'string' || !slot.dayOverrides || typeof slot.dayOverrides !== 'object' || Array.isArray(slot.dayOverrides) || Object.entries(slot.dayOverrides).some(([day, label]) => !/^[0-5]$/u.test(day) || typeof label !== 'string' || label.length > 80)) throw new BadRequestException(`Créneau ${index + 1} invalide.`);
    }
    for (const [field, max] of Object.entries({ code: 80, title: 255, kind: 80, semester: 40, coordinator: 255, formRef: 80, effectiveFrom: 100, footerText: 2_000, version: 40 })) {
      if (typeof analysis[field as keyof ProgramAnalysis] !== 'string' || (analysis[field as keyof ProgramAnalysis] as string).length > max) throw new BadRequestException(`Champ programme invalide : ${field}.`);
    }
    if (!['docx', 'pdf'].includes(analysis.source) || !Array.isArray(analysis.warnings) || analysis.warnings.length > 500 || analysis.warnings.some((warning) => typeof warning !== 'string' || warning.length > 1_000) || !Number.isFinite(analysis.confidence) || analysis.confidence < 0 || analysis.confidence > 1 || !analysis.rawSnapshot || typeof analysis.rawSnapshot !== 'object' || Array.isArray(analysis.rawSnapshot)) throw new BadRequestException('Rapport d’analyse invalide.');
    for (const [index, session] of analysis.sessions.entries()) this.validateSession(session, index);

    const mode = input.mode === 'replace' ? 'replace' : input.mode === 'new-version' ? 'new-version' : null;
    if (!mode) throw new BadRequestException('Choisissez « replace » ou « new-version ».');
    const code = analysis.code.trim().toUpperCase();

    const savedId = await this.dataSource.transaction(async (manager) => {
      const programs = manager.getRepository(Program);
      const slots = manager.getRepository(ProgramSlotEntity);
      const sessions = manager.getRepository(ProgramSessionEntity);
      const revisions = manager.getRepository(ProgramRevision);

      const current = await programs.findOneBy({ code, isCurrent: true });
      const replacingCurrent = mode === 'replace' ? current : null;
      if (!replacingCurrent && current) await programs.update({ id: current.id }, { isCurrent: false });
      const [row] = await manager.query('SELECT COALESCE(MAX(revision), 0) AS revision FROM programs WHERE code = $1', [code]);
      const revision = replacingCurrent ? replacingCurrent.revision : Number(row.revision ?? 0) + 1;

      const program = await programs.save(programs.create({
        ...(replacingCurrent ? { id: replacingCurrent.id } : {}),
        code, title: analysis.title.trim(), kind: analysis.kind ?? '', academicYear: '2026-2027', semester: analysis.semester ?? '',
        coordinator: analysis.coordinator ?? '', formRef: analysis.formRef ?? '', effectiveFrom: analysis.effectiveFrom ?? '', footerText: analysis.footerText ?? '',
        version: analysis.version, revision, isCurrent: true,
        originalSnapshot: {
          ...(analysis.rawSnapshot ?? {}),
          saveMode: mode,
          source: analysis.source,
          confidence: analysis.confidence,
          warnings: analysis.warnings,
          sessions: analysis.sessions,
          slots: analysis.slots,
        },
      }));

      if (replacingCurrent) {
        await slots.delete({ programId: program.id });
        await sessions.delete({ programId: program.id });
        if (typeof revisions.delete === 'function') {
          await revisions.delete({ programId: program.id, revision });
        }
      }

      await slots.save(analysis.slots.map((slot) => {
        const slotData = { ...slot };
        delete slotData.id;
        return slots.create({ ...slotData, programId: program.id });
      }));

      let savedSessions: ProgramSessionEntity[] = [];
      if (analysis.sessions.length) {
        savedSessions = await sessions.save(analysis.sessions.map((session) => {
          const newSession = { ...session, programId: program.id, room: session.roomUnassigned ? null : session.room };
          delete newSession.id;
          return sessions.create(newSession);
        }));
      }

      // Record initial revision snapshot
      await revisions.save(revisions.create({
        programId: program.id,
        revision,
        description: replacingCurrent ? `Remplacement révision ${revision}` : (revision === 1 ? 'Import initial' : `Nouvelle version (révision ${revision})`),
        snapshot: { sessions: savedSessions, slots: analysis.slots },
      }));

      return program.id;
    });

    this.backups?.scheduler?.notifyDataChanged();
    return this.get(savedId);
  }

  async list() {
    const programs = await this.programs.find({ where: { isCurrent: true }, relations: { slots: true, sessions: true }, order: { code: 'ASC' } });
    return programs.map((program) => this.toApiProgram(program));
  }

  async get(id: string) {
    const program = await this.programs.findOne({ where: { id }, relations: { slots: true, sessions: true } });
    if (!program) throw new NotFoundException('Programme introuvable.');
    return this.toApiProgram(program);
  }

  async remove(id: string) {
    const program = await this.programs.findOneBy({ id });
    if (!program) throw new NotFoundException('Programme introuvable.');
    await this.programs.delete({ id });
    if (program.isCurrent) {
      const previous = await this.programs.findOne({ where: { code: program.code }, order: { revision: 'DESC' } });
      if (previous) await this.programs.update({ id: previous.id }, { isCurrent: true });
    }
    this.backups?.scheduler?.notifyDataChanged();
    return { ok: true };
  }

  async listAliases() {
    const [rooms, teachers] = await Promise.all([this.roomAliases.find({ order: { aliasName: 'ASC' } }), this.teacherAliases.find({ order: { aliasName: 'ASC' } })]);
    return { rooms, teachers };
  }

  async saveAlias(body: unknown) {
    if (!body || typeof body !== 'object') throw new BadRequestException('Alias invalide.');
    const item = body as Record<string, unknown>;
    if (item.kind === 'room' && typeof item.aliasName === 'string' && typeof item.canonicalName === 'string') {
      const aliasName = item.aliasName.trim(); const canonicalName = item.canonicalName.trim();
      this.validateAliasNames(aliasName, canonicalName);
      const aliasKey = normalizeName(aliasName);
      const existing = await this.roomAliases.findOneBy({ aliasKey });
      const saved = await this.roomAliases.save(this.roomAliases.create({ ...existing, aliasName, aliasKey, canonicalName, seeded: existing?.seeded ?? false }));
      this.backups?.scheduler?.notifyDataChanged();
      return saved;
    }
    if (item.kind === 'teacher' && typeof item.aliasName === 'string' && typeof item.canonicalName === 'string') {
      const aliasName = item.aliasName.trim(); const canonicalName = item.canonicalName.trim();
      this.validateAliasNames(aliasName, canonicalName);
      const aliasKey = normalizeName(aliasName);
      const existing = await this.teacherAliases.findOneBy({ aliasKey });
      const saved = await this.teacherAliases.save(this.teacherAliases.create({ ...existing, aliasName, aliasKey, canonicalKey: normalizeName(canonicalName), canonicalName, seeded: existing?.seeded ?? false }));
      this.backups?.scheduler?.notifyDataChanged();
      return saved;
    }
    throw new BadRequestException('Alias invalide.');
  }

  async deleteAlias(kind: string, id: number) {
    const repo = kind === 'room' ? this.roomAliases : kind === 'teacher' ? this.teacherAliases : null;
    if (!repo) throw new BadRequestException('Type d’alias invalide.');
    const row = await repo.findOneBy({ id } as never);
    if (!row) throw new NotFoundException('Alias introuvable.');
    if (row.seeded) throw new BadRequestException('Les alias fournis avec l’application ne peuvent pas être supprimés.');
    await repo.delete({ id } as never);
    this.backups?.scheduler?.notifyDataChanged();
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Occupancy & Conflict Engine Integration
  // ---------------------------------------------------------------------------

  async buildFullOccupancyState(against?: string): Promise<OccupancyState> {
    const [allPrograms, rooms, teachers, knownRooms, allFetSessions] = await Promise.all([
      this.programs.find({ where: { isCurrent: true }, relations: { sessions: true } }),
      this.roomAliases.find(),
      this.teacherAliases.find(),
      this.knownRooms.find(),
      this.fetSessions.find(),
    ]);

    const roomAliases = Object.fromEntries(rooms.map((row) => [row.aliasKey, row.canonicalName]));
    const teacherAliases = Object.fromEntries(teachers.map((row) => [row.aliasKey, row.canonicalName]));

    // Determine target FET timetable
    let targetTimetableId: string | null = null;
    if (against && against !== 'latest' && /^[0-9a-f-]{36}$/iu.test(against)) {
      targetTimetableId = against;
    } else {
      const [latest] = await this.timetables.find({ order: { createdAt: 'DESC' }, take: 1 });
      targetTimetableId = latest?.id ?? null;
    }

    const filteredFet = targetTimetableId
      ? allFetSessions.filter((s) => s.timetableId === targetTimetableId)
      : allFetSessions;

    const programSessionsList = allPrograms.flatMap((p) =>
      (p.sessions ?? []).map((s) => ({
        ...s,
        programId: p.id,
        programCode: p.code,
      })),
    );

    return buildOccupancyState(
      filteredFet.map((s) => ({
        id: s.id,
        day: s.day,
        slot: s.slot,
        room: s.room,
        teachers: s.teachers.split(',').map((t) => t.trim()).filter(Boolean),
        subject: s.subject,
        groups: s.groups,
      })),
      programSessionsList,
      {
        catalogs: {
          rooms: [...new Set([...knownRooms.map((r) => r.name), ...allFetSessions.map((r) => r.room).filter(Boolean)])],
          teachers: [...new Set(allFetSessions.flatMap((r) => r.teachers.split(',').map((t) => t.trim()).filter(Boolean)))],
          roomAliases,
          teacherAliases,
        },
      },
    );
  }

  async getConflicts(programId?: string, against?: string) {
    const state = await this.buildFullOccupancyState(against);
    const conflicts = detectConflicts(state, programId ? { targetProgramId: programId } : {});
    if (!programId) return conflicts;
    return conflicts.filter((c) => c.sessions.some((s) => s.programId === programId));
  }

  async getFreeRooms(
    day: number,
    slot: number,
    against?: string,
    options: { slotSpan?: number; daySpan?: number; customTime?: string | null; targetBloc?: string } = {},
  ) {
    if (!Number.isInteger(day) || day < 0 || day > 5 || !Number.isInteger(slot) || slot < 0 || slot > 5) {
      throw new BadRequestException('Jour ou créneau invalide.');
    }
    const state = await this.buildFullOccupancyState(against);
    return findFreeRooms(day, slot, state, options);
  }

  async getSessionSuggestions(programId: string, sessionId: string, against?: string) {
    const state = await this.buildFullOccupancyState(against);
    const session = (state.programSessions ?? state.sessions).find(
      (s) => String(s.id) === String(sessionId) && s.programId === programId,
    );
    if (!session) throw new NotFoundException('Séance introuvable.');

    const freeRooms = findFreeRooms(session.day, session.slot, state, {
      slotSpan: session.slotSpan,
      daySpan: session.daySpan,
      customTime: session.customTime,
      excludeSessionId: session.id,
    });
    const freeSlots = findFreeSlots(session, state);
    const bestRoom = findBestRoom(session, state);

    return {
      freeRooms,
      freeSlots,
      bestRoom,
    };
  }

  // ---------------------------------------------------------------------------
  // Session CRUD & Batch Mutations (Revision-safe)
  // ---------------------------------------------------------------------------

  async createSession(programId: string, body: unknown) {
    if (!body || typeof body !== 'object') throw new BadRequestException('Séance invalide.');
    const input = body as Record<string, unknown>;
    const expectedRevision = typeof input.expectedRevision === 'number' ? input.expectedRevision : undefined;

    const rawSession = (input.session && typeof input.session === 'object' ? input.session : input) as Record<string, unknown>;
    const sessionData = this.prepareSessionInput(rawSession);
    this.validateSession(sessionData, 0);

    const saved = await this.dataSource.transaction(async (manager) => {
      const progRepo = manager.getRepository(Program);
      const slotRepo = manager.getRepository(ProgramSlotEntity);
      const sessionRepo = manager.getRepository(ProgramSessionEntity);
      const revRepo = manager.getRepository(ProgramRevision);

      // Pessimistic lock on the program
      const program = await progRepo.findOne({
        where: { id: programId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!program) throw new NotFoundException('Programme introuvable.');

      const [programSlots, programSessions] = await Promise.all([
        slotRepo.findBy({ programId }),
        sessionRepo.findBy({ programId }),
      ]);
      program.slots = programSlots;
      program.sessions = programSessions;

      if (expectedRevision !== undefined && program.revision !== expectedRevision) {
        throw new ConflictException(
          `Le programme a été modifié (révision attendue : ${expectedRevision}, actuelle : ${program.revision}). Veuillez actualiser.`,
        );
      }

      // Check no cell overlap within the program
      this.checkNoOverlapInsideProgram([...(program.sessions ?? []), sessionData]);

      const newRevision = program.revision + 1;
      const entity = sessionRepo.create({
        ...sessionData,
        id: randomUUID(),
        programId: program.id,
      });
      const created = await sessionRepo.save(entity);

      await progRepo.update({ id: program.id }, { revision: newRevision, updatedAt: new Date() });

      const allSessions = [...(program.sessions ?? []), created];
      await this.recordRevisionSnapshot(revRepo, program.id, newRevision, `Ajout séance : ${created.title}`, allSessions, program.slots);

      return { created, newRevision };
    });

    this.backups?.scheduler?.notifyDataChanged();
    return { ok: true, revision: saved.newRevision, session: saved.created };
  }

  async updateSession(programId: string, sessionId: string, body: unknown) {
    if (!body || typeof body !== 'object') throw new BadRequestException('Séance invalide.');
    const input = body as Record<string, unknown>;
    const expectedRevision = typeof input.expectedRevision === 'number' ? input.expectedRevision : undefined;

    const rawSession = (input.session && typeof input.session === 'object' ? input.session : input) as Record<string, unknown>;
    const session = await this.sessions.findOneBy({ id: sessionId, programId });
    if (!session) throw new NotFoundException('Séance introuvable.');

    const sessionData = this.prepareSessionInput(rawSession, session);
    this.validateSession(sessionData, 0);

    const updated = await this.dataSource.transaction(async (manager) => {
      const progRepo = manager.getRepository(Program);
      const slotRepo = manager.getRepository(ProgramSlotEntity);
      const sessionRepo = manager.getRepository(ProgramSessionEntity);
      const revRepo = manager.getRepository(ProgramRevision);

      const program = await progRepo.findOne({
        where: { id: programId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!program) throw new NotFoundException('Programme introuvable.');

      const [programSlots, programSessions] = await Promise.all([
        slotRepo.findBy({ programId }),
        sessionRepo.findBy({ programId }),
      ]);
      program.slots = programSlots;
      program.sessions = programSessions;

      if (expectedRevision !== undefined && program.revision !== expectedRevision) {
        throw new ConflictException(
          `Le programme a été modifié (révision attendue : ${expectedRevision}, actuelle : ${program.revision}). Veuillez actualiser.`,
        );
      }

      const otherSessions = (program.sessions ?? []).filter((s) => s.id !== sessionId);
      this.checkNoOverlapInsideProgram([...otherSessions, sessionData]);

      const newRevision = program.revision + 1;
      await sessionRepo.update({ id: sessionId }, sessionData);
      const refreshed = await sessionRepo.findOneBy({ id: sessionId });

      await progRepo.update({ id: program.id }, { revision: newRevision, updatedAt: new Date() });

      const allSessions = [...otherSessions, refreshed!];
      await this.recordRevisionSnapshot(revRepo, program.id, newRevision, `Modification séance : ${refreshed!.title}`, allSessions, program.slots);

      return { refreshed: refreshed!, newRevision };
    });

    this.backups?.scheduler?.notifyDataChanged();
    return { ok: true, revision: updated.newRevision, session: updated.refreshed };
  }

  async deleteSession(programId: string, sessionId: string, expectedRevision?: number) {
    const session = await this.sessions.findOneBy({ id: sessionId, programId });
    if (!session) throw new NotFoundException('Séance introuvable.');

    const res = await this.dataSource.transaction(async (manager) => {
      const progRepo = manager.getRepository(Program);
      const slotRepo = manager.getRepository(ProgramSlotEntity);
      const sessionRepo = manager.getRepository(ProgramSessionEntity);
      const revRepo = manager.getRepository(ProgramRevision);

      const program = await progRepo.findOne({
        where: { id: programId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!program) throw new NotFoundException('Programme introuvable.');

      const [programSlots, programSessions] = await Promise.all([
        slotRepo.findBy({ programId }),
        sessionRepo.findBy({ programId }),
      ]);
      program.slots = programSlots;
      program.sessions = programSessions;

      if (expectedRevision !== undefined && program.revision !== expectedRevision) {
        throw new ConflictException(
          `Le programme a été modifié (révision attendue : ${expectedRevision}, actuelle : ${program.revision}). Veuillez actualiser.`,
        );
      }

      const newRevision = program.revision + 1;
      await sessionRepo.delete({ id: sessionId });
      await progRepo.update({ id: program.id }, { revision: newRevision, updatedAt: new Date() });

      const remainingSessions = (program.sessions ?? []).filter((s) => s.id !== sessionId);
      await this.recordRevisionSnapshot(revRepo, program.id, newRevision, `Suppression séance : ${session.title}`, remainingSessions, program.slots);

      return { newRevision };
    });

    this.backups?.scheduler?.notifyDataChanged();
    return { ok: true, revision: res.newRevision };
  }

  async batchSessions(programId: string, body: unknown) {
    if (!body || typeof body !== 'object') throw new BadRequestException('Corps de requête invalide.');

    const input = body as {
      expectedRevision?: number;
      description?: string;
      operations?: Array<Record<string, unknown>>;
      ops?: Array<Record<string, unknown>>;
    };
    if (typeof input.expectedRevision !== 'number') {
      throw new BadRequestException('La révision attendue (expectedRevision) est obligatoire.');
    }

    const rawOps = Array.isArray(input.operations) ? input.operations : Array.isArray(input.ops) ? input.ops : [];
    // Normalize ops if using web client's format (op -> type, sessionId -> id, etc.)
    const operations: any[] = rawOps.map((op: any) => {
      const type = (op.type ?? op.op) as string;
      const id = (op.id ?? op.sessionId ?? (op.session as Record<string, unknown>)?.id) as string;
      const day = (op.day ?? op.targetDay) as number;
      const slot = (op.slot ?? op.targetSlot) as number;
      return {
        ...op,
        type,
        id,
        day,
        slot,
      };
    });

    const result = await this.dataSource.transaction(async (manager) => {
      const progRepo = manager.getRepository(Program);
      const slotRepo = manager.getRepository(ProgramSlotEntity);
      const sessionRepo = manager.getRepository(ProgramSessionEntity);
      const revRepo = manager.getRepository(ProgramRevision);

      // Pessimistic write lock on program to prevent concurrent race condition
      const program = await progRepo.findOne({
        where: { id: programId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!program) throw new NotFoundException('Programme introuvable.');
      program.slots = await slotRepo.findBy({ programId });

      if (program.revision !== input.expectedRevision) {
        throw new ConflictException(
          `Le programme a été modifié (révision attendue : ${input.expectedRevision}, actuelle : ${program.revision}). Veuillez actualiser.`,
        );
      }

      if (!operations.length) {
        const cur = await sessionRepo.findBy({ programId });
        return { revision: program.revision, sessions: cur };
      }

      const newRevision = program.revision + 1;
      let currentSessions = await sessionRepo.findBy({ programId });

      for (const op of operations) {
        const type = op.type as string;
        if (type === 'create') {
          const sData = this.prepareSessionInput(op.session as Record<string, unknown>);
          this.validateSession(sData, 0);
          const entity = sessionRepo.create({ ...sData, id: randomUUID(), programId });
          const saved = await sessionRepo.save(entity);
          currentSessions.push(saved);
        } else if (type === 'update') {
          const id = op.id as string;
          const target = currentSessions.find((s) => s.id === id);
          if (!target) throw new NotFoundException(`Séance à modifier introuvable : ${id}`);
          const sData = this.prepareSessionInput(op.session as Record<string, unknown>, target);
          this.validateSession(sData, 0);
          await sessionRepo.update({ id }, sData);
          currentSessions = currentSessions.map((s) => (s.id === id ? { ...s, ...sData } : s));
        } else if (type === 'move') {
          const id = op.id as string;
          const day = op.day as number;
          const slot = op.slot as number;
          const target = currentSessions.find((s) => s.id === id);
          if (!target) throw new NotFoundException(`Séance à déplacer introuvable : ${id}`);
          if (!Number.isInteger(day) || day < 0 || day > 5 || !Number.isInteger(slot) || slot < 0 || slot > 5) {
            throw new BadRequestException('Jour ou créneau de déplacement invalide.');
          }
          if (slot + target.slotSpan > 6 || day + target.daySpan > 6) {
            throw new BadRequestException('La séance dépasse les limites de la grille.');
          }
          await sessionRepo.update({ id }, { day, slot });
          currentSessions = currentSessions.map((s) => (s.id === id ? { ...s, day, slot } : s));
        } else if (type === 'delete') {
          const id = op.id as string;
          await sessionRepo.delete({ id, programId });
          currentSessions = currentSessions.filter((s) => s.id !== id);
        } else {
          throw new BadRequestException(`Opération batch inconnue : ${type}`);
        }
      }

      // Check no overlapping sessions inside one program
      this.checkNoOverlapInsideProgram(currentSessions);

      const description =
        typeof input.description === 'string' && input.description.trim()
          ? input.description.trim()
          : `Modification groupée (${operations.length} opérations)`;

      await progRepo.update({ id: program.id }, { revision: newRevision, updatedAt: new Date() });
      await this.recordRevisionSnapshot(revRepo, program.id, newRevision, description, currentSessions, program.slots);

      return { revision: newRevision, sessions: currentSessions };
    });

    this.backups?.scheduler?.notifyDataChanged();
    return { ok: true, revision: result.revision, sessions: result.sessions };
  }

  async revert(programId: string, expectedRevision?: number) {
    const res = await this.dataSource.transaction(async (manager) => {
      const progRepo = manager.getRepository(Program);
      const slotRepo = manager.getRepository(ProgramSlotEntity);
      const sessionRepo = manager.getRepository(ProgramSessionEntity);
      const revRepo = manager.getRepository(ProgramRevision);

      const program = await progRepo.findOne({
        where: { id: programId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!program) throw new NotFoundException('Programme introuvable.');
      program.slots = await slotRepo.findBy({ programId });

      if (expectedRevision !== undefined && program.revision !== expectedRevision) {
        throw new ConflictException(
          `Le programme a été modifié (révision attendue : ${expectedRevision}, actuelle : ${program.revision}). Veuillez actualiser.`,
        );
      }

      const snap = program.originalSnapshot as { sessions?: ProgramSession[]; slots?: ProgramSlotEntity[] } | undefined;
      if (!snap || !Array.isArray(snap.sessions)) {
        throw new BadRequestException('L’import initial ne contient aucun instantané de séances.');
      }
      const initialSessions = snap.sessions;
      const newRevision = program.revision + 1;

      await sessionRepo.delete({ programId });

      let saved: ProgramSessionEntity[] = [];
      if (initialSessions.length) {
        saved = await sessionRepo.save(
          initialSessions.map((s) => {
            const data = { ...s, id: randomUUID(), programId, room: s.roomUnassigned ? null : s.room };
            return sessionRepo.create(data);
          }),
        );
      }

      await progRepo.update({ id: program.id }, { revision: newRevision, updatedAt: new Date() });
      await this.recordRevisionSnapshot(revRepo, program.id, newRevision, 'Retour à l’import initial', saved, program.slots);

      return { newRevision };
    });

    this.backups?.scheduler?.notifyDataChanged();
    return this.get(programId);
  }

  async listRevisions(programId: string) {
    const program = await this.programs.findOneBy({ id: programId });
    if (!program) throw new NotFoundException('Programme introuvable.');

    const list = await this.programRevisions.find({
      where: { programId },
      order: { revision: 'DESC' },
      take: MAX_REVISIONS_KEPT,
    });

    return list.map((rev) => {
      const snap = (rev.snapshot as { sessions?: unknown[] }) ?? {};
      return {
        id: rev.id,
        revision: rev.revision,
        description: rev.description,
        createdAt: rev.createdAt,
        sessionCount: Array.isArray(snap.sessions) ? snap.sessions.length : 0,
      };
    });
  }

  async restoreRevision(programId: string, revisionNumber: number, expectedRevision?: number) {
    await this.dataSource.transaction(async (manager) => {
      const progRepo = manager.getRepository(Program);
      const slotRepo = manager.getRepository(ProgramSlotEntity);
      const sessionRepo = manager.getRepository(ProgramSessionEntity);
      const revRepo = manager.getRepository(ProgramRevision);

      const program = await progRepo.findOne({
        where: { id: programId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!program) throw new NotFoundException('Programme introuvable.');
      program.slots = await slotRepo.findBy({ programId });

      if (expectedRevision !== undefined && program.revision !== expectedRevision) {
        throw new ConflictException(
          `Le programme a été modifié (révision attendue : ${expectedRevision}, actuelle : ${program.revision}). Veuillez actualiser.`,
        );
      }

      const targetRev = await revRepo.findOneBy({ programId, revision: revisionNumber });
      if (!targetRev) throw new NotFoundException(`Révision ${revisionNumber} introuvable.`);

      const snap = targetRev.snapshot as { sessions?: ProgramSession[] } | undefined;
      const restoreSessions = snap?.sessions ?? [];
      const newRevision = program.revision + 1;

      await sessionRepo.delete({ programId });

      let saved: ProgramSessionEntity[] = [];
      if (restoreSessions.length) {
        saved = await sessionRepo.save(
          restoreSessions.map((s) => {
            const data = { ...s, id: randomUUID(), programId, room: s.roomUnassigned ? null : s.room };
            return sessionRepo.create(data);
          }),
        );
      }

      await progRepo.update({ id: program.id }, { revision: newRevision, updatedAt: new Date() });
      await this.recordRevisionSnapshot(revRepo, program.id, newRevision, `Restauration de la révision ${revisionNumber}`, saved, program.slots);
    });

    this.backups?.scheduler?.notifyDataChanged();
    return this.get(programId);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async recordRevisionSnapshot(
    repo: Repository<ProgramRevision>,
    programId: string,
    revision: number,
    description: string,
    sessions: ProgramSessionEntity[] | ProgramSession[],
    slots: ProgramSlotEntity[],
  ) {
    await repo.save(
      repo.create({
        programId,
        revision,
        description,
        snapshot: { sessions, slots },
      }),
    );

    // Prune revisions beyond the last 50
    await repo.query(
      `DELETE FROM program_revisions WHERE "programId" = $1 AND id NOT IN (
        SELECT id FROM program_revisions WHERE "programId" = $1 ORDER BY revision DESC LIMIT ${MAX_REVISIONS_KEPT}
      )`,
      [programId],
    );
  }

  private prepareSessionInput(input: Record<string, unknown>, current?: ProgramSessionEntity): ProgramSession {
    const day = typeof input.day === 'number' ? input.day : (current?.day ?? 0);
    const slot = typeof input.slot === 'number' ? input.slot : (current?.slot ?? 0);
    const slotSpan = typeof input.slotSpan === 'number' ? input.slotSpan : (current?.slotSpan ?? 1);
    const daySpan = typeof input.daySpan === 'number' ? input.daySpan : (current?.daySpan ?? 1);
    const title = typeof input.title === 'string' ? input.title.trim() : (current?.title ?? '');
    const code = typeof input.code === 'string' ? input.code.trim() : (current?.code ?? '');

    const teachers = Array.isArray(input.teachers)
      ? (input.teachers as string[]).map((t) => String(t).trim()).filter(Boolean)
      : (current?.teachers ?? []);

    const teacherKeys = teachers
      .map((t) => canonicalTeacherKey(t))
      .filter((k): k is string => Boolean(k));

    const rawRoom = typeof input.room === 'string' ? input.room.trim() : (input.room === null ? null : current?.room ?? null);
    const { canonicalRoom, roomUnassigned } = resolveCanonicalRoom(rawRoom);
    const effectiveRoomUnassigned = Boolean(input.roomUnassigned || roomUnassigned);

    return {
      id: current?.id,
      day,
      slot,
      slotSpan,
      daySpan,
      title,
      code,
      teachers,
      teacherKeys,
      room: effectiveRoomUnassigned ? null : (canonicalRoom ?? rawRoom),
      roomUnassigned: effectiveRoomUnassigned,
      locationNote: typeof input.locationNote === 'string' ? input.locationNote.trim() : (current?.locationNote ?? ''),
      frequency: typeof input.frequency === 'string' ? input.frequency.trim() : (current?.frequency ?? ''),
      tags: Array.isArray(input.tags) ? (input.tags as string[]) : (current?.tags ?? []),
      customTime: typeof input.customTime === 'string' ? input.customTime.trim() : (current?.customTime ?? null),
      color: typeof input.color === 'string' ? input.color.replace(/^#/u, '').toUpperCase() : (current?.color ?? null),
      note: typeof input.note === 'string' ? input.note : (current?.note ?? ''),
      rawText: typeof input.rawText === 'string' ? input.rawText : (current?.rawText ?? title),
      confidence: typeof input.confidence === 'number' ? input.confidence : (current?.confidence ?? 1),
      reasons: Array.isArray(input.reasons) ? (input.reasons as string[]) : (current?.reasons ?? []),
      source: 'manual',
    };
  }

  private checkNoOverlapInsideProgram(sessions: Array<{ day: number; slot: number; slotSpan?: number; daySpan?: number; title?: string; id?: string }>) {
    const occupied = new Set<string>();
    for (const s of sessions) {
      const dSpan = s.daySpan ?? 1;
      const sSpan = s.slotSpan ?? 1;
      for (let d = 0; d < dSpan; d++) {
        for (let sl = 0; sl < sSpan; sl++) {
          const key = `${s.day + d}:${s.slot + sl}`;
          if (occupied.has(key)) {
            throw new BadRequestException(`Chevauchement de séances dans le programme à la case (jour ${s.day + d + 1}, créneau ${s.slot + sl + 1}).`);
          }
          occupied.add(key);
        }
      }
    }
  }

  private validateSession(session: ProgramSession, index: number) {
    if (!session || !Number.isInteger(session.day) || session.day < 0 || session.day > 5 || !Number.isInteger(session.slot) || session.slot < 0 || session.slot > 5) throw new BadRequestException(`Séance ${index + 1} : jour ou créneau invalide.`);
    if (!Number.isInteger(session.slotSpan) || session.slotSpan < 1 || session.slot + session.slotSpan > 6 || !Number.isInteger(session.daySpan) || session.daySpan < 1 || session.day + session.daySpan > 6) throw new BadRequestException(`Séance ${index + 1} : fusion de cellules invalide.`);
    if (session.roomUnassigned && session.room) throw new BadRequestException(`Séance ${index + 1} : une salle à rechercher ne peut pas avoir de salle affectée.`);
    if (typeof session.title !== 'string' || session.title.length > 1_000 || typeof session.code !== 'string' || session.code.length > 100 || typeof session.rawText !== 'string' || session.rawText.length > 10_000 || !Array.isArray(session.teachers) || session.teachers.length > 20 || session.teachers.some((name) => typeof name !== 'string' || name.length > 255) || !Array.isArray(session.teacherKeys) || session.teacherKeys.length > 20 || session.teacherKeys.some((key) => typeof key !== 'string' || key.length > 255) || !Array.isArray(session.tags) || session.tags.length > 30 || session.tags.some((tag) => typeof tag !== 'string' || tag.length > 100) || !Array.isArray(session.reasons) || session.reasons.length > 30 || session.reasons.some((reason) => typeof reason !== 'string' || reason.length > 500) || !Number.isFinite(session.confidence) || session.confidence < 0 || session.confidence > 1) throw new BadRequestException(`Séance ${index + 1} : champs invalides.`);
    if ((session.room !== null && typeof session.room !== 'string' && session.room !== undefined) || typeof session.locationNote !== 'string' || session.locationNote.length > 255 || typeof session.frequency !== 'string' || session.frequency.length > 100 || typeof session.note !== 'string' || session.note.length > 2_000 || typeof session.roomUnassigned !== 'boolean' || !['docx', 'pdf', 'manual'].includes(session.source) || (session.color !== null && session.color !== undefined && !/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(session.color)) || (session.customTime !== null && session.customTime !== undefined && (typeof session.customTime !== 'string' || session.customTime.length > 80 || !parseCustomTime(session.customTime)))) throw new BadRequestException(`Séance ${index + 1} : champs invalides.`);
  }

  private validateAliasNames(aliasName: string, canonicalName: string) {
    if (!aliasName || !canonicalName || aliasName.length > 255 || canonicalName.length > 255 || /[\u0000-\u001f\u007f-\u009f]/u.test(aliasName + canonicalName) || !normalizeName(aliasName) || !normalizeName(canonicalName)) throw new BadRequestException('Les noms de l’alias sont invalides.');
  }

  private toApiProgram(program: Program) {
    const parsed = program.originalSnapshot ?? {};
    const source = parsed.source === 'pdf' ? 'pdf' : 'docx';
    return {
      ...program,
      source,
      rawSnapshot: parsed,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 1,
      sessions: program.sessions ?? [],
      slots: program.slots ?? [],
    };
  }
}
