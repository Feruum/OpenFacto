import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../apps/mini-app/dist/', import.meta.url);
let files = 0;
async function inspect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(item.name + (item.isDirectory() ? '/' : ''), directory);
    if (item.isDirectory()) { await inspect(path); continue; }
    if (!/\.(js|html|css|map)$/.test(item.name)) continue;
    files += 1;
    const content = await readFile(path, 'utf8');
    assert.ok(!/DATABASE_URL|REDIS_URL|S3_SECRET_ACCESS_KEY|MANAGER_BOT_TOKEN|OBSERVE_APP_SECRET|CREDENTIALS_MASTER_KEY|JWT_SIGNING_KEY|postgres(?:ql)?:\/\//i.test(content), `Server configuration in SPA asset ${item.name}`);
    for (const key of ['S3_SECRET_ACCESS_KEY', 'MANAGER_BOT_TOKEN', 'JWT_SIGNING_KEY', 'CREDENTIALS_MASTER_KEY']) {
      if (process.env[key]) assert.ok(!content.includes(process.env[key]), `Secret value in SPA asset ${item.name}`);
    }
  }
}
await inspect(root);
assert.ok(files > 0, 'Build the SPA first');
console.log(`Inspected ${files} SPA assets: server secret markers absent.`);
