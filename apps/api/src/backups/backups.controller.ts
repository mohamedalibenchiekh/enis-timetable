import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { BackupMode, BackupSettings } from './backup-types.js';
import { BackupsService } from './backups.service.js';
import { MaintenanceGuard } from './maintenance.guard.js';

const ENIS_BACKUP_MIME = 'application/octet-stream';
const attachment = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

@Controller('backups')
@UseGuards(MaintenanceGuard)
export class BackupsController {
  constructor(private readonly backupsService: BackupsService) {}

  @Get()
  list() {
    return this.backupsService.listBackups();
  }

  @Post()
  async create(
    @Query('download') downloadQuery: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isDownload = downloadQuery === '1' || downloadQuery === 'true';
    const result = await this.backupsService.createBackup(isDownload);

    if (isDownload) {
      res.set({
        'Content-Type': ENIS_BACKUP_MIME,
        'Content-Disposition': attachment(result.fileName),
      });
      return new StreamableFile(result.buffer);
    }

    return {
      ok: true,
      fileName: result.fileName,
      filePath: result.filePath,
    };
  }

  @Get(':id/download')
  download(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { stream, fileName, size } = this.backupsService.getDownloadStream(id);
    res.set({
      'Content-Type': ENIS_BACKUP_MIME,
      'Content-Disposition': attachment(fileName),
      'Content-Length': String(size),
    });
    return new StreamableFile(stream);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.backupsService.deleteAutoBackup(id);
    return { ok: true };
  }

  @Post('inspect')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 200 * 1024 * 1024 },
    }),
  )
  inspect(
    @UploadedFile() file?: { buffer: Buffer },
    @Body('id') id?: string,
  ) {
    return this.backupsService.inspectBackup({
      fileBuffer: file?.buffer,
      id: id || undefined,
    });
  }

  @Post('restore')
  restore(
    @Body('id') id?: string,
    @Body('uploadToken') uploadToken?: string,
    @Body('mode') mode?: BackupMode,
  ) {
    const safeMode: BackupMode = mode === 'merge' ? 'merge' : 'replace';
    return this.backupsService.restoreBackup({
      id: id || undefined,
      uploadToken: uploadToken || undefined,
      mode: safeMode,
    });
  }

  @Get('settings')
  getSettings() {
    return this.backupsService.getSettings();
  }

  @Put('settings')
  updateSettings(@Body() dto: Partial<BackupSettings>) {
    return this.backupsService.updateSettings(dto);
  }
}

