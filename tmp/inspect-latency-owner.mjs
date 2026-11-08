import { readFile } from 'node:fs/promises';
import { localEnvironment } from './latency-local-env.mjs';
import { createDatabase } from '../packages/database/dist/index.js';
const manifest=JSON.parse(await readFile('output/pdf/qadam-content.json','utf8'));
const db=createDatabase(localEnvironment().DATABASE_URL);
try {
 const rows=await db.client`SELECT u.display_name,u.locale,
   (SELECT count(*)::integer FROM memberships all_m WHERE all_m.user_id=u.id) AS memberships,
   (SELECT count(*)::integer FROM sessions s WHERE s.user_id=u.id AND NOT s.revoked AND s.expires_at>now()) AS active_sessions
   FROM users u JOIN memberships m ON m.user_id=u.id
   WHERE m.organization_id=${manifest.organizationId} AND m.role='owner'`;
 console.log(JSON.stringify(rows));
} finally {await db.close();}
