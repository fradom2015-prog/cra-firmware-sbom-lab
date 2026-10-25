import { createHash, randomBytes } from 'node:crypto';

export const randomToken = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
