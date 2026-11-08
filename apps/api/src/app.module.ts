import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { ApiConfig, WorkerConfig } from '@openfacto/config';
import { BackgroundJobs, JOBS_CONFIG } from './background-jobs.js';
import { HealthController } from './health/health.controller.js';
import { HealthService, DEPENDENCY_CHECKS } from './health/health.service.js';
import { HealthDependencies } from './health/dependencies.js';
import { ProductAccess, PRODUCT } from './product/access.js';
import { OrganizationsController } from './product/organizations.controller.js';
import { EventsController } from './product/events.controller.js';
import { EvaluationController } from './product/evaluation.controller.js';
import { SourcesController } from './product/sources.controller.js';
import { BotsController, WebhookController } from './product/bots.controller.js';
import { LocalDemoController, LOCAL_DEMO_CONFIG, localDemoEnabled } from './product/local-demo.controller.js';
@Module({})
export class AppModule {
  static register(config: ApiConfig, jobs?: WorkerConfig): DynamicModule {
    const local = localDemoEnabled(config, process.env.LOCAL_DEMO_ENABLED);
    return { module: AppModule, controllers: [HealthController,OrganizationsController,EventsController,SourcesController,BotsController,WebhookController,EvaluationController,
      ...(local ? [LocalDemoController] : [])], providers: [HealthService,
      ...(jobs ? [BackgroundJobs, { provide: JOBS_CONFIG, useValue: jobs }] : []),
      ...(local ? [{ provide: LOCAL_DEMO_CONFIG, useValue: config }] : []),
      { provide: PRODUCT, useFactory: () => new ProductAccess(config.databaseUrl) },
      { provide: DEPENDENCY_CHECKS, useFactory: () => new HealthDependencies(config) }] };
  }
}
