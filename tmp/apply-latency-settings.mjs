import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import assert from 'node:assert/strict';

const filename = new URL('../.env', import.meta.url);
const original = await readFile(filename, 'utf8');
const parsed = parseEnv(original);
const settings = { AI_CHAT_MODEL: 'gpt-6-luna', AI_REASONING_EFFORT: '',
  AI_COMPACT_OUTPUT: '0', AI_IMMEDIATE_DISPATCH: '1' };
const report = { changedAt: new Date().toISOString(),
  reason: 'Keep original prompt/default effort after quality regressions; enable measured queue delivery improvement.',
  previous: Object.fromEntries(Object.keys(settings).map(key => [key, parsed[key] ?? null])), selected: settings };
// Only non-secret policy settings are written into the rollback artifact.
await writeFile(new URL('../output/latency/selected-settings.json', import.meta.url), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
let updated = original;
const newline = original.includes('\r\n') ? '\r\n' : '\n';
for (const [key, value] of Object.entries(settings)) {
  const pattern = new RegExp('^' + key + '=.*$', 'm');
  updated = pattern.test(updated) ? updated.replace(pattern, key + '=' + value) : updated + newline + key + '=' + value + newline;
}
const effective = parseEnv(updated);
for (const [key, value] of Object.entries(settings)) assert.equal(effective[key], value, 'Ambiguous policy setting: ' + key);
await writeFile(filename, updated);
console.log('Selected gpt-6-luna, original prompt, omitted effort, immediate dispatch; budget and secrets preserved.');
