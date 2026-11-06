/** Explicit local acceptance command. Mutates only disposable fixtures in the openfacto project. */
import { spawnSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
const cwd = new URL('../', import.meta.url);
for (const key of ['DATABASE_URL', 'REDIS_URL', 'QDRANT_URL', 'S3_ENDPOINT']) {
  assert.ok(process.env[key], `${key} is required in .env`);
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(process.env[key]).hostname), `${key} must point to local infrastructure`);
}
const apiBase = `http://127.0.0.1:${process.env.API_PORT ?? 3000}`;
const qdrantBase = process.env.QDRANT_URL;
for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
  assert.ok(process.env[key], `${key} is required in .env`);
}
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', env: process.env });
  assert.equal(result.status, 0, `${command} failed`);
  return result.stdout?.trim();
}
async function health(status) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const live = await fetch(`${apiBase}/health/live`, { signal: AbortSignal.timeout(3000) });
      const ready = await fetch(`${apiBase}/health/ready`, { signal: AbortSignal.timeout(4000) });
      if (live.status === 200 && ready.status === status) return;
    } catch { /* Wait for the expected dependency transition. */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Expected live=200 and ready=${status}`);
}
async function qdrant(path, method = 'GET', body) {
  const response = await fetch(`${qdrantBase}${path}`, { method,
    headers: { 'content-type': 'application/json', connection: 'close' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  assert.ok(response.ok, `Qdrant ${method} failed with ${response.status}`);
  return response.json();
}
function sql(statement) {
  return run('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-ec', 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"', '--', statement]);
}
function infraUp() {
  run('docker', ['compose', 'up', '-d', '--wait']);
}
const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { cwd, encoding: 'utf8' });
assert.equal(docker.status, 0, 'Docker is not accessible to this user. This script does not elevate privileges or request passwords.');
infraUp();
run('pnpm', ['build']);
run('pnpm', ['db:migrate']);
run('pnpm', ['db:migrate']);
run('pnpm', ['test:integration']);
run('pnpm', ['test:e2e']);
run('pnpm', ['python:test:integration']);
const api = spawn(process.execPath, ['--env-file-if-exists=.env', 'apps/api/dist/main.js'], { cwd, stdio: 'inherit' });
const marker = `foundation-${randomUUID()}`;
const collection = marker.replaceAll('-', '_');
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  maxAttempts: 2, requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 } });
const object = { Bucket: process.env.S3_BUCKET, Key: marker };
try {
  await health(200);
  for (const dependency of ['postgres', 'redis']) {
    try {
      run('docker', ['compose', 'stop', dependency]);
      await health(503);
    } finally { run('docker', ['compose', 'up', '-d', '--wait', dependency]); }
    await health(200);
  }
  sql(`INSERT INTO organizations (name) VALUES ('${marker}');`);
  run('docker', ['compose', 'exec', '-T', 'redis', 'redis-cli', 'SET', marker, marker]);
  await qdrant(`/collections/${collection}`, 'PUT', { vectors: { size: 1, distance: 'Cosine' } });
  await qdrant(`/collections/${collection}/points?wait=true`, 'PUT', { points: [{ id: 1, vector: [1], payload: { marker } }] });
  await s3.send(new HeadBucketCommand({ Bucket: object.Bucket }));
  await s3.send(new PutObjectCommand({ ...object, Body: marker }));
  const privateObject = await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${marker}`, { signal: AbortSignal.timeout(3000) });
  assert.equal(privateObject.status, 403, 'S3 object must not be anonymously readable');
  run('docker', ['compose', 'down']); // No -v: all four volumes must survive.
  infraUp();
  sql(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM organizations WHERE name = '${marker}') THEN RAISE EXCEPTION 'Data lost after restart'; END IF; END $$;`);
  assert.equal(run('docker', ['compose', 'exec', '-T', 'redis', 'redis-cli', '--raw', 'GET', marker], true), marker);
  const point = await qdrant(`/collections/${collection}/points/1`);
  assert.equal(point.result.payload.marker, marker);
  assert.equal(await (await s3.send(new GetObjectCommand(object))).Body.transformToString(), marker);
  await health(200);
  run('pnpm', ['check:spa']);
  console.log('Foundation acceptance passed: migrations, workers, dependency failures, private S3 and four persistent volumes.');
} finally {
  api.kill('SIGTERM');
  // Best-effort cleanup of fixtures; preserve diagnostics when infrastructure is unavailable.
  for (const [name, cleanup] of [
    ['postgres', () => sql(`DELETE FROM organizations WHERE name = '${marker}';`)],
    ['redis', () => run('docker', ['compose', 'exec', '-T', 'redis', 'redis-cli', 'DEL', marker])],
    ['qdrant', () => qdrant(`/collections/${collection}`, 'DELETE')],
    ['s3', () => s3.send(new DeleteObjectCommand(object))],
  ]) {
    try { await cleanup(); } catch { console.error(`Fixture cleanup incomplete for ${name}.`); }
  }
  s3.destroy();
}
