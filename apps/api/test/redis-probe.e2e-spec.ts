import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { pingRedis } from '../src/health/redis-probe.js';
describe('bounded Redis wire probe', () => {
  let server: Server;
  const sockets = new Set<Socket>();
  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  async function start(handler: (socket: Socket) => void) {
    server = createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); handler(socket); });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP address');
    return address.port;
  }
  it('authenticates, selects a database, and accepts fragmented replies', async () => {
    let commands = '';
    const port = await start((socket) => socket.once('data', (data) => {
      commands = data.toString();
      socket.write('+OK\r\n+OK\r\n+PO');
      setTimeout(() => socket.write('NG\r\n'), 10);
    }));
    await pingRedis(`redis://default:secret@127.0.0.1:${port}/2`, 500);
    expect(commands).toContain('AUTH'); expect(commands).toContain('SELECT'); expect(commands).toContain('PING');
  });
  it('rejects authentication errors', async () => {
    const port = await start((socket) => socket.once('data', () => socket.end('-WRONGPASS denied\r\n')));
    await expect(pingRedis(`redis://127.0.0.1:${port}`, 100)).rejects.toThrow('Redis probe failed');
  });
  it('bounds a stalled connection', async () => {
    const port = await start(() => {});
    await expect(pingRedis(`redis://127.0.0.1:${port}`, 100)).rejects.toThrow('Redis probe failed');
  });
});
