import amqp, { type ChannelModel, type Channel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { decodeJob, queueNames, type Job, type QueueName } from './message.js';
export * from './message.js';

async function bounded<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('RabbitMQ unavailable')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function closeConnection(connection: ChannelModel, timeoutMs: number): Promise<void> {
  try { await bounded(connection.close().catch(() => {}), timeoutMs); }
  catch {
    // amqplib exposes its socket on the underlying Connection but omits it from
    // its public typings. A stalled CloseOk must not keep shutdown alive forever.
    const underlying = connection.connection as unknown as { stream?: { destroy(): void } };
    underlying?.stream?.destroy();
  }
}

async function open(url: string, timeoutMs: number): Promise<ChannelModel> {
  let expired = false;
  const endpoint = new URL(url);
  if (!endpoint.searchParams.has('heartbeat')) endpoint.searchParams.set('heartbeat', '10');
  const pending = amqp.connect(endpoint.toString(), { timeout: timeoutMs }).then(async connection => {
    connection.on('error', () => {});
    if (expired) { await closeConnection(connection, 250); throw new Error('RabbitMQ unavailable'); }
    return connection;
  });
  try { return await bounded(pending, timeoutMs); }
  catch { expired = true; throw new Error('RabbitMQ unavailable'); }
}

/** AMQP handshake and channel probe; does not mutate broker topology. */
export async function probeRabbitMq(url: string, timeoutMs: number): Promise<void> {
  let connection: ChannelModel | undefined;
  let expired = false;
  const work = (async () => {
    const opened = await open(url, timeoutMs);
    if (expired) { await closeConnection(opened, 250); return; }
    connection = opened;
    const channel = await opened.createChannel();
    channel.on('error', () => {});
    await channel.close();
  })();
  try { await bounded(work, timeoutMs); }
  catch { throw new Error('RabbitMQ unavailable'); }
  finally {
    expired = true;
    if (connection) await closeConnection(connection, Math.min(timeoutMs, 250));
  }
}

export interface TransportOptions {
  url: string;
  /** Optional broker isolation for integration tests; production uses canonical names. */
  queuePrefix?: string;
  connectTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  reconnectDelayMs?: number;
  onError?: () => void;
}
type Consumer = { queue: QueueName; handler: (job: Job) => Promise<unknown>; concurrency: number;
  running: number; waiting: (() => void)[] };

/** SQL owns retry timing and idempotency. The broker only carries durable wake-ups. */
export function createRabbitTransport(options: TransportOptions) {
  const prefix = options.queuePrefix ?? '';
  if (prefix && !/^[a-zA-Z0-9._-]{1,64}$/.test(prefix)) throw new Error('Invalid queue prefix');
  const timeout = options.connectTimeoutMs ?? 5000;
  const report = () => { try { options.onError?.(); } catch { /* Logging must not break recovery. */ } };
  const consumers: Consumer[] = [];
  const active = new Set<Promise<void>>();
  const pending = new Map<string, (error: Error | null) => void>();
  let connection: ChannelModel | undefined;
  let publisher: ConfirmChannel | undefined;
  let subscriptions: { channel: Channel; tag: string }[] = [];
  let connecting: Promise<void> | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  let started = false;
  let closing: Promise<void> | undefined;

  function schedule() {
    if (stopping || reconnect) return;
    reconnect = setTimeout(() => {
      reconnect = undefined;
      void establish().catch(() => { report(); schedule(); });
    }, options.reconnectDelayMs ?? 1000);
    reconnect.unref();
  }

  function disconnected(current: ChannelModel) {
    if (connection !== current) return;
    connection = undefined; publisher = undefined; subscriptions = [];
    for (const finish of pending.values()) finish(new Error('RabbitMQ unavailable'));
    // Close sibling channels too, so a failed consumer cannot strand other consumers.
    void closeConnection(current, timeout);
    schedule();
  }

  async function handle(channel: Channel, consumer: Consumer, message: ConsumeMessage) {
    if (consumer.running >= consumer.concurrency) await new Promise<void>(resolve => consumer.waiting.push(resolve));
    else consumer.running++;
    try {
      if (stopping) return;
      const job = decodeJob(consumer.queue, message.content);
      await consumer.handler(job);
      channel.ack(message);
    } catch {
      report();
      // Poison and failed deliveries are dead-lettered. SQL sweeps republish after
      // the handler's persisted retry time/lease, never an immediate broker loop.
      try { channel.nack(message, false, false); } catch { /* Closed channel requeues unacked work. */ }
    } finally {
      const next = consumer.waiting.shift();
      if (next) next(); else consumer.running--;
    }
  }

  function establish(): Promise<void> {
    if (connecting) return connecting;
    connecting = (async () => {
      const current = await open(options.url, timeout);
      if (stopping) { await closeConnection(current, 250); return; }
      connection = current;
      current.on('error', report);
      current.on('close', () => disconnected(current));
      try {
        await bounded((async () => {
          const channel = await current.createConfirmChannel();
          channel.on('error', report);
          channel.on('close', () => disconnected(current));
          channel.on('return', message => pending.get(message.properties.messageId)?.(new Error('RabbitMQ unroutable message')));
          for (const name of queueNames) {
            const queue = prefix + name;
            await channel.assertQueue(queue + '.dead', { durable: true, arguments: { 'x-max-length': 10000 } });
            await channel.assertQueue(queue, { durable: true, arguments: {
              'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': queue + '.dead',
              'x-max-length': 10000, 'x-overflow': 'reject-publish',
            } });
          }
          for (const consumer of consumers) {
            const receiver = await current.createChannel();
            receiver.on('error', report);
            receiver.on('close', () => disconnected(current));
            await receiver.prefetch(consumer.concurrency);
            const result = await receiver.consume(prefix + consumer.queue, message => {
              if (!message) { disconnected(current); return; }
              if (stopping) { receiver.nack(message, false, true); return; }
              const task = handle(receiver, consumer, message);
              active.add(task);
              void task.finally(() => active.delete(task));
            }, { noAck: false });
            subscriptions.push({ channel: receiver, tag: result.consumerTag });
          }
          if (connection !== current || stopping) throw new Error('RabbitMQ unavailable');
          publisher = channel;
        })(), timeout);
      } catch (error) { disconnected(current); throw error; }
    })().finally(() => { connecting = undefined; });
    return connecting;
  }

  return {
    consume(queue: QueueName, handler: Consumer['handler'], settings: { concurrency: number }) {
      if (started || consumers.some(c => c.queue === queue)) throw new Error('Register one consumer per queue before startup');
      if (!Number.isInteger(settings.concurrency) || settings.concurrency < 1) throw new Error('Invalid concurrency');
      consumers.push({ queue, handler, concurrency: settings.concurrency, running: 0, waiting: [] });
    },
    async start() {
      if (stopping) throw new Error('RabbitMQ transport closed');
      if (started) { if (connecting) await connecting; return; }
      started = true;
      await establish();
    },
    async publish(queue: QueueName, job: Job): Promise<void> {
      const bytes = Buffer.from(JSON.stringify(job));
      decodeJob(queue, bytes);
      const channel = publisher;
      if (!channel || stopping) throw new Error('RabbitMQ unavailable');
      const messageId = randomUUID();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('RabbitMQ confirmation timed out')), timeout);
        const finish = (error: Error | null) => {
          if (!pending.delete(messageId)) return;
          clearTimeout(timer);
          if (error) reject(new Error('RabbitMQ publication failed')); else resolve();
        };
        pending.set(messageId, finish);
        try {
          channel.sendToQueue(prefix + queue, bytes, { persistent: true, mandatory: true,
            contentType: 'application/json', messageId }, finish);
        } catch { finish(new Error('RabbitMQ unavailable')); }
      });
    },
    close(): Promise<void> {
      if (closing) return closing;
      stopping = true;
      clearTimeout(reconnect);
      closing = (async () => {
        await bounded((async () => {
          await Promise.allSettled(subscriptions.map(s => s.channel.cancel(s.tag)));
          await Promise.allSettled(active);
        })(), options.shutdownTimeoutMs ?? 10000).catch(() => {});
        const current = connection;
        connection = undefined; publisher = undefined;
        for (const finish of pending.values()) finish(new Error('RabbitMQ closed'));
        if (current) await closeConnection(current, Math.min(timeout, 1000));
      })();
      return closing;
    },
  };
}
export type RabbitTransport = ReturnType<typeof createRabbitTransport>;
