import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const report = JSON.parse(readFileSync(path.join(root, 'apps/semantic-worker/benchmark-results.json'), 'utf8'));
const lock = JSON.parse(readFileSync(path.join(root, 'apps/semantic-worker/models.lock.json'), 'utf8'));
const selected = lock[report.selectedEmbedding];
if (!selected || !/^[0-9a-f]{40}$/.test(selected.revision)) throw new Error('Run the pinned benchmark first');
const settings = {
  EMBEDDING_URL: 'http://127.0.0.1:7312/v1/embeddings', EMBEDDING_MODEL: selected.model,
  EMBEDDING_REVISION: selected.revision, EMBEDDING_DIMENSIONS: '384',
  LOCAL_EMBEDDING_PROFILE: report.selectedEmbedding,
  RERANK_URL: report.enableReranker ? 'http://127.0.0.1:7312/v1/rerank' : '',
};
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ selected: report.selectedEmbedding, rerankerEnabled: report.enableReranker, instruction: 'Use --apply to update only semantic settings in .env' }));
} else {
  const file = path.join(root, '.env');
  let contents = readFileSync(file, 'utf8');
  for (const [key, value] of Object.entries(settings)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    contents = pattern.test(contents) ? contents.replace(pattern, line) : contents.trimEnd() + '\n' + line + '\n';
  }
  writeFileSync(file, contents);
  console.log(JSON.stringify({ updatedKeys: Object.keys(settings), selected: report.selectedEmbedding, rerankerEnabled: report.enableReranker }));
}
