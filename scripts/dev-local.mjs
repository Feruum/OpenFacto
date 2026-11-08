import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureLocalSemantic } from './local-semantic.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const apiPort = process.env.LOCAL_API_PORT || '53000';
const appPort = process.env.LOCAL_APP_PORT || '55173';
for (const port of [apiPort, appPort]) {
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Invalid local port');
}
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL || '').hostname)) {
  throw new Error('dev:local requires a local DATABASE_URL');
}
for (const file of ['apps/api/dist/main.js', 'apps/worker/dist/runtime.js']) {
  if (!existsSync(path.join(root, file))) throw new Error('Run pnpm build first');
}
const env = { ...process.env, NODE_ENV: 'development', LOCAL_DEMO_ENABLED: '1',
  API_HOST: '127.0.0.1', API_PORT: apiPort, MINI_APP_ORIGIN: `http://127.0.0.1:${appPort}`,
  VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}`, VITE_LOCAL_DEMO: '1' };
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.connected) child.disconnect();
    else child.kill();
  }
  // Allow bounded AI calls and active jobs to drain, including on Windows.
  const force = setTimeout(() => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 150_000);
  force.unref();
}
function start(file, args = [], cwd = root, backend = false) {
  const child = spawn(process.execPath, [path.join(root, file), ...args], {
    cwd, env, stdio: backend ? ['inherit','inherit','inherit','ipc'] : 'inherit', windowsHide: true,
  });
  children.push(child);
  child.once('error', () => { console.error('Local service failed to start'); stop(1); });
  child.once('exit', code => { if (!stopping) stop(code || 1); });
}
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
const semantic = await ensureLocalSemantic(root, env, stop);
if (semantic) children.push(semantic);
start('apps/api/dist/main.js', [], root, true);
start('apps/mini-app/node_modules/vite/bin/vite.js', ['--host', '127.0.0.1', '--port', appPort, '--strictPort'], path.join(root, 'apps/mini-app'));
console.log(`Local OpenFacto: http://127.0.0.1:${appPort}`);
