type Level = 'debug' | 'info' | 'warn' | 'error';
const priorities: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const secretKey = /authorization|cookie|token|secret|password|initData|api.?key|databaseUrl|redisUrl|rabbitmq_?url|rabbitmq_default_pass|body|prompt|content|stack/i;
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (value instanceof Error) return { name: value.name };
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value.replace(/(?:postgres(?:ql)?|rediss?|amqps?):\/\/[^\s]+/gi, '[redacted-url]').slice(0, 2048);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[redacted]' : sanitize(item, depth + 1)]));
  return value;
}
/** Events must be fixed identifiers. Never log request bodies, URLs or provider messages. */
export function createLogger(service: string, level: Level = 'info', write: (line: string) => void = (line) => process.stdout.write(line)) {
  function log(severity: Level, event: string, fields: Record<string, unknown> = {}) {
    if (priorities[severity] < priorities[level]) return;
    write(JSON.stringify({ ...sanitize(fields) as object, timestamp: new Date().toISOString(), level: severity, service, event }) + '\n');
  }
  return {
    debug: (event: string, fields?: Record<string, unknown>) => log('debug', event, fields),
    info: (event: string, fields?: Record<string, unknown>) => log('info', event, fields),
    warn: (event: string, fields?: Record<string, unknown>) => log('warn', event, fields),
    error: (event: string, fields?: Record<string, unknown>) => log('error', event, fields),
  };
}
export type StructuredLogger = ReturnType<typeof createLogger>;
