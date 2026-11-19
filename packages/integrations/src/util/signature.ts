import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 over the raw body, hex encoded. */
export function hmacSha256Hex(secret: string, rawBody: string | Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Constant-time comparison. Returns false (never throws) on malformed input. */
export function verifyHmacSha256Hex(secret: string, rawBody: string | Buffer, signature: string | undefined): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(hmacSha256Hex(secret, rawBody), 'hex');
  let given: Buffer;
  try {
    given = Buffer.from(signature.trim(), 'hex');
  } catch {
    return false;
  }
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

/** Case-insensitive header lookup (Node lowercases, tests and other frameworks may not). */
export function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return undefined;
  const v = headers[key];
  return Array.isArray(v) ? v[0] : v;
}
