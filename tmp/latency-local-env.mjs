import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function localEnvironment(database = 'openfacto_qa') {
  const env = { ...process.env, ...parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')) };
  const inspect = name => JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8', windowsHide: true }))[0];
  const pg = inspect('openfacto-qa-20261107-postgres-1');
  const vars = Object.fromEntries(pg.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0,i), value.slice(i+1)]; }));
  const url = new URL('postgres://127.0.0.1');
  url.port = pg.NetworkSettings.Ports['5432/tcp'][0].HostPort;
  url.username = vars.POSTGRES_USER; url.password = vars.POSTGRES_PASSWORD; url.pathname = '/' + database;
  env.DATABASE_URL = url.href;
  const rabbit = inspect('openfacto-qa-20261107-rabbitmq-1');
  const rv = Object.fromEntries(rabbit.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0,i),value.slice(i+1)]; }));
  const ru = new URL('amqp://127.0.0.1'); ru.port = rabbit.NetworkSettings.Ports['5672/tcp'][0].HostPort;
  ru.username = rv.RABBITMQ_DEFAULT_USER; ru.password = rv.RABBITMQ_DEFAULT_PASS;
  env.RABBITMQ_URL = ru.href;
  env.QDRANT_URL = 'http://127.0.0.1:56333'; env.S3_ENDPOINT = 'http://127.0.0.1:59000';
  env.AI_CHAT_MODEL = 'gpt-6-luna';
  return env;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [db, script, ...args] = process.argv.slice(2);
  const child = spawn(process.execPath, [script, ...args], { env: localEnvironment(db), stdio: 'inherit', windowsHide: true });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
