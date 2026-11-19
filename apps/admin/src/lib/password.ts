import { scryptSync, timingSafeEqual, randomBytes, createHash } from 'node:crypto';

/**
 * Founder credentials come only from env vars (safety rule 8):
 *   ADMIN_EMAIL, and ADMIN_PASSWORD_HASH ("scrypt$<salt hex>$<hash hex>", preferred)
 *   or ADMIN_PASSWORD (plain, for local use).
 */
export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function sha(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

export function checkCredentials(email: string, password: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail || !password) return false;
  const emailOk = timingSafeEqual(sha(email.trim().toLowerCase()), sha(adminEmail));

  let passOk = false;
  const stored = env.ADMIN_PASSWORD_HASH;
  if (stored) {
    const [scheme, salt, hash] = stored.split('$');
    if (scheme === 'scrypt' && salt && hash && /^[0-9a-f]{64}$/.test(hash)) {
      const got = scryptSync(password, salt, 32);
      passOk = timingSafeEqual(got, Buffer.from(hash, 'hex'));
    }
  } else if (env.ADMIN_PASSWORD) {
    passOk = timingSafeEqual(sha(password), sha(env.ADMIN_PASSWORD));
  }
  return emailOk && passOk;
}

/** Very small in-memory limiter: 5 failed attempts per 15 minutes per key. */
const failures = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export function isLockedOut(key: string, now = Date.now()): boolean {
  const recent = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, recent);
  return recent.length >= MAX_FAILURES;
}

export function recordFailure(key: string, now = Date.now()): void {
  failures.set(key, [...(failures.get(key) ?? []), now]);
}

export function clearFailures(key: string): void {
  failures.delete(key);
}
