import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {localEnvironment} from './latency-local-env.mjs';

const configured=parseEnv(readFileSync(new URL('../.env',import.meta.url),'utf8'));
const env=localEnvironment();
// The helper supplies local dependency ports. Retain the configured AI provider.
if(configured.AI_CHAT_MODEL!==undefined)env.AI_CHAT_MODEL=configured.AI_CHAT_MODEL;
else delete env.AI_CHAT_MODEL;
Object.assign(process.env,env,{LOCAL_API_PORT:'53000',LOCAL_APP_PORT:'55273'});
await import('../scripts/dev-local.mjs');
