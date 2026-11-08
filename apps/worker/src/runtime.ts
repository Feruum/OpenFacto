import { createRabbitTransport, FOUNDATION_QUEUE } from '@openfacto/queue';
import type { WorkerConfig } from '@openfacto/config';
import { createLogger } from '@openfacto/logger';
import { processFoundationJob } from './processor.js';
import { businessWorkers } from './business.js';

/** In-process background jobs. The backend owns startup, signals and shutdown. */
export async function startBackgroundJobs(config: WorkerConfig): Promise<() => Promise<void>> {
  const logger = createLogger('background-jobs', config.logLevel);
  const transport = createRabbitTransport({ url: config.rabbitmqUrl,
    connectTimeoutMs: config.dependencyTimeoutMs, shutdownTimeoutMs: 10000,
    onError: () => logger.error('jobs.transport_error'),
  });
  transport.consume(FOUNDATION_QUEUE, async job => {
    await processFoundationJob({ name: job.name, data: { requestId: job.data.id } });
    logger.info('jobs.completed', { jobId: job.data.id });
  }, { concurrency: 1 });
  const product = businessWorkers(transport, config.databaseUrl, config.concurrency,
    () => logger.error('jobs.product_task_failed'));
  try { await transport.start(); product.start(); }
  catch (error) {
    product.stopSweeps();
    await transport.close(); await product.close();
    throw error;
  }
  logger.info('jobs.ready', { queue: 'ai.questions' });
  let stopping: Promise<void> | undefined;
  return () => stopping ??= (async () => {
    product.stopSweeps();
    await transport.close(); await product.close();
    logger.info('jobs.stopped');
  })();
}
