import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
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

  // ----- export profiles -------------------------------------------------------------------

  @Get('export-profiles') listProfiles() {
    return this.settings.listProfiles();
  }

  @Post('export-profiles') async createProfile(@Body() body: { name?: string; options?: Partial<ExportOptions> }) {
    try {
      return await this.settings.createProfile(body?.name ?? '', body?.options);
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
  }

  @Put('export-profiles/:id') async updateProfile(
    @Param('id') id: string,
    @Body() body: { name?: string; options?: Partial<ExportOptions>; isDefault?: boolean },
  ) {
    try {
      return await this.settings.updateProfile(id, body ?? {});
    } catch (e: any) {
      if (e.status === 404) throw e;
      throw new BadRequestException(e.message);
    }
  }

  @Delete('export-profiles/:id') async deleteProfile(@Param('id') id: string) {
    try {
      return await this.settings.deleteProfile(id);
    } catch (e: any) {
      if (e.status === 404) throw e;
      throw new BadRequestException(e.message);
    }
  }

  @Get('export-profiles/:id/options') async profileOptions(@Param('id') id: string) {
    return this.settings.getProfileOptions(id);
  }
}
