import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
let runtime;
let output = '';
const compilerPath = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const compiler = spawn(process.execPath, [compilerPath, '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'], { stdio: ['inherit', 'pipe', 'inherit'] });
compiler.stdout.on('data', (data) => {
  process.stdout.write(data);
  output = (output + data.toString()).slice(-2048);
  if (!runtime && output.includes('Found 0 errors.')) {
    runtime = spawn(process.execPath, ['--env-file-if-exists=../../.env', '--watch', 'dist/main.js'], { stdio: 'inherit' });
  }
});
function stop() { compiler.kill('SIGTERM'); runtime?.kill('SIGTERM'); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
compiler.once('exit', (code) => { runtime?.kill('SIGTERM'); process.exitCode = code ?? 0; });
