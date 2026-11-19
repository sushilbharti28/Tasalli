import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/decorators';
import { Db } from '../db/db.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: Db) {}

  @Public()
  @Get()
  async health() {
    try {
      await this.db.query('select 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
    return { status: 'ok', db: 'up' };
  }
}
