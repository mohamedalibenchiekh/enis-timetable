import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../entities/timetable.entity';
import { ExportOptions, mergeOptions } from '../export/options';

@Injectable()
export class SettingsService {
  constructor(@InjectRepository(Setting) private repo: Repository<Setting>) {}

  async getExportOptions(): Promise<ExportOptions> {
    const row = await this.repo.findOneBy({ key: 'export' });
    return mergeOptions(row?.value);
  }

  async setExportOptions(value: Partial<ExportOptions>): Promise<ExportOptions> {
    const merged = mergeOptions(value);
    for (const b of merged.blocs) {
      for (const p of b.patterns) new RegExp(p); // throws on invalid pattern → 500, caught by controller
    }
    await this.repo.save({ key: 'export', value: merged });
    return merged;
  }
}
