import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
export * from './schema.js';
export * from './product.js';
export function createDatabase(url: string, timeoutMs = 2000) {
  const options = { max: 5, connect_timeout: Math.ceil(timeoutMs / 1000), idle_timeout: 20,
    connection: { timezone: 'UTC', statement_timeout: timeoutMs }, onnotice: () => {} };
  // Drizzle replaces postgres.js JSONB and timestamp codecs. Keep its lazy pool
  // separate so raw SQL callers can bind objects with sql.json() and read them back.
  const client = postgres(url, options);
  const ormClient = postgres(url, options);
  return { client, db: drizzle(ormClient, { schema }), close: async () => {
    await Promise.all([client.end({ timeout: 2 }), ormClient.end({ timeout: 2 })]);
  } };
}
export type Database = ReturnType<typeof createDatabase>;
