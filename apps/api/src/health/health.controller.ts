import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { LiveResponse, ReadyResponse } from '@openfacto/contracts';
import { HealthService } from './health.service.js';
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}
  @Get('live')
  live(): LiveResponse { return { status: 'ok' }; }
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadyResponse> {
    const result = await this.health.ready();
    response.status(result.status === 'ok' ? 200 : 503);
    return result;
  }
}
