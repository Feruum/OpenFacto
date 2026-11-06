import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const connectors = vi.hoisted(() => ({ net: vi.fn(), tls: vi.fn() }));
vi.mock('node:net', async (original) => ({ ...await original<typeof import('node:net')>(), connect: connectors.net }));
vi.mock('node:tls', async (original) => ({ ...await original<typeof import('node:tls')>(), connect: connectors.tls }));
import { pingRedis } from './redis-probe.js';

class Transport extends EventEmitter {
  write = vi.fn(() => true);
  destroy = vi.fn(() => { this.emit('close'); return this; });
}
describe('Redis protocol and lifecycle with an in-memory transport', () => {
  let transport: Transport;
  beforeEach(() => {
    vi.useFakeTimers();
    transport = new Transport();
    connectors.net.mockReturnValue(transport);
    connectors.tls.mockReturnValue(transport);
  });
  afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
  it('encodes AUTH, SELECT and PING with UTF-8 byte lengths and accepts fragmented replies', async () => {
    const result = pingRedis('redis://default:p%C3%A4ss@localhost:6379/2', 500);
    transport.emit('connect');
    expect(transport.write).toHaveBeenCalledWith('*3\r\n$4\r\nAUTH\r\n$7\r\ndefault\r\n$5\r\npäss\r\n*2\r\n$6\r\nSELECT\r\n$1\r\n2\r\n*1\r\n$4\r\nPING\r\n');
    transport.emit('data', Buffer.from('+OK\r\n+O'));
    transport.emit('data', Buffer.from('K\r\n+PO'));
    transport.emit('data', Buffer.from('NG\r\n'));
    await expect(result).resolves.toBeUndefined();
    expect(transport.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for the TLS handshake before sending credentials', async () => {
    const result = pingRedis('rediss://localhost:6380', 500);
    expect(connectors.tls).toHaveBeenCalledWith({ host: 'localhost', port: 6380, servername: 'localhost' });
    expect(connectors.net).not.toHaveBeenCalled();
    transport.emit('connect');
    expect(transport.write).not.toHaveBeenCalled();
    transport.emit('secureConnect');
    expect(transport.write).toHaveBeenCalledWith('*1\r\n$4\r\nPING\r\n');
    transport.emit('data', Buffer.from('+PONG\r\n'));
    await result;
  });
  it('uses an IPv6 address without brackets or a TLS SNI name', async () => {
    const result = pingRedis('rediss://[::1]:6380', 500);
    expect(connectors.tls).toHaveBeenCalledWith({ host: '::1', port: 6380 });
    transport.emit('secureConnect');
    transport.emit('data', Buffer.from('+PONG\r\n'));
    await result;
  });
  it.each(['auth', 'close', 'error', 'oversize'] as const)('rejects %s failure without leaking details', async (failure) => {
    const result = pingRedis('redis://localhost:6379', 500);
    const assertion = expect(result).rejects.toThrow('Redis probe failed');
    transport.emit('connect');
    if (failure === 'auth') transport.emit('data', Buffer.from('-WRONGPASS SECRET\r\n'));
    if (failure === 'close') transport.emit('close');
    if (failure === 'error') transport.emit('error', new Error('SECRET'));
    if (failure === 'oversize') transport.emit('data', Buffer.alloc(4097, 'x'));
    await assertion;
    expect(transport.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('terminates a stalled connection at its deadline', async () => {
    const result = pingRedis('redis://localhost:6379', 500);
    const assertion = expect(result).rejects.toThrow('Redis probe failed');
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(transport.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
