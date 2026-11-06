import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
export * from './schema.js';
export function createDatabase(url: string, timeoutMs = 2000) {
  const client = postgres(url, { max: 5, connect_timeout: Math.ceil(timeoutMs / 1000), idle_timeout: 20,
    connection: { timezone: 'UTC', statement_timeout: timeoutMs }, onnotice: () => {} });
  return { client, db: drizzle(client, { schema }), close: () => client.end({ timeout: 2 }) };
}
export type Database = ReturnType<typeof createDatabase>;
