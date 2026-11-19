import { BadRequestException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { KnownRoom, Program, ProgramSessionEntity, ProgramSlotEntity, RoomAlias, SessionEntity, TeacherAlias } from '../entities/timetable.entity.js';
import { parseMastersDocx } from './docx-importer.js';
import { parseMastersPdf } from './pdf-importer.js';
import { ProgramAnalysis, ProgramSession } from './types.js';
import { normalizeName } from '../names/name-normalization.js';
import { BackupsService } from '../backups/backups.service.js';
import { detectProgramConflicts } from './conflicts.js';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const seededRooms = [
  { aliasName: 'Salle PAQ', aliasKey: 'salle paq', canonicalName: 'PAQ/DGSE' },
  { aliasName: 'PAQ', aliasKey: 'paq', canonicalName: 'PAQ/DGSE' },
  { aliasName: 'Salle DGSE', aliasKey: 'salle dgse', canonicalName: 'PAQ/DGSE' },
  { aliasName: 'DGSE', aliasKey: 'dgse', canonicalName: 'PAQ/DGSE' },
];

@Injectable()
export class ProgramsService implements OnModuleInit {
  constructor(
    @InjectRepository(Program) private readonly programs: Repository<Program>,
    @InjectRepository(ProgramSlotEntity) private readonly slots: Repository<ProgramSlotEntity>,
    @InjectRepository(ProgramSessionEntity) private readonly sessions: Repository<ProgramSessionEntity>,
    @InjectRepository(RoomAlias) private readonly roomAliases: Repository<RoomAlias>,
    @InjectRepository(TeacherAlias) private readonly teacherAliases: Repository<TeacherAlias>,
    @InjectRepository(SessionEntity) private readonly fetSessions: Repository<SessionEntity>,
    @InjectRepository(KnownRoom) private readonly knownRooms: Repository<KnownRoom>,
    private readonly dataSource: DataSource,
    @Optional() private readonly backups?: BackupsService,
  ) {}

  async onModuleInit() {
    for (const alias of seededRooms) {
      const existing = await this.roomAliases.findOneBy({ aliasKey: alias.aliasKey });
      if (!existing) await this.roomAliases.save(this.roomAliases.create({ ...alias, seeded: true }));
    }
  }

  async analyze(files: { originalname: string; buffer: Buffer; size: number }[], referenceSlots?: string[], referenceTimetableId?: string, referenceOverrides?: Record<number, Record<number, string>>): Promise<ProgramAnalysis[]> {
    if (!files?.length) throw new BadRequestException('Sélectionnez au moins un fichier Word ou PDF.');
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_FILE_BYTES) throw new BadRequestException('La taille totale des fichiers dépasse la limite de 20 Mo.');
    if (referenceTimetableId && !/^[0-9a-f-]{36}$/iu.test(referenceTimetableId)) throw new BadRequestException('Emploi FET de référence invalide.');
    const [rooms, teachers, knownRooms, fetSessions] = await Promise.all([this.roomAliases.find(), this.teacherAliases.find(), this.knownRooms.find(), this.fetSessions.find()]);
    const roomAliases = Object.fromEntries(rooms.map((row) => [row.aliasKey, row.canonicalName]));
    const teacherAliasMap = Object.fromEntries(teachers.map((row) => [row.aliasKey, row.canonicalName]));
    const catalogs = {
      rooms: [...new Set([...knownRooms.map((row) => row.name), ...fetSessions.map((row) => row.room).filter(Boolean)])],
      teachers: [...new Set(fetSessions.flatMap((row) => row.teachers.split(',').map((teacher) => teacher.trim()).filter(Boolean)))],
      roomAliases,
      teacherAliases: teacherAliasMap,
    };
    const analyses = await Promise.all(files.map(async (file) => {
      if (file.size > MAX_FILE_BYTES) throw new BadRequestException(`Le fichier dépasse la limite de 20 Mo : ${file.originalname}`);
      const ext = file.originalname.toLowerCase().split('.').pop();
      if (ext === 'docx') return parseMastersDocx(file.buffer, file.originalname, referenceSlots, catalogs, referenceOverrides);
      if (ext === 'pdf') return parseMastersPdf(file.buffer, file.originalname, referenceSlots, catalogs, referenceOverrides);
      throw new BadRequestException(`Format non pris en charge : ${file.originalname} (DOCX ou PDF attendu).`);
    }));
    const roomsList = rooms.map((row) => row.canonicalName);
    const teachersList = teachers.map((row) => row.canonicalName);
    const referenceSessions = referenceTimetableId ? fetSessions.filter((session) => session.timetableId === referenceTimetableId) : [];
    const conflicts = (analysis: ProgramAnalysis) => referenceTimetableId ? detectProgramConflicts(
      analysis.sessions,
      referenceSessions.map((session) => ({ day: session.day, slot: session.slot, room: session.room, teachers: session.teachers.split(',').map((teacher) => teacher.trim()).filter(Boolean) })),
      roomAliases,
      teacherAliasMap,
    ) : [];
    return analyses.map((analysis) => {
      const found = conflicts(analysis);
      const conflictWarnings = found.map((item) => `Conflit de ${item.type === 'room' ? 'salle' : 'enseignant'} : ${item.resource} · ${item.title} · ${item.day + 1}/${item.slot + 1}`);
      return { ...analysis, warnings: [...new Set([...analysis.warnings, ...conflictWarnings])], rawSnapshot: { ...analysis.rawSnapshot, referenceSlots: referenceSlots ?? undefined, conflicts: found } };
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
      await programs.update({ code, isCurrent: true }, { isCurrent: false });
      const [row] = await manager.query('SELECT COALESCE(MAX(revision), 0) AS revision FROM programs WHERE code = $1', [code]);
      const revision = Number(row.revision ?? 0) + 1;
      const program = await programs.save(programs.create({
        code, title: analysis.title.trim(), kind: analysis.kind ?? '', academicYear: '2026-2027', semester: analysis.semester ?? '',
        coordinator: analysis.coordinator ?? '', formRef: analysis.formRef ?? '', effectiveFrom: analysis.effectiveFrom ?? '', footerText: analysis.footerText ?? '',
        version: (Number.parseInt(analysis.version.replace(/\D/gu, ''), 10) || revision), revision, isCurrent: true,
        originalSnapshot: { ...(analysis.rawSnapshot ?? {}), saveMode: mode, source: analysis.source, confidence: analysis.confidence, warnings: analysis.warnings },
      }));
      await slots.save(analysis.slots.map((slot) => slots.create({ ...slot, programId: program.id })));
      if (analysis.sessions.length) await sessions.save(analysis.sessions.map((session) => sessions.create({
        ...session, programId: program.id, room: session.roomUnassigned ? null : session.room,
      })));
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

  private validateSession(session: ProgramSession, index: number) {
    if (!session || !Number.isInteger(session.day) || session.day < 0 || session.day > 5 || !Number.isInteger(session.slot) || session.slot < 0 || session.slot > 5) throw new BadRequestException(`Séance ${index + 1} : jour ou créneau invalide.`);
    if (!Number.isInteger(session.slotSpan) || session.slotSpan < 1 || session.slot + session.slotSpan > 6 || !Number.isInteger(session.daySpan) || session.daySpan < 1 || session.day + session.daySpan > 6) throw new BadRequestException(`Séance ${index + 1} : fusion de cellules invalide.`);
    if (session.roomUnassigned && session.room) throw new BadRequestException(`Séance ${index + 1} : une salle à rechercher ne peut pas avoir de salle affectée.`);
    if (typeof session.title !== 'string' || session.title.length > 1_000 || typeof session.code !== 'string' || session.code.length > 100 || typeof session.rawText !== 'string' || session.rawText.length > 10_000 || !Array.isArray(session.teachers) || session.teachers.length > 20 || session.teachers.some((name) => typeof name !== 'string' || name.length > 255) || !Array.isArray(session.teacherKeys) || session.teacherKeys.length > 20 || session.teacherKeys.some((key) => typeof key !== 'string' || key.length > 255) || !Array.isArray(session.tags) || session.tags.length > 30 || session.tags.some((tag) => typeof tag !== 'string' || tag.length > 100) || !Array.isArray(session.reasons) || session.reasons.length > 30 || session.reasons.some((reason) => typeof reason !== 'string' || reason.length > 500) || !Number.isFinite(session.confidence) || session.confidence < 0 || session.confidence > 1) throw new BadRequestException(`Séance ${index + 1} : champs invalides.`);
    if (session.room !== null && (typeof session.room !== 'string' || session.room.length > 255) || typeof session.locationNote !== 'string' || session.locationNote.length > 255 || typeof session.frequency !== 'string' || session.frequency.length > 100 || typeof session.note !== 'string' || session.note.length > 2_000 || typeof session.roomUnassigned !== 'boolean' || !['docx', 'pdf', 'manual'].includes(session.source) || (session.color !== null && session.color !== undefined && !/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(session.color)) || (session.customTime !== null && session.customTime !== undefined && (typeof session.customTime !== 'string' || session.customTime.length > 80))) throw new BadRequestException(`Séance ${index + 1} : champs invalides.`);
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

