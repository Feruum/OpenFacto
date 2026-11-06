import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigurationError, parseApiEnv } from '@openfacto/config';
import { createLogger } from '@openfacto/logger';
import { AppModule } from './app.module.js';
import { configureHttp } from './http.js';
const fallbackLogger = createLogger('api');
try {
  const config = parseApiEnv(process.env);
  const logger = createLogger('api', config.logLevel);
  const app = await NestFactory.create(AppModule.register(config), { logger: {
    log: () => logger.info('nest.lifecycle'), error: () => logger.error('nest.error'),
    warn: () => logger.warn('nest.warning'), debug: () => logger.debug('nest.debug'), verbose: () => {},
  } });
  await configureHttp(app, config.miniAppOrigin, logger);
  await app.listen(config.port, config.host);
  logger.info('api.listening', { host: config.host, port: config.port });
} catch (error) {
  fallbackLogger.error('api.start_failed', { variables: error instanceof ConfigurationError ? error.variables : undefined });
  process.exitCode = 1;
}
