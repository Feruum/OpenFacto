import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { createDatabase, events, organizations } from '../dist/index.js';

test('deleting event content preserves anonymous daily usage for settled and uncertain charges', async () => {
  assert.ok(process.env.DATABASE_URL);
  const db = createDatabase(process.env.DATABASE_URL);
  const rollback = new Error('roll back aggregate fixture');
  try {
    await assert.rejects(db.client.begin(async tx => {
      const [org] = await tx`INSERT INTO organizations(name) VALUES('archive fixture') RETURNING id`;
      const [event] = await tx`INSERT INTO events(organization_id,name) VALUES(${org.id},'fixture') RETURNING id`;
      const day = '2070-05-31';
      const [before] = await tx`SELECT amount_micros FROM ai_daily_archived WHERE day=${day} AND funding='platform'`;
      await tx`INSERT INTO ai_operations(id,organization_id,event_id,day,funding,status,reserved_micros,cost_micros,result)
        VALUES (${randomUUID()},${org.id},${event.id},${day},'platform','settled',100,37,'{}'),
          (${randomUUID()},${org.id},${event.id},${day},'platform','uncertain',80,null,null)`;
      await tx`DELETE FROM organizations WHERE id=${org.id}`;
      const [after] = await tx`SELECT * FROM ai_daily_archived WHERE day=${day} AND funding='platform'`;
      assert.deepEqual(Object.keys(after).sort(), ['amount_micros','day','funding']);
      assert.equal(Number(after.amount_micros) - Number(before?.amount_micros ?? 0), 117);
      throw rollback;
    }), error => error === rollback);
  } finally { await db.close(); }
});
test('migrated schema enforces identity, membership and tenant foreign keys', async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required; integration tests never silently skip');
  const database = createDatabase(process.env.DATABASE_URL);
  const sql = database.client;
  try {
    await sql.begin(async (tx) => {
      const telegramId = '900719925474099312345' + Date.now();
      const [user] = await tx`insert into users (telegram_id, display_name) values (${telegramId}, 'fixture') returning *`;
      assert.equal(user.telegram_id, telegramId);
      assert.match(user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const [org] = await tx`insert into organizations (name) values ('fixture') returning *`;
      await tx`insert into memberships (organization_id, user_id, role) values (${org.id}, ${user.id}, 'owner')`;
      await assert.rejects(tx.savepoint((sp) => sp`insert into memberships (organization_id, user_id) values (${org.id}, ${user.id})`), { code: '23505' });
      await assert.rejects(tx.savepoint((sp) => sp`insert into events (organization_id, name) values (${randomUUID()}, 'orphan')`), { code: '23503' });
      await assert.rejects(tx.savepoint((sp) => sp`insert into users (telegram_id, display_name) values ('1.5', 'invalid')`), { code: '23514' });
      const [event] = await tx`insert into events (organization_id, name) values (${org.id}, 'fixture') returning *`;
      assert.equal(event.status, 'draft');
      assert.equal(event.organization_id, org.id);
      assert.equal((await tx`select current_setting('TimeZone') as zone`)[0].zone, 'UTC');
      await tx`delete from organizations where id = ${org.id}`;
      assert.equal((await tx`select * from events where id = ${event.id}`).length, 0);
      await tx`delete from users where id = ${user.id}`;
    });
    // Exercise Drizzle's own date mapping through its transaction API.
    // A postgres-js TransactionSql cannot be passed to the top-level drizzle() constructor.
    await database.db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizations).values({ name: 'ORM fixture' }).returning();
      const [event] = await tx.insert(events).values({ organizationId: organization.id, name: 'ORM fixture' }).returning();
      assert.ok(event.createdAt instanceof Date);
      assert.ok(event.createdAt.toISOString().endsWith('Z'));
      assert.equal(event.status, 'draft');
      await tx.delete(organizations).where(eq(organizations.id, organization.id));
    });
  } finally { await database.close(); }
});
