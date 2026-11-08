import type { OnModuleDestroy } from '@nestjs/common';
import type { ApiConfig } from '@openfacto/config';
import { createDatabase } from '@openfacto/database';
import type { DependencyChecks } from './health.service.js';
import { probeRabbitMq } from '@openfacto/queue';
export class HealthDependencies implements DependencyChecks, OnModuleDestroy {
  private readonly database;
  constructor(private readonly config: ApiConfig) {
    this.database = createDatabase(config.databaseUrl, config.dependencyTimeoutMs);
  }
  async postgres(): Promise<void> {
    const query = this.database.client`select 1`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([query, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { query.cancel(); reject(new Error('Postgres probe timed out')); }, this.config.dependencyTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  rabbitmq() { return probeRabbitMq(this.config.rabbitmqUrl, this.config.dependencyTimeoutMs); }
  async onModuleDestroy() { await this.database.close(); }
}
