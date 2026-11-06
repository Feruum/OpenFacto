import 'reflect-metadata';
import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '@openfacto/logger';
import { HealthController } from '../src/health/health.controller.js';
import { DEPENDENCY_CHECKS, HealthService } from '../src/health/health.service.js';
import { configureHttp } from '../src/http.js';
import { injectHttp } from './http-inject.js';

@Controller('test')
class TestController { @Get('error') error() { throw new Error('SECRET'); } }

describe('real Nest HTTP router with an in-memory transport', () => {
  let app: INestApplication;
  afterEach(async () => { await app?.close(); });
  async function setup(failed?: 'postgres' | 'redis') {
    const check = (name: string) => async () => { if (failed === name) throw new Error('SECRET'); };
    const module = await Test.createTestingModule({
      controllers: [HealthController, TestController],
      providers: [HealthService, { provide: DEPENDENCY_CHECKS, useValue: { postgres: check('postgres'), redis: check('redis') } }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await configureHttp(app, 'http://localhost:5173', createLogger('test', 'error', () => {}));
  }
  it('keeps health paths outside /api/v1 and business errors inside its prefix', async () => {
    await setup();
    expect(await injectHttp(app, '/health/live')).toMatchObject({ status: 200, body: { status: 'ok' } });
    expect(await injectHttp(app, '/health/ready')).toMatchObject({ status: 200, body: { status: 'ok', dependencies: { postgres: 'up', redis: 'up' } } });
    expect(await injectHttp(app, '/api/v1/health/live')).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
  });
  it.each(['postgres', 'redis'] as const)('returns 503 for %s failure while liveness remains 200', async (failed) => {
    await setup(failed);
    expect((await injectHttp(app, '/health/live')).status).toBe(200);
    const response = await injectHttp(app, '/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'unavailable', dependencies: { [failed]: 'down' } });
    expect(JSON.stringify(response.body)).not.toContain('SECRET');
  });
  it('creates its own request ID and hides internal exceptions', async () => {
    await setup();
    const first = await injectHttp(app, '/api/v1/test/error', { 'x-request-id': 'untrusted' });
    expect(first.status).toBe(500);
    expect(first.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: first.headers['x-request-id'] });
    expect(first.body.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.stringify(first.body)).not.toContain('SECRET');
    expect((await injectHttp(app, '/missing')).headers['x-request-id']).not.toBe(first.headers['x-request-id']);
  });
  it('applies exact-origin CORS and disables response caching', async () => {
    await setup();
    const response = await injectHttp(app, '/health/live', { origin: 'http://localhost:5173' });
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
