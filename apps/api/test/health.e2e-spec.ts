import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createLogger } from '@openfacto/logger';
import { HealthController } from '../src/health/health.controller.js';
import { DEPENDENCY_CHECKS, HealthService } from '../src/health/health.service.js';
import { configureHttp } from '../src/http.js';
@Controller('test')
class TestController { @Get('error') error() { throw new Error('SECRET'); } }
describe('HTTP boundary (mock dependencies)', () => {
  let app: INestApplication;
  afterEach(async () => { await app?.close(); });
  async function setup(failed?: 'postgres' | 'rabbitmq') {
    const check = (name: string) => async () => { if (failed === name) throw new Error('SECRET'); };
    const fixture = await Test.createTestingModule({ controllers: [HealthController, TestController], providers: [HealthService,
      { provide: DEPENDENCY_CHECKS, useValue: { postgres: check('postgres'), rabbitmq: check('rabbitmq') } }] }).compile();
    app = fixture.createNestApplication({ logger: false });
    await configureHttp(app, 'http://localhost:5173', createLogger('test', 'error', () => {}));
    return request(app.getHttpServer());
  }
  it('exposes liveness and readiness without the business prefix', async () => {
    const http = await setup();
    await http.get('/health/live').expect(200, { status: 'ok' });
    await http.get('/health/ready').expect(200, { status: 'ok', dependencies: { postgres: 'up', rabbitmq: 'up' } });
    await http.get('/api/v1/health/live').expect(404);
  });
  it.each(['postgres', 'rabbitmq'] as const)('keeps liveness while %s is unavailable', async (name) => {
    const http = await setup(name);
    await http.get('/health/live').expect(200);
    const response = await http.get('/health/ready').expect(503);
    expect(response.body.dependencies[name]).toBe('down');
  });
  it('normalizes errors, generates request IDs, and hides internal details', async () => {
    const http = await setup();
    const response = await http.get('/api/v1/test/error').set('x-request-id', 'untrusted').expect(500);
    expect(response.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: response.headers['x-request-id'] });
    expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.text).not.toContain('SECRET');
    await http.get('/missing').expect(404);
  });
  it('allows the configured SPA origin', async () => {
    const http = await setup();
    const response = await http.get('/health/live').set('Origin', 'http://localhost:5173').expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
  it('applies the small JSON body limit outside the dedicated PDF upload route', async () => {
    const http = await setup();
    const result = await http.post('/api/v1/test').send({value:'x'.repeat(105_000)}).expect(413);
    expect(result.body.code).toBe('VALIDATION_ERROR');
  });
});
