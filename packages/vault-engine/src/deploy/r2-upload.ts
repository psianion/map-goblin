import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export const CACHE_MUTABLE = 'public, max-age=300';
export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';

export function getCacheControl(key: string): string {
  // Content-hashed images are immutable (atlas-*.webp, *-{hash}.webp but NOT preview-*)
  if (key.endsWith('.webp') && !key.includes('preview-')) {
    return CACHE_IMMUTABLE;
  }
  // Everything else is mutable metadata
  return CACHE_MUTABLE;
}

export async function uploadToR2(
  client: S3Client,
  bucket: string,
  key: string,
  data: Buffer,
  contentType?: string,
  cacheControl?: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: contentType ?? guessContentType(key),
      CacheControl: cacheControl ?? getCacheControl(key),
    }),
  );
}

export async function listR2Files(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
    }),
  );
  return (result.Contents ?? []).map((obj) => obj.Key!).filter(Boolean);
}

export async function deleteFromR2(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

function guessContentType(key: string): string {
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.webp')) return 'image/webp';
  if (key.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}
