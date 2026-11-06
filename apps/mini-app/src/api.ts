import { isReadyResponse, type ReadyResponse } from '@openfacto/contracts';
const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const parsed = new URL(baseUrl);
if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
  throw new Error('Invalid VITE_API_BASE_URL');
}
export async function getReadiness(signal?: AbortSignal): Promise<ReadyResponse> {
  const response = await fetch(new URL('/health/ready', parsed), { signal, cache: 'no-store', credentials: 'omit' });
  const body: unknown = await response.json();
  if ((response.status !== 200 && response.status !== 503) || !isReadyResponse(body)) throw new Error('Invalid API health response');
  return body;
}
