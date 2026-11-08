import { describe, expect, it } from 'vitest';
import { ConfigurationError, parseApiEnv, parseWorkerEnv } from '../src/index.js';
const env = { DATABASE_URL: 'postgresql://user:SECRET@localhost/test', RABBITMQ_URL: 'amqp://openfacto:local-password@localhost:5672/%2f' };
describe('configuration boundary', () => {
  it('reports missing variables together without exposing credentials', () => {
    expect(() => parseApiEnv({})).toThrow('DATABASE_URL, RABBITMQ_URL');
    try { parseApiEnv({ ...env, DATABASE_URL: 'https://SECRET' }); } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).not.toContain('SECRET');
    }
  });
  it('applies bounded local defaults', () => {
    expect(parseApiEnv(env).port).toBe(3000);
    expect(parseWorkerEnv(env).concurrency).toBe(2);
  });
  it.each(['', '0', '65536', '1.2', 'NaN'])('rejects API_PORT=%s', (API_PORT) => {
    expect(() => parseApiEnv({ ...env, API_PORT })).toThrow('API_PORT');
  });
  it('requires an exact HTTPS origin in production', () => {
    for (const MINI_APP_ORIGIN of ['*', 'https://example.com/path', 'http://example.com']) expect(() => parseApiEnv({ ...env, NODE_ENV: 'production', MINI_APP_ORIGIN })).toThrow('MINI_APP_ORIGIN');
    expect(parseApiEnv({ ...env, NODE_ENV: 'production', MINI_APP_ORIGIN: 'https://app.example.com' }).miniAppOrigin).toBe('https://app.example.com');
  });
  it('validates queue concurrency', () => {
    expect(() => parseWorkerEnv({ ...env, WORKER_CONCURRENCY: '100' })).toThrow('WORKER_CONCURRENCY');
  });
  it.each(['amqp://user:p%40ss@localhost:5672/%2f', 'amqps://user:password@broker.example.com/team'])('accepts AMQP connection URLs: %s', (RABBITMQ_URL) => {
    expect(parseWorkerEnv({ ...env, RABBITMQ_URL }).rabbitmqUrl).toBe(RABBITMQ_URL);
  });
  it.each(['redis://localhost:6379', 'http://SECRET', 'amqp://localhost:0', 'amqp://user:%xx@localhost', 'amqp://localhost/%xx', 'amqp://localhost/#fragment'])('rejects invalid broker URLs without disclosing values: %s', (RABBITMQ_URL) => {
    expect(() => parseApiEnv({ ...env, RABBITMQ_URL })).toThrow('RABBITMQ_URL');
    try { parseApiEnv({ ...env, RABBITMQ_URL }); } catch (error) { expect(String(error)).not.toContain('SECRET'); }
  });
  it.each(['amqp://localhost', 'amqp://guest:guest@localhost', 'amqp://user@localhost'])('requires explicit non-guest production broker credentials: %s', (RABBITMQ_URL) => {
    expect(() => parseApiEnv({ ...env, RABBITMQ_URL, NODE_ENV: 'production', MINI_APP_ORIGIN: 'https://app.example.com' })).toThrow('RABBITMQ_URL');
  });
});
