import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './auth/auth';
import { Database } from './infrastructure/database/database.service';

/** `live` : le processus répond (redémarrage si non). `ready` : la base répond (retrait du trafic si non). Aucune donnée sensible. */
@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(private readonly db: Database) {}

  @Get()
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.db.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException({ status: 'database_unavailable' });
    }
  }
}
