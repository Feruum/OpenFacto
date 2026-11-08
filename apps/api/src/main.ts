import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigurationError, parseApiEnv, parseWorkerEnv } from '@openfacto/config';
import type { INestApplication } from '@nestjs/common';
import { createLogger } from '@openfacto/logger';
import { AppModule } from './app.module.js';
import { configureHttp } from './http.js';
const fallbackLogger = createLogger('api');
let app: INestApplication | undefined;
try {
  const config = parseApiEnv(process.env);
  const jobs = parseWorkerEnv(process.env);
  const logger = createLogger('api', config.logLevel);
  app = await NestFactory.create(AppModule.register(config, jobs), { logger: {
    log: () => logger.info('nest.lifecycle'), error: () => logger.error('nest.error'),
    warn: () => logger.warn('nest.warning'), debug: () => logger.debug('nest.debug'), verbose: () => {},
  } });
  app.enableShutdownHooks();
  // Windows test/dev supervisors can request the same graceful lifecycle via IPC.
  if (process.connected) process.once('disconnect', () => {
    void app!.close().catch(() => { process.exitCode = 1; });
  });
  await configureHttp(app, config.miniAppOrigin, logger);
  await app.listen(config.port, config.host);
  logger.info('api.listening', { host: config.host, port: config.port });
} catch (error) {
  await app?.close();
  fallbackLogger.error('api.start_failed', { variables: error instanceof ConfigurationError ? error.variables : undefined });
  process.exitCode = 1;
}
