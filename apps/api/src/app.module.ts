import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { ApiConfig } from '@openfacto/config';
import { HealthController } from './health/health.controller.js';
import { HealthService, DEPENDENCY_CHECKS } from './health/health.service.js';
import { HealthDependencies } from './health/dependencies.js';
@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return { module: AppModule, controllers: [HealthController], providers: [HealthService,
      { provide: DEPENDENCY_CHECKS, useFactory: () => new HealthDependencies(config) }] };
  }
}
