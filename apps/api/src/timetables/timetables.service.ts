import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { SessionEntity, SourceFileInfo, Timetable } from '../entities/timetable.entity.js';
import { detectKind, parseHtml } from '../parser/html-parser.js';
import { ParsedFile, SourceKind } from '../parser/types.js';
import { buildDayGrid, DayGrid } from '../export/grid-builder.js';
import { buildDayDocx } from '../export/docx-builder.js';
import { SettingsService } from '../settings/settings.service.js';
import { NamesService } from '../names/names.service.js';
import { NameResolver } from '../export/name-resolver.js';

const PRIORITY: SourceKind[] = ['rooms', 'teachers', 'groups'];

export interface UploadedHtml {
  originalname: string;
  buffer: Buffer;
}

@Injectable()
export class TimetablesService {
  constructor(
    @InjectRepository(Timetable) private repo: Repository<Timetable>,
    @InjectRepository(SessionEntity) private sessions: Repository<SessionEntity>,
    private ds: DataSource,
    private settings: SettingsService,
    private names: NamesService,
  ) {}

  list() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async get(id: string) {
    const t = await this.repo.findOneBy({ id });
    if (!t) throw new NotFoundException('Emploi du temps introuvable');
    return t;
  }

  async remove(id: string) {
    await this.get(id);
    await this.repo.delete(id);
  }

  /** Parse the uploaded HTML files and store them (new timetable, or add/replace views of an existing one). */
  async importFiles(files: UploadedHtml[], opts: { name?: string; timetableId?: string }) {
    if (!files?.length) throw new BadRequestException('Aucun fichier HTML reçu');
    const parsed: { file: UploadedHtml; data: ParsedFile }[] = [];
    for (const f of files) {
      const html = f.buffer.toString('utf8');
      const kind = detectKind(f.originalname, html);
      if (!kind) throw new BadRequestException(`Type de fichier inconnu : « ${f.originalname} » (attendu : teachers, rooms ou groups dans le nom)`);
      const data = parseHtml(html, kind);
      if (!data.owners.length) throw new BadRequestException(`« ${f.originalname} » ne contient aucun tableau d'emploi du temps`);
      parsed.push({ file: f, data });
    }
    const kinds = parsed.map((p) => p.data.kind);
    if (new Set(kinds).size !== kinds.length) throw new BadRequestException('Deux fichiers du même type (teachers/rooms/groups) ont été envoyés');

    return this.ds.transaction(async (em) => {
      let t: Timetable;
      if (opts.timetableId) {
        t = await em.findOneByOrFail(Timetable, { id: opts.timetableId }).catch(() => {
          throw new NotFoundException('Emploi du temps introuvable');
        });
      } else {
        const ref = parsed.find((p) => p.data.kind === 'rooms') ?? parsed[0];
        t = em.create(Timetable, {
          name: opts.name?.trim() || ref.data.comment || path.parse(ref.file.originalname).name,
          files: [],
        });
      }
      t = await em.save(Timetable, t);

      for (const { file, data } of parsed) {
        await em.delete(SessionEntity, { timetableId: t.id, source: data.kind });
        const rows = data.sessions.map((s) => em.create(SessionEntity, { ...s, timetableId: t.id, source: data.kind }));
        for (let i = 0; i < rows.length; i += 500) await em.insert(SessionEntity, rows.slice(i, i + 500));
        const info: SourceFileInfo = { kind: data.kind, fileName: file.originalname, owners: data.owners.length, sessions: data.sessions.length };
        t.files = [...(t.files ?? []).filter((x) => x.kind !== data.kind), info];
        t.institution = data.institution || t.institution;
        t.comment = data.comment || t.comment;
        t.generatedAt = data.generatedAt || t.generatedAt;
        if (data.days.length) t.days = data.days;
        if (data.slots.length) t.slots = data.slots;
        if (data.kind === 'rooms') t.rooms = data.owners;
      }
      return em.save(Timetable, t);
    });
  }

  /** Which view feeds the room grids: rooms (best) → teachers → groups. */
  private pickSource(t: Timetable): SourceKind {
    const kind = PRIORITY.find((k) => t.files.some((f) => f.kind === k));
    if (!kind) throw new BadRequestException('Cet emploi du temps ne contient aucune donnée');
    return kind;
  }

  async dayGrid(id: string, day: number, nameResolver?: NameResolver): Promise<DayGrid> {
    const t = await this.get(id);
    if (!Number.isInteger(day) || day < 0 || day >= t.days.length) throw new BadRequestException('Jour invalide');
    const source = this.pickSource(t);
    const rows = await this.sessions.find({ where: { timetableId: id, source, day } });
    const options = await this.settings.getExportOptions();
    const resolver = nameResolver ?? await this.names.getResolver();
    return buildDayGrid(rows, { days: t.days, slots: t.slots, rooms: t.rooms }, day, options, resolver);
  }

  async dayDocx(id: string, day: number, nameResolver?: NameResolver) {
    const grid = await this.dayGrid(id, day, nameResolver);
    return { fileName: `${grid.dayName}.docx`, buffer: await buildDayDocx(grid) };
  }

  async allDocx(id: string) {
    const t = await this.get(id);
    const nameResolver = await this.names.getResolver();
    const out: { fileName: string; buffer: Buffer }[] = [];
    for (let d = 0; d < t.days.length; d++) out.push(await this.dayDocx(id, d, nameResolver));
    return out;
  }

  async zip(id: string) {
    const zip = new JSZip();
    for (const f of await this.allDocx(id)) zip.file(f.fileName, f.buffer);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  async exportToFolder(id: string, dir: string) {
    if (!dir || !path.isAbsolute(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
      throw new BadRequestException('Dossier invalide');
    const written: string[] = [];
    for (const f of await this.allDocx(id)) {
      const target = path.join(dir, f.fileName);
      fs.writeFileSync(target, f.buffer);
      written.push(target);
    }
    return { dir, files: written };
  }
}
