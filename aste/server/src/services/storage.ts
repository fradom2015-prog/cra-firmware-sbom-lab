import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  url(key: string): string;
  /** Solo per lo storage locale di sviluppo. */
  read?(key: string): Promise<Buffer>;
}

export const KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+\.webp$/;

export function createS3Storage(opts: { bucket: string; region: string; endpoint?: string; publicBaseUrl: string }): Storage {
  const s3 = new S3Client({ region: opts.region, endpoint: opts.endpoint, forcePathStyle: !!opts.endpoint });
  return {
    put: async (key, body, contentType) => {
      await s3.send(new PutObjectCommand({
        Bucket: opts.bucket, Key: key, Body: body, ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }));
    },
    delete: async (key) => void (await s3.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: key }))),
    url: (key) => `${opts.publicBaseUrl.replace(/\/$/, '')}/${key}`,
  };
}

export function createLocalStorage(dir: string, publicUrl: string): Storage {
  const file = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error('chiave non valida');
    return path.join(dir, key);
  };
  return {
    put: async (key, body) => {
      await mkdir(path.dirname(file(key)), { recursive: true });
      await writeFile(file(key), body);
    },
    delete: async (key) => unlink(file(key)).catch(() => undefined),
    url: (key) => `${publicUrl.replace(/\/$/, '')}/media/${key}`,
    read: (key) => readFile(file(key)),
  };
}
