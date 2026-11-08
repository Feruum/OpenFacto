import { spawn } from 'node:child_process';
import { mkdir, writeFile, open, readFile, readdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { localEnvironment } from './latency-local-env.mjs';

// Starts only after the frozen engine run and final build. Existing local
// supervisor must be stopped first. No persistent .env settings are modified.
const root = fileURLToPath(new URL('../', import.meta.url));
const ids = (process.argv[2] || 'A,B,Q').split(',');
assert.ok(ids.length && ids.every(id => ['A','B','C','D','Q'].includes(id)));
const variants = { A: { compact: '0', effort: '' }, B: { compact: '1', effort: '' },
  C: { compact: '1', effort: 'low' }, D: { compact: '1', effort: 'none' },
  Q: { compact: '0', effort: '', modelVariant: 'A', arm: 'queue-enabled', immediate: '1' } };
const base = { ...localEnvironment(), NODE_ENV: 'development', LOCAL_DEMO_ENABLED: '1',
  API_HOST: '127.0.0.1', API_PORT: '53000', MINI_APP_ORIGIN: 'http://127.0.0.1:55173',
  VITE_API_BASE_URL: 'http://127.0.0.1:53000', VITE_LOCAL_DEMO: '1', AI_RESPONSE_CACHE: '0',
  AI_CHAT_MODEL: 'gpt-6-luna', AI_COMBINED_PLANNING: '1' };
let state = 20261108;
const plan = Array.from({ length: 3 }, (_, i) => {
  const block = ids.map(variant => ({ variant, repeat: i + 1 }));
  for (let j = block.length - 1; j > 0; j--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const k = Math.floor(state / 4294967296 * (j + 1));
    [block[j], block[k]] = [block[k], block[j]];
  }
  return block;
}).flat();
const folder = path.join(root, 'output/latency');
await mkdir(folder, { recursive: true });
async function runtimeFiles() {
  const files = [];
  for (const directory of ['apps/api/dist', 'apps/worker/dist', 'packages/answer-engine/dist',
    'packages/database/dist', 'apps/mini-app/src']) {
    const entries = await readdir(path.join(root, directory), { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || directory.endsWith('/dist') && !entry.name.endsWith('.js')) continue;
      const filename = path.join(entry.parentPath, entry.name);
      files.push([path.relative(root, filename).replaceAll('\\', '/'),
        createHash('sha256').update(await readFile(filename)).digest('hex')]);
    }
  }
  // Vite serves source directly; include its entry/config and dependency manifests.
  for (const filename of ['apps/mini-app/index.html', 'apps/mini-app/vite.config.ts', 'pnpm-lock.yaml',
    'pnpm-workspace.yaml', 'package.json', 'apps/api/package.json', 'apps/worker/package.json',
    'apps/mini-app/package.json', 'packages/answer-engine/package.json', 'packages/database/package.json']) {
    files.push([filename, createHash('sha256').update(await readFile(path.join(root, filename))).digest('hex')]);
  }
  return files.sort(([left], [right]) => left.localeCompare(right));
}
const builds = await runtimeFiles();
const runtimeSha256 = createHash('sha256').update(JSON.stringify(builds)).digest('hex');
async function assertFrozenRuntime(phase) {
  const current = await runtimeFiles();
  const sha256 = createHash('sha256').update(JSON.stringify(current)).digest('hex');
  if (sha256 !== runtimeSha256) {
    const expected = new Map(builds), actual = new Map(current);
    const changed = [...new Set([...expected.keys(), ...actual.keys()])].filter(file => expected.get(file) !== actual.get(file));
    throw new Error('Frozen runtime changed ' + phase + ': ' + changed.join(', '));
  }
}
await writeFile(path.join(folder, 'browser-block-plan.json'), JSON.stringify({ seed: 20261108, plan, variants, builds,
  runtimeSha256, model: 'gpt-6-luna', node: process.version, responseCache: false,
  note: 'Randomized complete variant blocks. Seven fixed cases per block. AI answer cache disabled; provider cache separately observed.' }, null, 2), { flag: 'wx' });
let api, vite;
const handles = [];
async function launch(script, args, env, logfile, cwd = root, ipc = false) {
  const file = await open(path.join(folder, logfile), 'a'); handles.push(file);
  const child = spawn(process.execPath, [path.join(root, script), ...args], { cwd, env, windowsHide: true,
    stdio: ipc ? ['ignore', file.fd, file.fd, 'ipc'] : ['ignore', file.fd, file.fd] });
  child.once('error', () => {});
  return child;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error('Loopback port ' + port + ' is occupied or unavailable; stop the existing service')));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      probe.close(error => error ? reject(error) : resolve());
    });
  });
}
async function recordRuntimeVerification(item, verified, error) {
  const variant = variants[item.variant];
  const arm = variant.arm || item.variant, modelVariant = variant.modelVariant || item.variant;
  const filename = path.join(folder, arm === modelVariant ? '' : arm, `live-browser-${modelVariant}-${item.repeat}.json`);
  let report;
  try { report = JSON.parse(await readFile(filename, 'utf8')); }
  catch (readError) { if (readError.code === 'ENOENT') return; throw readError; }
  report.runtimeVerification = { verified, runtimeSha256, checkedAt: new Date().toISOString(), ...(error ? { error: error.message } : {}) };
  if (!verified) {
    report.status = 'invalid_runtime_change';
    report.errors.push({ name: 'FrozenRuntimeChanged', message: error.message });
  }
  await writeFile(filename + '.tmp', JSON.stringify(report, null, 2) + '\n');
  // The browser runner has exited; no concurrent report writer remains.
  await rename(filename + '.tmp', filename);
}
async function ready(child, url) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Local service exited before ready');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await sleep(250);
  }
  throw new Error('Local service startup timeout');
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (child.connected) child.disconnect(); else child.kill();
  const deadline = Date.now() + 150000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(200);
  if (child.exitCode === null && child.signalCode === null) { child.kill(); throw new Error('Graceful backend shutdown timed out'); }
}
try {
  // Fail before launch if a backend is still reachable; do not mix consumers.
  let existing = false;
  try { await fetch('http://127.0.0.1:53000/health/ready', { signal: AbortSignal.timeout(1000) }); existing = true; } catch {}
  assert.equal(existing, false, 'Stop the owned local supervisor before starting blocks');
  await assertPortFree(53000);
  await assertPortFree(55173);
  await assertFrozenRuntime('before Vite startup');
  vite = await launch('apps/mini-app/node_modules/vite/bin/vite.js', ['--host','127.0.0.1','--port','55173','--strictPort'], base,
    'browser-vite.log', path.join(root, 'apps/mini-app'));
  await ready(vite, 'http://127.0.0.1:55173');
  for (const item of plan) {
    await assertFrozenRuntime('before block ' + item.variant + '/' + item.repeat);
    await assertPortFree(53000);
    const variant = variants[item.variant];
    const env = { ...base, AI_COMPACT_OUTPUT: variant.compact, AI_REASONING_EFFORT: variant.effort,
      AI_IMMEDIATE_DISPATCH: variant.immediate || '0', LATENCY_SAMPLE_ARM: variant.arm || item.variant,
      LATENCY_VARIANT: variant.modelVariant || item.variant, LATENCY_REPEAT: String(item.repeat) };
    api = await launch('apps/api/dist/main.js', [], env, `browser-api-${item.variant}-${item.repeat}.log`, root, true);
    await ready(api, 'http://127.0.0.1:53000/health/ready');
    console.log(JSON.stringify({ event: 'browser_block_started', ...item }));
    const child = spawn(process.execPath, ['apps/mini-app/test/latency-live.browser.mjs'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    const code = await new Promise(resolve => child.once('exit', resolve));
    await stop(api); api = undefined;
    try {
      await assertFrozenRuntime('after block ' + item.variant + '/' + item.repeat);
      await recordRuntimeVerification(item, true);
    } catch (error) {
      await recordRuntimeVerification(item, false, error);
      throw error;
    }
    if (code !== 0) throw new Error('Browser block failed; report preserved, no paid retry');
  }
} finally {
  const stopped = await Promise.allSettled([stop(api), stop(vite)]);
  await Promise.allSettled(handles.map(file => file.close()));
  const failed = stopped.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
}
