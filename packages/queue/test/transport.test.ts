import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
const connect = vi.hoisted(() => vi.fn());
vi.mock('amqplib', () => ({ default: { connect } }));
import { createRabbitTransport, probeRabbitMq } from '../src/index.js';

const id = '00000000-0000-4000-8000-000000000001';
let channels: any[];
let connection: any;
function channel() {
  const c = Object.assign(new EventEmitter(), {
    assertQueue: vi.fn(async () => ({})), prefetch: vi.fn(async () => {}),
    consume: vi.fn(async (_queue, fn) => { c.receive = fn; return {consumerTag:'consumer'}; }),
    receive: undefined as any,
    ack: vi.fn(), nack: vi.fn(), cancel: vi.fn(async () => {}), close: vi.fn(async () => {}),
    sendToQueue: vi.fn((_queue, _bytes, _opts, callback) => { c.confirm = callback; return true; }),
    confirm: undefined as any,
  });
  channels.push(c); return c;
}
beforeEach(() => {
  vi.clearAllMocks(); channels = [];
  connection = Object.assign(new EventEmitter(), {
    createConfirmChannel: vi.fn(async () => channel()),
    createChannel: vi.fn(async () => channel()), close: vi.fn(async () => {}),
  });
  connect.mockResolvedValue(connection);
});
it('publishes persistent messages and waits for broker confirmation', async () => {
  const queue = createRabbitTransport({url:'amqp://localhost', connectTimeoutMs:100});
  await queue.start();
  let finished = false;
  const sent = queue.publish('ai.questions', {name:'telegram',data:{id}}).then(() => { finished = true; });
  await Promise.resolve();
  expect(channels[0]?.sendToQueue).toHaveBeenCalledWith('ai.questions', expect.any(Buffer), expect.objectContaining({persistent:true, mandatory:true}), expect.any(Function));
  expect(finished).toBe(false);
  channels[0].confirm(null); await sent; expect(finished).toBe(true);
  await queue.close();
});
it('shares AI prefetch, acknowledges success only after completion, and dead letters poison/failures', async () => {
  const queue = createRabbitTransport({url:'amqp://localhost'});
  let release!: () => void;
  const handler = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  queue.consume('ai.questions', handler, {concurrency:2}); await queue.start();
  const consumer = channels.find(c => c.receive);
  expect(consumer?.prefetch).toHaveBeenCalledWith(2);
  const message = {content:Buffer.from(JSON.stringify({name:'playground',data:{id}}))};
  consumer.receive(message); await Promise.resolve(); expect(consumer.ack).not.toHaveBeenCalled();
  release(); await new Promise(resolve => setImmediate(resolve)); expect(consumer.ack).toHaveBeenCalledWith(message);
  const poison = {content:Buffer.from('bad')}; consumer.receive(poison);
  await new Promise(resolve => setImmediate(resolve)); expect(consumer.nack).toHaveBeenCalledWith(poison,false,false);
  handler.mockRejectedValueOnce(new Error('SQL backoff recorded'));
  consumer.receive(message); await new Promise(resolve => setImmediate(resolve));
  expect(consumer.nack).toHaveBeenCalledWith(message,false,false); await queue.close();
});
it('bounds shutdown even when a handler never completes', async () => {
  const queue = createRabbitTransport({url:'amqp://localhost',shutdownTimeoutMs:25});
  queue.consume('ai.questions', () => new Promise(() => {}), {concurrency:1}); await queue.start();
  const consumer = channels.find(c => c.receive);
  expect(consumer).toBeDefined();
  consumer.receive({content:Buffer.from(JSON.stringify({name:'telegram',data:{id}}))});
  await queue.close(); expect(connection.close).toHaveBeenCalled();
});
it('reconnects and restores consumers after connection loss', async () => {
  const queue = createRabbitTransport({url:'amqp://localhost',reconnectDelayMs:5});
  queue.consume('ai.questions', async () => {}, {concurrency:3}); await queue.start();
  connection.emit('close');
  await new Promise(resolve => setTimeout(resolve,30));
  expect(connect).toHaveBeenCalledTimes(2);
  expect(channels.filter(c => c.receive)).toHaveLength(2); await queue.close();
});
it('probes AMQP without declaring topology and closes its connection', async () => {
  await probeRabbitMq('amqp://localhost',100);
  expect(connection.createChannel).toHaveBeenCalledOnce();
  expect(channels[0].assertQueue).not.toHaveBeenCalled();
  expect(connection.close).toHaveBeenCalledOnce();
});
it('bounds stalled readiness and cleans up a late connection', async () => {
  let resolve!: (value: unknown) => void;
  connect.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await expect(probeRabbitMq('amqp://localhost',10)).rejects.toThrow('RabbitMQ unavailable');
  resolve(connection); await new Promise(done => setImmediate(done));
  expect(connection.close).toHaveBeenCalledOnce();
});
it('preserves the shared execution bound while reconnecting with old handlers in flight', async () => {
  const queue = createRabbitTransport({url:'amqp://localhost',reconnectDelayMs:5});
  const releases: (() => void)[] = [];
  const handler = vi.fn(() => new Promise<void>(resolve => releases.push(resolve)));
  queue.consume('ai.questions',handler,{concurrency:1}); await queue.start();
  const message = {content:Buffer.from(JSON.stringify({name:'telegram',data:{id}}))};
  channels.find(c => c.receive).receive(message);
  await new Promise(resolve => setImmediate(resolve));
  connection.emit('close'); await new Promise(resolve => setTimeout(resolve,30));
  channels.filter(c => c.receive).at(-1).receive(message);
  await new Promise(resolve => setImmediate(resolve));
  expect(handler).toHaveBeenCalledTimes(1);
  releases.shift()!(); await new Promise(resolve => setImmediate(resolve));
  expect(handler).toHaveBeenCalledTimes(2); releases.shift()!(); await queue.close();
});
it('destroys the socket when AMQP close never completes', async () => {
  const destroy = vi.fn(); connection.connection = {stream:{destroy}};
  connection.close.mockImplementation(() => new Promise(() => {}));
  await probeRabbitMq('amqp://localhost',10);
  expect(destroy).toHaveBeenCalledOnce();
});
