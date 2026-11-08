import { describe, expect, it } from 'vitest';
import type { ApiConfig } from '@openfacto/config';
import { localDemoEnabled, localDemoRequestAllowed } from '../src/product/local-demo.controller.js';

const config: ApiConfig = { nodeEnv: 'development', host: '127.0.0.1', port: 53000,
  miniAppOrigin: 'http://127.0.0.1:55173', databaseUrl: 'postgresql://test:test@127.0.0.1:55432/demo',
  rabbitmqUrl: 'amqp://127.0.0.1:56379', logLevel: 'error', dependencyTimeoutMs: 1000 };
describe('local workspace boundary', () => {
  it('requires explicit opt-in, development, local database and actual loopback bind', () => {
    expect(localDemoEnabled(config, '1')).toBe(true);
    for (const c of [{ ...config, nodeEnv: 'production' }, { ...config, host: '0.0.0.0' },
      { ...config, databaseUrl: 'postgresql://test:test@remote.example/demo' },
      { ...config, miniAppOrigin: 'https://example.com' }])
      expect(localDemoEnabled(c as ApiConfig, '1')).toBe(false);
    expect(localDemoEnabled(config, undefined)).toBe(false);
  });
  it('rejects foreign origins, rebinding hosts, forwarded requests and nonlocal peers', () => {
    const request = { origin: config.miniAppOrigin, host: '127.0.0.1:53000', peer: '127.0.0.1', forwarded: false };
    expect(localDemoRequestAllowed(config, request)).toBe(true);
    for (const r of [{...request, origin: undefined}, {...request, origin: 'https://evil.example'},
      {...request, host: 'evil.example:53000'}, {...request, peer: '10.0.0.1'}, {...request, forwarded: true}])
      expect(localDemoRequestAllowed(config, r)).toBe(false);
  });
});
