import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ProgramsService } from './programs.service.js';

@Controller('programs')
export class ProgramsController {
  constructor(private readonly service: ProgramsService) {}

  @Post('analyze')
  @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: 20 * 1024 * 1024, files: 20 } }))
  analyze(@UploadedFiles() files: { originalname: string; buffer: Buffer; size: number }[], @Body() body: { referenceSlots?: string; referenceTimetableId?: string; referenceOverrides?: string }) {
    let slots: string[] | undefined;
    if (body?.referenceSlots) {
      try { slots = JSON.parse(body.referenceSlots) as string[]; }
      catch { throw new BadRequestException('Créneaux de référence invalides.'); }
      if (!Array.isArray(slots) || slots.length !== 6 || slots.some((slot) => typeof slot !== 'string')) throw new BadRequestException('Six créneaux de référence sont attendus.');
    }
    let overrides: Record<number, Record<number, string>> | undefined;
    if (body?.referenceOverrides) {
      try { overrides = JSON.parse(body.referenceOverrides) as Record<number, Record<number, string>>; }
      catch { throw new BadRequestException('Surcharges de créneaux de référence invalides.'); }
      if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.entries(overrides).some(([index, value]) => !/^[0-5]$/u.test(index) || !value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([day, label]) => !/^[0-5]$/u.test(day) || typeof label !== 'string' || label.length > 80))) throw new BadRequestException('Surcharges de créneaux de référence invalides.');
    }
    return this.service.analyze(files, slots, body?.referenceTimetableId, overrides);
  }

  @Post() save(@Body() body: unknown) { return this.service.save(body); }
  @Get() list() { return this.service.list(); }
  @Get('aliases') aliases() { return this.service.listAliases(); }
  @Post('aliases') saveAlias(@Body() body: unknown) { return this.service.saveAlias(body); }
  @Delete('aliases/:kind/:id') deleteAlias(@Param('kind') kind: string, @Param('id', ParseIntPipe) id: number) { return this.service.deleteAlias(kind, id); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.service.get(id); }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.service.remove(id); }
}
