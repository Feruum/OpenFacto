import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { WorkerConfig } from '@openfacto/config';
import { startBackgroundJobs } from '@openfacto/worker/runtime';

export const JOBS_CONFIG = Symbol('jobs-config');

@Injectable()
export class BackgroundJobs implements OnApplicationBootstrap, OnModuleDestroy {
  private stop?: () => Promise<void>;
  constructor(@Inject(JOBS_CONFIG) private readonly config: WorkerConfig) {}
  async onApplicationBootstrap() {
    this.stop = await startBackgroundJobs(this.config);
  }
  async onModuleDestroy() {
    await this.stop?.();
  }
}
