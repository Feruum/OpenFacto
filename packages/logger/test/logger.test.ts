import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/index.js';
describe('structured logs', () => {
  it('redacts RabbitMQ configuration fields and AMQP URLs nested inside arbitrary fields', () => {
    const lines: string[] = [];
    const logger = createLogger('test', 'info', (line) => lines.push(line));
    logger.error('broker.failed', { rabbitmqUrl: 'SECRET', RABBITMQ_URL: 'SECRET', RABBITMQ_DEFAULT_PASS: 'SECRET',
      nested: { details: ['Connect amqp://user:SECRET@localhost:5672/%2f failed', 'AMQPS://user:SECRET@broker.example/team'] } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('SECRET');
    expect(JSON.parse(lines[0]!)).toMatchObject({ rabbitmqUrl: '[redacted]', RABBITMQ_URL: '[redacted]',
      RABBITMQ_DEFAULT_PASS: '[redacted]', nested: { details: ['Connect [redacted-url] failed', '[redacted-url]'] } });
  });
  it('redacts nested secrets, errors and connection URLs', () => {
    const lines: string[] = [];
    const logger = createLogger('test', 'info', (line) => lines.push(line));
    logger.info('test.event', { requestId: 'request-1', nested: { botToken: 'SECRET', apiKey: 'SECRET' }, err: new Error('SECRET'), details: 'postgresql://user:SECRET@localhost/db' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('SECRET');
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'test.event', requestId: 'request-1', service: 'test', level: 'info' });
  });
  it('filters debug and does not allow field overrides or circular logging crashes', () => {
    const lines: string[] = [];
    const logger = createLogger('worker', 'warn', (line) => lines.push(line));
    logger.debug('ignored');
    const circular: Record<string, unknown> = {}; circular.self = circular;
    logger.error('worker.failed', { service: 'spoof', level: 'info', circular });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ service: 'worker', level: 'error' });
  });
});
