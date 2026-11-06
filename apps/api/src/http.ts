import { randomUUID } from 'node:crypto';
import { Catch, HttpException, RequestMethod } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter, INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { API_PREFIX } from '@openfacto/contracts';
import type { ApiError, ErrorCode } from '@openfacto/contracts';
import type { StructuredLogger } from '@openfacto/logger';
const errors: Record<number, [ErrorCode, string]> = {
  400: ['VALIDATION_ERROR', 'Invalid request'], 401: ['UNAUTHENTICATED', 'Authentication required'],
  403: ['FORBIDDEN', 'Access denied'], 404: ['NOT_FOUND', 'Resource not found'],
  409: ['CONFLICT', 'Resource conflict'], 429: ['RATE_LIMITED', 'Too many requests'],
  503: ['DEPENDENCY_UNAVAILABLE', 'Service unavailable'],
};
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLogger) {}
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    this.respond(exception, response);
  }
  respond(exception: unknown, response: Response) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const [code, message] = errors[status] ?? ['INTERNAL_ERROR', 'Internal server error'];
    const requestId = String(response.getHeader('x-request-id'));
    if (status >= 500) this.logger.error('http.error', { requestId, status });
    response.status(status).json({ code, message, requestId } satisfies ApiError);
  }
}
export async function configureHttp(app: INestApplication, origin: string, logger: StructuredLogger) {
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const started = performance.now();
    res.setHeader('x-request-id', requestId);
    res.setHeader('cache-control', 'no-store');
    res.once('finish', () => logger.info('http.request', { requestId, status: res.statusCode, durationMs: Math.round(performance.now() - started) }));
    next();
  });
  app.enableCors({ origin, exposedHeaders: ['x-request-id'], credentials: false });
  app.setGlobalPrefix(API_PREFIX.slice(1), { exclude: [
    { path: 'health/live', method: RequestMethod.GET }, { path: 'health/ready', method: RequestMethod.GET },
  ] });
  const filter = new ApiExceptionFilter(logger);
  app.useGlobalFilters(filter);
  app.enableShutdownHooks();
  await app.init();
  // Nest scopes its adapter fallback to the global prefix and excluded health routes.
  // Register a final fallback for requests outside that scope as well.
  app.use((_req: Request, res: Response) => {
    filter.respond(new HttpException('Resource not found', 404), res);
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    filter.respond(error, res);
  });
}
