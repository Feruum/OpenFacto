import { localEnvironment } from './latency-local-env.mjs';
Object.assign(process.env, localEnvironment());
if (process.argv.includes('--telegram-control')) {
  // Match the earlier Telegram sample's provider policy; only delivery changes.
  Object.assign(process.env, { AI_CHAT_MODEL: 'gpt-6-luna', AI_REASONING_EFFORT: 'low',
    AI_COMPACT_OUTPUT: '1', AI_IMMEDIATE_DISPATCH: '1' });
}
await import('../scripts/dev-local.mjs');
