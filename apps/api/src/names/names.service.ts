import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { RoomLabel, SessionEntity, TeacherName, Timetable } from '../entities/timetable.entity.js';
import { formatTeacher, roomLabel } from '../export/grid-builder.js';
import { createNameResolver, NameResolver } from '../export/name-resolver.js';
import { ExportOptions } from '../export/options.js';
import { SettingsService } from '../settings/settings.service.js';
import { normalizeName, validateDisplayName } from './name-normalization.js';
import { BackupsService } from '../backups/backups.service.js';

export type NameKind = 'teachers' | 'rooms';

interface OverrideInput {
  key: string;
  sourceName: string;
  displayName: string;
}

interface NameRow {
  key: string;
  sourceName: string;
  autoName: string;
  displayName: string | null;
  sessions: number;
  bloc?: string | null;
}

const SOURCE_PRIORITY = ['rooms', 'teachers', 'groups'] as const;
const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });

@Injectable()
export class NamesService {
  constructor(
    @InjectRepository(TeacherName) private readonly teachers: Repository<TeacherName>,
    @InjectRepository(RoomLabel) private readonly rooms: Repository<RoomLabel>,
    @InjectRepository(SessionEntity) private readonly sessions: Repository<SessionEntity>,
    @InjectRepository(Timetable) private readonly timetables: Repository<Timetable>,
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    @Optional() private readonly backups?: BackupsService,
  ) {}

  async list(kind: NameKind, timetableId: string) {
    const timetable = await this.timetables.findOneBy({ id: timetableId });
    if (!timetable) throw new NotFoundException('Emploi du temps introuvable');

    const [rows, overrides, options] = await Promise.all([
      this.sessions.find({ where: { timetableId } }),
      this.repository(kind).find(),
      this.settings.getExportOptions(),
    ]);

    const source = SOURCE_PRIORITY.find((candidate) => timetable.files.some((file) => file.kind === candidate));
    const countedRows = rows.filter((row) => row.source === source);
    const counts = source ? countedRows : rows;
    const active = kind === 'teachers'
      ? this.collectTeachers(rows, counts)
      : this.collectRooms(timetable.rooms ?? [], rows, counts);
    const overrideMap = new Map(overrides.map((override) => [override.key, override]));
    const makeRow = (key: string, value: { sourceName: string; sessions: number }): NameRow => {
      const override = overrideMap.get(key);
      if (kind === 'teachers') {
        return {
          key, sourceName: value.sourceName, autoName: formatTeacher(value.sourceName, options.abbreviateBen),
          displayName: override?.displayName ?? null, sessions: value.sessions,
        };
      }
      return {
        key, sourceName: value.sourceName, autoName: roomLabel(value.sourceName),
        displayName: override?.displayName ?? null, sessions: value.sessions,
        bloc: this.findBloc(value.sourceName, options),
      };
    };

    const items = [...active]
      .filter(([, value]) => kind !== 'teachers' || Boolean(formatTeacher(value.sourceName, options.abbreviateBen)))
      .map(([key, value]) => makeRow(key, value))
      .sort((a, b) => naturalCompare(a.sourceName, b.sourceName));
    const unused = overrides.filter((override) => !active.has(override.key))
      .map((override) => makeRow(override.key, { sourceName: override.sourceName, sessions: 0 }))
      .sort((a, b) => naturalCompare(a.sourceName, b.sourceName));

    return { items, unused };
  }

  async getResolver(): Promise<NameResolver> {
    const [teachers, rooms] = await Promise.all([this.teachers.find(), this.rooms.find()]);
    return createNameResolver(
      new Map(teachers.map((item) => [item.key, item.displayName])),
      new Map(rooms.map((item) => [item.key, item.displayName])),
    );
  }

  async save(kind: NameKind, body: unknown) {
    const inputs = this.parseItems(body, true);
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(kind === 'teachers' ? TeacherName : RoomLabel);
      const removals = inputs.filter((item) => !item.displayName).map((item) => item.key);
      const updates = inputs.filter((item) => item.displayName);
      if (removals.length) await repository.delete({ key: In(removals) });
      if (updates.length) await repository.upsert(updates, ['key']);
    });
    if (inputs.length > 0) {
      this.backups?.scheduler?.notifyDataChanged();
    }
    return { ok: true, saved: inputs.length };
  }

  async remove(kind: NameKind, key: string) {
    if (!key || normalizeName(key) !== key) {
      throw new BadRequestException('Clé de nom invalide');
    }
    await this.repository(kind).delete({ key });
    this.backups?.scheduler?.notifyDataChanged();
    return { ok: true };
  }

  async exportNames() {
    const [teachers, rooms] = await Promise.all([this.teachers.find(), this.rooms.find()]);
    const serialize = (rows: (TeacherName | RoomLabel)[]) => rows
      .sort((a, b) => naturalCompare(a.sourceName, b.sourceName))
      .map(({ key, sourceName, displayName }) => ({ key, sourceName, displayName }));
    return { version: 1, teachers: serialize(teachers), rooms: serialize(rooms) };
  }

  async importNames(body: unknown) {
    let size: number;
    try {
      size = Buffer.byteLength(JSON.stringify(body), 'utf8');
    } catch {
      throw new BadRequestException('Fichier de noms invalide');
    }
    if (size > 1024 * 1024) throw new BadRequestException('Le fichier de noms dépasse 1 Mo');
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Fichier de noms invalide : objet attendu');
    }
    const data = body as Record<string, unknown>;
    if (data.version !== 1 || !Array.isArray(data.teachers) || !Array.isArray(data.rooms)) {
      throw new BadRequestException('Fichier de noms invalide : version ou listes manquantes');
    }
    const teacherInputs = this.parseItems({ items: data.teachers }, false);
    const roomInputs = this.parseItems({ items: data.rooms }, false);
    const [existingTeachers, existingRooms] = await Promise.all([this.teachers.find(), this.rooms.find()]);
    const planImport = (existing: (TeacherName | RoomLabel)[], inputs: OverrideInput[]) => {
      const byKey = new Map(existing.map((row) => [row.key, row]));
      const counts = { added: 0, updated: 0, ignored: 0 };
      const changed: OverrideInput[] = [];
      for (const item of inputs) {
        const old = byKey.get(item.key);
        if (!old) {
          counts.added++;
          changed.push(item);
        } else if (old.sourceName !== item.sourceName || old.displayName !== item.displayName) {
          counts.updated++;
          changed.push(item);
        } else {
          counts.ignored++;
        }
      }
      return { counts, changed };
    };
    const teacherPlan = planImport(existingTeachers, teacherInputs);
    const roomPlan = planImport(existingRooms, roomInputs);
    if (teacherPlan.changed.length || roomPlan.changed.length) {
      await this.dataSource.transaction(async (manager) => {
        if (teacherPlan.changed.length) {
          await manager.getRepository(TeacherName).upsert(teacherPlan.changed, ['key']);
        }
        if (roomPlan.changed.length) {
          await manager.getRepository(RoomLabel).upsert(roomPlan.changed, ['key']);
        }
      });
      this.backups?.scheduler?.notifyDataChanged();
    }
    const teacherCounts = teacherPlan.counts;
    const roomCounts = roomPlan.counts;
    return {
      added: teacherCounts.added + roomCounts.added,
      updated: teacherCounts.updated + roomCounts.updated,
      ignored: teacherCounts.ignored + roomCounts.ignored,
      teachers: teacherCounts,
      rooms: roomCounts,
    };
  }

  private repository(kind: NameKind): Repository<TeacherName> | Repository<RoomLabel> {
    return kind === 'teachers' ? this.teachers : this.rooms;
  }

  private parseItems(body: unknown, allowRemoval: boolean): OverrideInput[] {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray((body as { items?: unknown }).items)) {
      throw new BadRequestException('Le champ « items » doit être une liste');
    }
    const items = (body as { items: unknown[] }).items;
    if (items.length > 10_000) throw new BadRequestException('La liste contient trop de lignes');
    const seen = new Set<string>();
    return items.map((item, index) => {
      const row = index + 1;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BadRequestException(`Ligne ${row} : objet attendu`);
      }
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.sourceName !== 'string') {
        throw new BadRequestException(`Ligne ${row} : le nom dans le fichier est obligatoire`);
      }
      const sourceName = candidate.sourceName.trim();
      if (!sourceName || sourceName.length > 255 || /[\u0000-\u001f\u007f-\u009f]/u.test(sourceName)) {
        throw new BadRequestException(`Ligne ${row} : le nom dans le fichier est invalide`);
      }
      let displayName: string | null;
      try {
        displayName = validateDisplayName(candidate.displayName, row);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      if (!allowRemoval && !displayName) {
        throw new BadRequestException(`Ligne ${row} : le nom affiché est obligatoire dans un fichier importé`);
      }
      const key = normalizeName(sourceName);
      if (!key) throw new BadRequestException(`Ligne ${row} : le nom dans le fichier est invalide`);
      if (seen.has(key)) throw new BadRequestException(`Ligne ${row} : ce nom apparaît plusieurs fois`);
      seen.add(key);
      return { key, sourceName, displayName: displayName ?? '' };
    });
  }

  private collectTeachers(
    allRows: SessionEntity[],
    countedRows: SessionEntity[],
  ): Map<string, { sourceName: string; sessions: number }> {
    const active = new Map<string, { sourceName: string; sessions: number }>();
    const counts = new Map<string, number>();
    for (const row of countedRows) {
      for (const teacher of row.teachers.split(',')) {
        const key = normalizeName(teacher);
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    for (const row of allRows) {
      for (const teacher of row.teachers.split(',')) {
        const sourceName = teacher.trim();
        const key = normalizeName(sourceName);
        if (key && formatTeacher(sourceName, false) && !active.has(key)) {
          active.set(key, { sourceName, sessions: counts.get(key) ?? 0 });
        }
      }
    }
    return active;
  }

  private collectRooms(
    timetableRooms: string[],
    allRows: SessionEntity[],
    countedRows: SessionEntity[],
  ): Map<string, { sourceName: string; sessions: number }> {
    const counts = new Map<string, number>();
    for (const row of countedRows) {
      const key = normalizeName(row.room);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const active = new Map<string, { sourceName: string; sessions: number }>();
    for (const room of [...timetableRooms, ...allRows.map((row) => row.room)]) {
      const sourceName = room.trim();
      const key = normalizeName(sourceName);
      if (key && !active.has(key)) active.set(key, { sourceName, sessions: counts.get(key) ?? 0 });
    }
    return active;
  }

  private findBloc(room: string, options: ExportOptions): string | null {
    return options.blocs.find((bloc) => bloc.patterns.some((pattern) => new RegExp(pattern, 'i').test(room)))?.title ?? null;
  }
}
