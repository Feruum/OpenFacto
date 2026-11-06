import { connect as netConnect, isIP } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
/** One bounded connection per probe. Supports AUTH, DB selection and TLS. */
export function pingRedis(redisUrl: string, timeoutMs: number): Promise<void> {
  const url = new URL(redisUrl);
  const commands: string[][] = [];
  if (url.password) commands.push(url.username ? ['AUTH', decodeURIComponent(url.username), decodeURIComponent(url.password)] : ['AUTH', decodeURIComponent(url.password)]);
  if (url.pathname && url.pathname !== '/') commands.push(['SELECT', url.pathname.slice(1)]);
  commands.push(['PING']);
  const payload = commands.map((args) => `*${args.length}\r\n${args.map((value) => `$${Buffer.byteLength(value)}\r\n${value}\r\n`).join('')}`).join('');
  return new Promise((resolve, reject) => {
    const options = { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 6379) };
    const socket = url.protocol === 'rediss:'
      ? tlsConnect({ ...options, ...(isIP(options.host) ? {} : { servername: options.host }) })
      : netConnect(options);
    let buffer = '';
    let replies = 0;
    let finished = false;
    const finish = (success: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      if (success) resolve(); else reject(new Error('Redis probe failed'));
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once(url.protocol === 'rediss:' ? 'secureConnect' : 'connect', () => socket.write(payload));
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 4096) return finish(false);
      let end: number;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        replies += 1;
        const expected = replies === commands.length ? '+PONG' : '+OK';
        if (line !== expected) return finish(false);
        if (replies === commands.length) return finish(true);
      }
    });
  });
}
