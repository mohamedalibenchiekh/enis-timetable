import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionEntity, Timetable } from '../entities/timetable.entity.js';
import { SettingsService } from '../settings/settings.service.js';
import { NamesService } from '../names/names.service.js';
import { buildCompareDocx } from '../export/compare-docx.js';
import { compareSessions } from './compare.js';
import type { CompareInput, CompareResult, CompareSource, CompareSummary, TimetableSummary } from './types.js';

const SOURCES: CompareSource[] = ['teachers', 'rooms', 'groups'];
const SOURCE_LABELS: Record<CompareSource, string> = { teachers: 'enseignants', rooms: 'salles', groups: 'groupes' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function summaryOf(t: Timetable): TimetableSummary {
  return {
    id: t.id,
    name: t.name,
    institution: t.institution,
    comment: t.comment,
    generatedAt: t.generatedAt,
    createdAt: t.createdAt?.toISOString?.() ?? String(t.createdAt ?? ''),
    files: t.files ?? [],
  };
}

function hasSource(t: Timetable, source: CompareSource): boolean {
  return (t.files ?? []).some((f) => f.kind === source);
}

@Injectable()
export class CompareService {
  constructor(
    @InjectRepository(Timetable) private timetables: Repository<Timetable>,
    @InjectRepository(SessionEntity) private sessions: Repository<SessionEntity>,
    private settings: SettingsService,
    private names: NamesService,
  ) {}

  private async getTimetable(id: string): Promise<Timetable> {
    const t = await this.timetables.findOneBy({ id });
    if (!t) throw new NotFoundException('Emploi du temps introuvable');
    return t;
  }

  /** teachers if both timetables have it, else rooms, else groups. */
  private autoSource(base: Timetable, target: Timetable): CompareSource {
    for (const source of ['teachers', 'rooms', 'groups'] as CompareSource[]) {
      if (hasSource(base, source) && hasSource(target, source)) return source;
    }
    throw new BadRequestException('Les deux emplois du temps ne partagent aucune vue commune (teachers/rooms/groups)');
  }

  private resolveSource(base: Timetable, target: Timetable, source?: string): CompareSource {
    if (!source || source === 'auto') return this.autoSource(base, target);
    if (!SOURCES.includes(source as CompareSource)) {
      throw new BadRequestException(`Source de comparaison invalide : « ${source} » (attendu : auto, teachers, rooms ou groups)`);
    }
    const s = source as CompareSource;
    if (!hasSource(base, s) || !hasSource(target, s)) {
      throw new BadRequestException(`La vue « ${SOURCE_LABELS[s]} » est absente de l'un des deux emplois du temps`);
    }
    return s;
  }

  private async loadInput(t: Timetable, source: CompareSource): Promise<CompareInput> {
    const rows = await this.sessions.find({ where: { timetableId: t.id, source } });
    return {
      summary: summaryOf(t),
      meta: { days: t.days ?? [], slots: t.slots ?? [], rooms: t.rooms ?? [] },
      sessions: rows,
    };
  }

  /** `:id` is the older (base) version, `:otherId` the newer (target) one. */
  async compare(baseId: string, targetId: string, source?: string): Promise<CompareResult> {
    if (baseId === targetId) throw new BadRequestException('Impossible de comparer un emploi du temps avec lui-même');
    const [base, target] = await Promise.all([this.getTimetable(baseId), this.getTimetable(targetId)]);
    const resolved = this.resolveSource(base, target, source);
    const [baseInput, targetInput, options, resolver] = await Promise.all([
      this.loadInput(base, resolved),
      this.loadInput(target, resolved),
      this.settings.getExportOptions(),
      this.names.getResolver(),
    ]);
    return compareSessions(baseInput, targetInput, resolved, options, resolver);
  }

  /** Short summary used in the import response when a previous version is declared. */
  async compareSummary(baseId: string, targetId: string): Promise<CompareSummary> {
    const result = await this.compare(baseId, targetId, 'auto');
    return result.summary;
  }

  async compareDocx(baseId: string, targetId: string, source?: string) {
    const result = await this.compare(baseId, targetId, source);
    const baseName = result.base.name || 'version précédente';
    const targetName = result.target.name || 'nouvelle version';
    return {
      fileName: `Fiche-des-changements-${targetName}.docx`,
      buffer: await buildCompareDocx(result, baseName, targetName),
    };
  }

  async compareCsv(baseId: string, targetId: string, source?: string) {
    const result = await this.compare(baseId, targetId, source);
    return { fileName: `Fiche-des-changements-${result.target.name || 'comparaison'}.csv`, csv: toCsv(result) };
  }
}

const TYPE_LABELS: Record<string, string> = {
  added: 'Ajoutée',
  removed: 'Supprimée',
  moved: 'Déplacée',
  room_changed: 'Salle changée',
  group_changed: 'Groupe changé',
  teachers_changed: 'Enseignant changé',
};

function csvCell(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(result: CompareResult): string {
  const header = ['Type', 'Jour', 'Horaire avant', 'Salle avant', 'Horaire après', 'Salle après', 'Enseignants', 'Groupes', 'Matière', 'Fréquence'];
  const lines = [header.join(';')];
  for (const c of result.changes) {
    const a = c.activity;
    lines.push(
      [
        TYPE_LABELS[c.type] ?? c.type,
        c.days.join(' / '),
        c.before ? `${c.before.dayName} ${c.before.timeRange}` : '',
        c.before?.room ?? '',
        c.after ? `${c.after.dayName} ${c.after.timeRange}` : '',
        c.after?.room ?? '',
        a.teachers,
        a.groups,
        [a.subjectCode, a.subject].filter(Boolean).join(' '),
        a.frequency,
      ]
        .map(csvCell)
        .join(';'),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
