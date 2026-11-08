import type { DocumentScope } from './ingestion-storage.js';
/** Domain-facing publication port, independent of the transport. */
export interface IngestionQueue {
  add(name: string, data: DocumentScope & { modelKey?: string }, options?: {
    jobId?: string; removeOnComplete?: boolean; removeOnFail?: boolean;
  }): Promise<unknown>;
}
