import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { TimetablesService } from './timetables.service.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const attachment = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

@Controller('timetables')
export class TimetablesController {
  constructor(private svc: TimetablesService) {}

  @Get() list() {
    return this.svc.list();
  }

  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(id);
  }

  @Delete(':id') async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.svc.remove(id);
    return { ok: true };
  }

  @Post()
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: 30 * 1024 * 1024 } }))
  upload(
    @UploadedFiles() files: { originalname: string; buffer: Buffer }[],
    @Body('name') name?: string,
    @Body('timetableId') timetableId?: string,
    @Body('previousTimetableId') previousTimetableId?: string,
  ) {
    // browsers send file names as latin1 in multipart: restore UTF-8
    const fixed = (files ?? []).map((f) => ({ originalname: Buffer.from(f.originalname, 'latin1').toString('utf8'), buffer: f.buffer }));
    return this.svc.importFiles(fixed, { name, timetableId: timetableId || undefined, previousTimetableId: previousTimetableId || undefined });
  }

  @Get(':id/days/:day/preview')
  preview(@Param('id', ParseUUIDPipe) id: string, @Param('day', ParseIntPipe) day: number, @Query('source') source?: string) {
    return this.svc.dayGrid(id, day, undefined, source as 'rooms' | 'teachers' | 'groups' | undefined);
  }

  @Get(':id/days/:day/docx')
  async docx(@Param('id', ParseUUIDPipe) id: string, @Param('day', ParseIntPipe) day: number, @Res({ passthrough: true }) res: Response) {
    const f = await this.svc.dayDocx(id, day);
    res.set({ 'Content-Type': DOCX, 'Content-Disposition': attachment(f.fileName) });
    return new StreamableFile(f.buffer);
  }

  @Get(':id/export.zip')
  async zip(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const buf = await this.svc.zip(id);
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': attachment('Emplois-du-temps.zip') });
    return new StreamableFile(buf);
  }

  @Post(':id/export-to-folder')
  exportToFolder(@Param('id', ParseUUIDPipe) id: string, @Body('dir') dir: string) {
    return this.svc.exportToFolder(id, dir);
  }
}
