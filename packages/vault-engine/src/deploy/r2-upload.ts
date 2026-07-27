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
  // Immutability follows the content hash the build appends, not the filename
  // prefix — previews are hashed too (preview-<hash>.webp).
  if (/-[a-f0-9]{8}\.(webp|png)$/.test(key)) {
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
  // ListObjectsV2 caps at 1000 keys per response — follow the continuation
  // token so callers never diff against a silently partial listing.
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    keys.push(...(result.Contents ?? []).map((obj) => obj.Key!).filter(Boolean));
    token = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (token);
  return keys;
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
