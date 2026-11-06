import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './index.js';
const url = process.env.DATABASE_URL;
function validUrl(value: string | undefined): value is string {
  try {
    const parsed = new URL(value ?? '');
    return ['postgres:', 'postgresql:'].includes(parsed.protocol) && Boolean(parsed.hostname) && parsed.port !== '0';
  } catch { return false; }
}
if (!validUrl(url)) {
  console.error('Invalid configuration: DATABASE_URL. See .env.example.');
  process.exit(1);
}
let database: ReturnType<typeof createDatabase> | undefined;
try {
  database = createDatabase(url, 10000);
  await migrate(database.db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  console.log('Database migrations applied.');
} catch {
  console.error('Database migration failed. Check connectivity and migration SQL; credentials are not logged.');
  process.exitCode = 1;
} finally { await database?.close(); }
