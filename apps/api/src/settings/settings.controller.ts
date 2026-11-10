import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { ExportOptions } from '../export/options.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get('export') get() {
    return this.settings.getExportOptions();
  }

  @Put('export') async put(@Body() body: Partial<ExportOptions>) {
    try {
      return await this.settings.setExportOptions(body);
    } catch (e: any) {
      throw new BadRequestException(`Options invalides : ${e.message}`);
    }
  }
}
