import { Worker, type Job } from 'bullmq';
import { ConfigurationError, parseWorkerEnv, redisConnection } from '@openfacto/config';
import { createLogger } from '@openfacto/logger';
import { FOUNDATION_QUEUE, processFoundationJob } from './processor.js';
const fallbackLogger = createLogger('worker');
try {
  const config = parseWorkerEnv(process.env);
  const logger = createLogger('worker', config.logLevel);
  const worker = new Worker(FOUNDATION_QUEUE, processFoundationJob, {
    connection: { ...redisConnection(config.redisUrl), maxRetriesPerRequest: null },
    concurrency: config.concurrency, autorun: false,
  });
  worker.on('error', () => logger.error('worker.connection_error'));
  worker.on('failed', (job: Job | undefined) => logger.error('worker.job_failed', { jobId: job?.id }));
  worker.on('completed', (job: Job) => logger.info('worker.job_completed', { jobId: job.id }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([worker.waitUntilReady(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Worker startup timed out')), config.dependencyTimeoutMs);
    })]);
  } catch {
    await worker.close(true);
    throw new Error('Worker dependency unavailable');
  } finally { clearTimeout(timer); }
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const force = setTimeout(() => { logger.error('worker.shutdown_timeout'); process.exit(1); }, 10000);
    force.unref();
    await worker.close();
    clearTimeout(force);
    logger.info('worker.stopped');
  };
  const onSignal = () => { void shutdown().catch(() => {
    logger.error('worker.shutdown_failed');
    process.exitCode = 1;
  }); };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  logger.info('worker.ready', { queue: FOUNDATION_QUEUE });
  await worker.run();
} catch (error) {
  fallbackLogger.error('worker.start_failed', { variables: error instanceof ConfigurationError ? error.variables : undefined });
  process.exitCode = 1;
}
