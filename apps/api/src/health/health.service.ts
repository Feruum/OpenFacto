import { Inject, Injectable } from '@nestjs/common';
import type { ReadyResponse } from '@openfacto/contracts';
export const DEPENDENCY_CHECKS = Symbol('DEPENDENCY_CHECKS');
export interface DependencyChecks { postgres(): Promise<void>; rabbitmq(): Promise<void> }
@Injectable()
export class HealthService {
  private inFlight: Promise<ReadyResponse> | undefined;
  constructor(@Inject(DEPENDENCY_CHECKS) private readonly checks: DependencyChecks) {}
  ready(): Promise<ReadyResponse> {
    // Coalesce probes during outages so health traffic cannot exhaust the SQL pool.
    this.inFlight ??= this.probe().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
  private async probe(): Promise<ReadyResponse> {
    const result = await Promise.allSettled([this.run('postgres'), this.run('rabbitmq')]);
    return { status: result.every((item) => item.status === 'fulfilled') ? 'ok' : 'unavailable',
      dependencies: { postgres: result[0]?.status === 'fulfilled' ? 'up' : 'down', rabbitmq: result[1]?.status === 'fulfilled' ? 'up' : 'down' } };
  }
  private async run(dependency: keyof DependencyChecks): Promise<void> {
    await this.checks[dependency]();
  }
}
