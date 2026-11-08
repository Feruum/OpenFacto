import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { localEnvironment } from '../latency-local-env.mjs';

// Borrow the local service addresses, but keep the model selected in .env.
// The latency helper otherwise deliberately selects its Luna control model.
const configured=parseEnv(readFileSync(new URL('../../.env',import.meta.url),'utf8'));
const selected=process.env.AI_CHAT_MODEL??configured.AI_CHAT_MODEL;
Object.assign(process.env,localEnvironment());
process.env.AI_CHAT_MODEL=selected;
await import('./check-noisy-questions.mjs');
