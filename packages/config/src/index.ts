export interface ServiceConfig {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  redisUrl: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  dependencyTimeoutMs: number;
}
export interface ApiConfig extends ServiceConfig { host: string; port: number; miniAppOrigin: string }
export interface WorkerConfig extends ServiceConfig { concurrency: number }
type Env = Record<string, string | undefined>;
export class ConfigurationError extends Error {
  constructor(public readonly variables: string[]) {
    super(`Invalid configuration: ${variables.join(', ')}. See .env.example.`);
    this.name = 'ConfigurationError';
  }
}
function requiredUrl(env: Env, name: string, protocols: string[], errors: string[]): string {
  const value = env[name] ?? '';
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol) || !url.hostname || url.port === '0' || url.hash) throw new Error();
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch { errors.push(name); }
  return value;
}
function integer(env: Env, key: string, fallback: number, min: number, max: number, errors: string[]) {
  const raw = env[key];
  const value = raw === undefined ? fallback : Number(raw);
  if (raw === '' || !Number.isInteger(value) || value < min || value > max) errors.push(key);
  return value;
}
function service(env: Env, errors: string[]): ServiceConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['development', 'test', 'production'].includes(nodeEnv)) errors.push('NODE_ENV');
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) errors.push('LOG_LEVEL');
  const databaseUrl = requiredUrl(env, 'DATABASE_URL', ['postgres:', 'postgresql:'], errors);
  const redisUrl = requiredUrl(env, 'REDIS_URL', ['redis:', 'rediss:'], errors);
  try {
    const url = new URL(redisUrl);
    if (url.pathname !== '' && url.pathname !== '/' && !/^\/\d+$/.test(url.pathname)) errors.push('REDIS_URL');
    if (url.search || (url.username && !url.password)) errors.push('REDIS_URL');
  } catch { /* Already reported by requiredUrl. */ }
  return { nodeEnv: nodeEnv as ServiceConfig['nodeEnv'], logLevel: logLevel as ServiceConfig['logLevel'], databaseUrl, redisUrl,
    dependencyTimeoutMs: integer(env, 'DEPENDENCY_TIMEOUT_MS', 2000, 100, 10000, errors) };
}
export function parseApiEnv(env: Env): ApiConfig {
  const errors: string[] = [];
  const base = service(env, errors);
  const origin = env.MINI_APP_ORIGIN ?? 'http://localhost:5173';
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || (base.nodeEnv === 'production' && url.protocol !== 'https:')) errors.push('MINI_APP_ORIGIN');
  } catch { errors.push('MINI_APP_ORIGIN'); }
  const port = integer(env, 'API_PORT', 3000, 1, 65535, errors);
  const host = env.API_HOST ?? '127.0.0.1';
  if (!host.trim()) errors.push('API_HOST');
  if (errors.length) throw new ConfigurationError([...new Set(errors)]);
  return { ...base, host, port, miniAppOrigin: origin };
}
export function parseWorkerEnv(env: Env): WorkerConfig {
  const errors: string[] = [];
  const base = service(env, errors);
  const concurrency = integer(env, 'WORKER_CONCURRENCY', 2, 1, 32, errors);
  if (errors.length) throw new ConfigurationError([...new Set(errors)]);
  return { ...base, concurrency };
}
export function redisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0), ...(url.protocol === 'rediss:' ? { tls: {} } : {}) };
}
