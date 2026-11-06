import { describe, expect, it } from 'vitest';
import { ConfigurationError, parseApiEnv, parseWorkerEnv, redisConnection } from '../src/index.js';
const env = { DATABASE_URL: 'postgresql://user:SECRET@localhost/test', REDIS_URL: 'redis://localhost:6379/0' };
describe('configuration boundary', () => {
  it('reports missing variables together without exposing credentials', () => {
    expect(() => parseApiEnv({})).toThrow('DATABASE_URL, REDIS_URL');
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
  it('validates queue concurrency and Redis DB numbers', () => {
    expect(() => parseWorkerEnv({ ...env, WORKER_CONCURRENCY: '100' })).toThrow('WORKER_CONCURRENCY');
    expect(() => parseApiEnv({ ...env, REDIS_URL: 'redis://localhost/not-a-db' })).toThrow('REDIS_URL');
    expect(redisConnection('rediss://user:p%40ss@localhost:6380/2')).toMatchObject({ host: 'localhost', port: 6380, username: 'user', password: 'p@ss', db: 2, tls: {} });
  });
});
