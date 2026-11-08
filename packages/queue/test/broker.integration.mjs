import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import amqp from 'amqplib';
import { createRabbitTransport, queueNames, AI_QUESTIONS_QUEUE } from '../dist/index.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { const result = await check(); if (result) return result; await delay(20); }
  assert.fail('Broker condition did not complete');
}
async function fixture(t) {
  assert.ok(process.env.RABBITMQ_URL, 'RABBITMQ_URL is required; this is a real broker test');
  const prefix = 'test-' + randomUUID() + '.';
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createConfirmChannel();
  const transports = [];
  t.after(async () => {
    await Promise.all(transports.map(transport => transport.close()));
    for (const name of queueNames) for (const suffix of ['', '.dead']) await channel.deleteQueue(prefix + name + suffix);
    await connection.close();
  });
  return { channel, prefix, transport(options = {}) {
    const transport = createRabbitTransport({url:process.env.RABBITMQ_URL,queuePrefix:prefix,shutdownTimeoutMs:30,...options});
    transports.push(transport); return transport;
  } };
}

test('broker confirms persistent ID-only jobs; unacknowledged work survives consumer shutdown', async t => {
  const f = await fixture(t), transport = f.transport();
  const job = {name:'telegram',data:{id:randomUUID()}};
  let entered = false;
  transport.consume(AI_QUESTIONS_QUEUE, async () => { entered = true; await new Promise(() => {}); }, {concurrency:1});
  await transport.start(); await transport.publish(AI_QUESTIONS_QUEUE,job);
  await until(() => entered); await transport.close();
  const message = await until(() => f.channel.get(f.prefix + AI_QUESTIONS_QUEUE,{noAck:false}));
  assert.equal(message.properties.deliveryMode,2);
  assert.equal(message.fields.redelivered,true);
  assert.deepEqual(JSON.parse(message.content),job);
  f.channel.ack(message);
});

test('real broker shares the concurrency bound between Telegram and Playground and dead-letters poison', async t => {
  const f = await fixture(t), transport = f.transport();
  let running = 0, maximum = 0;
  const processed = [];
  transport.consume(AI_QUESTIONS_QUEUE, async job => {
    running++; maximum = Math.max(maximum,running);
    await delay(30); processed.push(job.name); running--;
  },{concurrency:2});
  await transport.start();
  for (let i=0;i<6;i++) await transport.publish(AI_QUESTIONS_QUEUE,{name:i%2?'playground':'telegram',data:{id:randomUUID()}});
  await until(() => processed.length===6);
  assert.equal(maximum,2); assert.equal(processed.filter(name=>name==='playground').length,3);
  f.channel.sendToQueue(f.prefix+AI_QUESTIONS_QUEUE,Buffer.from('{bad'),{persistent:true});
  await f.channel.waitForConfirms();
  const poison = await until(() => f.channel.get(f.prefix+AI_QUESTIONS_QUEUE+'.dead',{noAck:true}));
  assert.equal(poison.content.toString(),'{bad');
  assert.equal(poison.properties.headers['x-death'][0].reason,'rejected');
});

test('a failed handler is not hot-looped; a later SQL-style notification can retry', async t => {
  const f = await fixture(t), transport = f.transport();
  let attempts = 0;
  transport.consume(AI_QUESTIONS_QUEUE,async () => { if (++attempts===1) throw new Error('retry later'); },{concurrency:1});
  await transport.start(); const job = {name:'playground',data:{id:randomUUID()}};
  await transport.publish(AI_QUESTIONS_QUEUE,job);
  await until(() => f.channel.get(f.prefix+AI_QUESTIONS_QUEUE+'.dead',{noAck:true}));
  await delay(100); assert.equal(attempts,1);
  await transport.publish(AI_QUESTIONS_QUEUE,job); await until(() => attempts===2);
});

test('broker consumer cancellation reconnects and restores the durable queue topology', async t => {
  const f=await fixture(t),transport=f.transport({reconnectDelayMs:20});
  const processed=[];
  transport.consume(AI_QUESTIONS_QUEUE,async job=>{processed.push(job.data.id);},{concurrency:1});
  await transport.start();
  await f.channel.deleteQueue(f.prefix+AI_QUESTIONS_QUEUE);
  // The broker sends basic.cancel; the transport must recreate topology and its consumer.
  const job={name:'playground',data:{id:randomUUID()}};
  await until(async()=>{try{await transport.publish(AI_QUESTIONS_QUEUE,job);return true;}catch{return false;}});
  await until(()=>processed.includes(job.data.id));
});
