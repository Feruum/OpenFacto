import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface EventScope {
  organizationId: string;
  eventId: string;
}
export interface DocumentScope extends EventScope {
  documentId: string;
  versionId: string;
}
export const MAX_PDF_BYTES = 8 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function documentScope(value: unknown): DocumentScope {
  if (!value || typeof value !== 'object') throw new Error('Invalid document scope');
  const data = value as Record<string, unknown>;
  for (const key of ['organizationId', 'eventId', 'documentId', 'versionId']) {
    if (typeof data[key] !== 'string' || !uuid.test(data[key])) throw new Error('Invalid document scope');
  }
  return {
    organizationId: String(data.organizationId).toLowerCase(),
    eventId: String(data.eventId).toLowerCase(),
    documentId: String(data.documentId).toLowerCase(),
    versionId: String(data.versionId).toLowerCase(),
  };
}

export function objectKey(scope: DocumentScope) {
  const { organizationId, eventId, documentId, versionId } = documentScope(scope);
  return `quarantine/${organizationId}/${eventId}/${documentId}/${versionId}.pdf`;
}

function storage(scope: DocumentScope) {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY)
    throw new Error('Object storage unavailable');
  return {
    client: new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: S3_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
      maxAttempts: 2,
    }),
    object: { Key: objectKey(scope), Bucket: S3_BUCKET },
  };
}

export async function putOriginal(scope: DocumentScope, bytes: Buffer) {
  if (bytes.length > MAX_PDF_BYTES || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
    throw new Error('Invalid PDF upload');
  const { client, object } = storage(scope);
  try {
    await client.send(
      new PutObjectCommand({
        ...object,
        ContentType: 'application/pdf',
        IfNoneMatch: '*',
        CacheControl: 'private, no-store',
        Body: bytes,
      }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
  } finally {
    client.destroy();
  }
}

export async function readOriginal(scope: DocumentScope) {
  const { client, object } = storage(scope);
  try {
    const result = await client.send(new GetObjectCommand(object), { abortSignal: AbortSignal.timeout(30_000) });
    if (!result.Body || !result.ContentLength || result.ContentLength > MAX_PDF_BYTES)
      throw new Error('Invalid stored PDF');
    const bytes = Buffer.from(await result.Body.transformToByteArray());
    if (bytes.length !== result.ContentLength) throw new Error('Truncated stored PDF');
    return bytes;
  } finally {
    client.destroy();
  }
}

export async function deleteOriginal(scope: DocumentScope) {
  const { client, object } = storage(scope);
  try {
    await client.send(new DeleteObjectCommand(object), { abortSignal: AbortSignal.timeout(30_000) });
  } finally {
    client.destroy();
  }
}
