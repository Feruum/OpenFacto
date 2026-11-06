import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import type { INestApplication } from '@nestjs/common';

/** Exercise the real HTTP adapter/router without binding an operating-system socket. */
export async function injectHttp(app: INestApplication, path: string, headers: Record<string, string> = {}) {
  const chunks: Buffer[] = [];
  const transport = new Duplex({
    read() {},
    write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
  });
  const request = new IncomingMessage(transport as Socket);
  request.method = 'GET';
  request.url = path;
  request.headers = { host: 'localhost', ...headers };
  request.push(null);
  const response = new ServerResponse(request);
  response.assignSocket(transport as Socket);
  try {
    await new Promise<void>((resolve, reject) => {
      response.once('finish', resolve);
      response.once('error', reject);
      transport.once('error', reject);
      app.getHttpAdapter().getInstance()(request, response);
    });
    const serialized = Buffer.concat(chunks).toString('utf8');
    const body = serialized.slice(serialized.indexOf('\r\n\r\n') + 4);
    return { status: response.statusCode, headers: response.getHeaders(), body: JSON.parse(body) as Record<string, unknown> };
  } finally { response.detachSocket(transport as Socket); transport.destroy(); }
}
