import { Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { CompareService } from './compare.service.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const attachment = (name: string) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

@Controller('timetables')
export class CompareController {
  constructor(private svc: CompareService) {}

  @Get(':id/compare/:otherId')
  compare(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('otherId', ParseUUIDPipe) otherId: string,
    @Query('source') source?: string,
  ) {
    return this.svc.compare(id, otherId, source);
  }

  @Get(':id/compare/:otherId/export.docx')
  async docx(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('otherId', ParseUUIDPipe) otherId: string,
    @Query('source') source: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.svc.compareDocx(id, otherId, source);
    res.set({ 'Content-Type': DOCX, 'Content-Disposition': attachment(f.fileName) });
    return new StreamableFile(f.buffer);
  }

  @Get(':id/compare/:otherId/export.csv')
  async csv(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('otherId', ParseUUIDPipe) otherId: string,
    @Query('source') source: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.svc.compareCsv(id, otherId, source);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': attachment(f.fileName) });
    return new StreamableFile(Buffer.from(f.csv, 'utf8'));
  }
}
