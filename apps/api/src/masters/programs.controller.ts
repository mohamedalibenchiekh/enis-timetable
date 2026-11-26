import {
  BadRequestException,
  Body,
  CallHandler,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  NestInterceptor,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { catchError, throwError } from 'rxjs';
import { Readable } from 'node:stream';
import { ProgramsService, safeExportName } from './programs.service.js';
import type { Response } from 'express';
import { Res } from '@nestjs/common';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20;
const totalBytesByRequest = new WeakMap<object, number>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseProgramExportIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequestException('Identifiant de programme invalide.');
  const ids = value.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.some((id) => !UUID_RE.test(id))) throw new BadRequestException('Identifiant de programme invalide.');
  return ids;
}

type UploadPart = { stream: Readable; buffer?: Buffer };
type StoredPart = { buffer: Buffer; size: number };
type StorageCallback = (error: Error | null, info?: StoredPart) => void;

const aggregateMemoryStorage = {
  _handleFile(request: object, file: UploadPart, callback: StorageCallback) {
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    file.stream.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      const total = (totalBytesByRequest.get(request) ?? 0) + bytes.length;
      totalBytesByRequest.set(request, total);
      if (total > MAX_FILE_BYTES) {
        file.stream.destroy(new BadRequestException('La taille totale des fichiers dépasse la limite de 20 Mo.'));
        return;
      }
      chunks.push(bytes);
    });
    file.stream.once('error', (error: Error) => {
      if (!finished) { finished = true; callback(error); }
    });
    file.stream.once('end', () => {
      if (!finished) {
        finished = true;
        const buffer = Buffer.concat(chunks, size);
        callback(null, { buffer, size: buffer.length });
      }
    });
  },
  _removeFile(_request: object, file: UploadPart, callback: (error: Error | null) => void) {
    delete file.buffer;
    callback(null);
  },
};

class FrenchUploadLimitInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(catchError((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'LIMIT_FILE_SIZE') {
        return throwError(() => new BadRequestException('La taille totale des fichiers dépasse la limite de 20 Mo.'));
      }
      return throwError(() => error);
    }));
  }
}

@Controller('programs')
export class ProgramsController {
  constructor(private readonly service: ProgramsService) {}

  @Post('analyze')
  @UseInterceptors(
    FrenchUploadLimitInterceptor,
    FilesInterceptor('files', MAX_FILES, {
      storage: aggregateMemoryStorage,
      limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, parts: MAX_FILES + 3 },
    }),
  )
  analyze(
    @UploadedFiles() files: { originalname: string; buffer: Buffer; size: number }[],
    @Body() body: { referenceSlots?: string; referenceTimetableId?: string; referenceOverrides?: string },
  ) {
    let slots: string[] | undefined;
    if (body?.referenceSlots) {
      try { slots = JSON.parse(body.referenceSlots) as string[]; }
      catch { throw new BadRequestException('Créneaux de référence invalides.'); }
      if (!Array.isArray(slots) || slots.length !== 6 || slots.some((slot) => typeof slot !== 'string' || slot.length > 80)) {
        throw new BadRequestException('Six créneaux de référence sont attendus (80 caractères maximum chacun).');
      }
    }
    let overrides: Record<number, Record<number, string>> | undefined;
    if (body?.referenceOverrides) {
      try { overrides = JSON.parse(body.referenceOverrides) as Record<number, Record<number, string>>; }
      catch { throw new BadRequestException('Surcharges de créneaux de référence invalides.'); }
      if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.entries(overrides).some(([index, value]) => !/^[0-5]$/u.test(index) || !value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([day, label]) => !/^[0-5]$/u.test(day) || typeof label !== 'string' || label.length > 80))) {
        throw new BadRequestException('Surcharges de créneaux de référence invalides.');
      }
    }
    return this.service.analyze(files, slots, body?.referenceTimetableId, overrides);
  }

  @Post()
  save(@Body() body: unknown) {
    return this.service.save(body);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get('aliases')
  aliases() {
    return this.service.listAliases();
  }

  @Get('export.zip')
  async exportZip(@Query('ids') ids: unknown, @Res() response: Response) {
    const parsedIds = parseProgramExportIds(ids);
    const buffer = await this.service.exportZip(parsedIds);
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', 'attachment; filename="Emplois-masters.zip"');
    response.send(buffer);
  }

  @Get(':id/export.docx')
  async exportDocx(@Param('id', ParseUUIDPipe) id: string, @Res() response: Response) {
    const { buffer, layout } = await this.service.exportDocx(id);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const code = safeExportName(layout.program.code);
    response.setHeader('Content-Disposition', `attachment; filename="Emploi-${code}-${new Date().toISOString().slice(0, 10)}.docx"`);
    response.send(buffer);
  }

  @Get(':id/print.html')
  async printHtml(@Param('id', ParseUUIDPipe) id: string, @Res() response: Response) {
    const { html, warnings } = await this.service.exportHtml(id);
    response.setHeader('X-Export-Warnings', encodeURIComponent(JSON.stringify(warnings)));
    response.type('html').send(html);
  }

  @Get(':id/export.pdf')
  exportPdf() {
    return this.service.exportPdfUnavailable();
  }

  @Post('aliases')
  saveAlias(@Body() body: unknown) {
    return this.service.saveAlias(body);
  }

  @Delete('aliases/:kind/:id')
  deleteAlias(@Param('kind') kind: string, @Param('id', ParseIntPipe) id: number) {
    return this.service.deleteAlias(kind, id);
  }

  @Get(':id/conflicts')
  getConflicts(@Param('id', ParseUUIDPipe) id: string, @Query('against') against?: string) {
    return this.service.getConflicts(id, against);
  }

  @Get(':id/sessions/:sid/suggestions')
  getSuggestions(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Query('against') against?: string,
  ) {
    return this.service.getSessionSuggestions(id, sid, against);
  }

  @Post(':id/sessions')
  createSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { expectedRevision?: number; session?: unknown },
  ) {
    return this.service.createSession(id, body);
  }

  @Put(':id/sessions/:sid')
  updateSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() body: { expectedRevision?: number; session?: unknown },
  ) {
    return this.service.updateSession(id, sid, body);
  }

  @Delete(':id/sessions/:sid')
  deleteSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Query('expectedRevision') expectedRevision?: string,
  ) {
    const expRev = expectedRevision ? parseInt(expectedRevision, 10) : undefined;
    return this.service.deleteSession(id, sid, expRev);
  }

  @Post(':id/sessions/batch')
  batchSessions(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.batchSessions(id, body);
  }

  @Post(':id/revert')
  revert(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('expectedRevision') expectedRevision?: string,
  ) {
    const expRev = expectedRevision ? parseInt(expectedRevision, 10) : undefined;
    return this.service.revert(id, expRev);
  }

  @Get(':id/revisions')
  listRevisions(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listRevisions(id);
  }

  @Post(':id/revisions/:revision/restore')
  restoreRevision(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('revision', ParseIntPipe) revision: number,
    @Query('expectedRevision') expectedRevision?: string,
  ) {
    const expRev = expectedRevision ? parseInt(expectedRevision, 10) : undefined;
    return this.service.restoreRevision(id, revision, expRev);
  }

  @Post(':id/restore')
  restoreRevisionFromBody(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { revision: number; expectedRevision?: number },
  ) {
    if (!body || typeof body.revision !== 'number' || !Number.isInteger(body.revision) || body.revision < 1) {
      throw new BadRequestException('Le numéro de révision valide est obligatoire.');
    }
    return this.service.restoreRevision(id, body.revision, body.expectedRevision);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
