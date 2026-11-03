import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller('health')
export class HealthController {
  constructor(private ds: DataSource) {}
  @Get() async health() {
    await this.ds.query('select 1');
    return { ok: true };
  }
}
