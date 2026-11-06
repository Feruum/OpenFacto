/** Foundation queue only. Business queues are added with their domain slices. */
export const FOUNDATION_QUEUE = 'openfacto-foundation';
export async function processFoundationJob(job: { name: string; data: unknown }) {
  if (job.name !== 'smoke') throw new Error('Unsupported foundation job');
  if (!job.data || typeof job.data !== 'object' || !('requestId' in job.data) ||
    typeof job.data.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(job.data.requestId)) throw new Error('Invalid smoke payload');
  return { status: 'ok', requestId: job.data.requestId };
}
