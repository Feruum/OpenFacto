import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export async function ensureLocalSemantic(root, env, onExit) {
  if (!env.EMBEDDING_URL) return undefined;
  const endpoint = new URL(env.EMBEDDING_URL);
  if (endpoint.hostname !== '127.0.0.1' || endpoint.port !== '7312') return undefined;
  async function ready() {
    let response;
    try { response = await fetch(new URL('/health', endpoint), { signal: AbortSignal.timeout(1500) }); }
    catch { return false; }
    if (!response.ok) throw new Error('Existing semantic service is unhealthy');
    const data = await response.json();
    if (data.model !== env.EMBEDDING_MODEL || data.revision !== env.EMBEDDING_REVISION) throw new Error('Semantic model does not match .env');
    return true;
  }
  if (await ready()) return undefined;
  const python = path.join(root, 'apps/semantic-worker/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python)) throw new Error('Run uv sync --project apps/semantic-worker and prepare models first');
  const profile = env.LOCAL_EMBEDDING_PROFILE;
  if (!['e5', 'minilm'].includes(profile)) throw new Error('Invalid local embedding profile');
  const child = spawn(python, ['-u', path.join(root, 'apps/semantic-worker/server.py'), '--model', profile], {
    cwd: root, env: { ...env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }, stdio: 'inherit', windowsHide: true,
  });
  let spawnError;
  child.once('error', error => { spawnError = error; });
  try {
    const until = Date.now() + 120_000;
    while (!(await ready())) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || Date.now() > until) throw new Error('Local semantic service failed to start');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) { child.kill(); throw error; }
  child.once('exit', code => onExit(code || 1));
  return child;
}
