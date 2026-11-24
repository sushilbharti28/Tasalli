import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signSession, verifySession } from '@/lib/session';
import { checkCredentials, hashPassword, isLockedOut, recordFailure } from '@/lib/password';

const SECRET = 'test-secret-that-is-at-least-32-characters-long'; // gitleaks:allow (test-only value, not a real secret)

beforeEach(() => {
  process.env.ADMIN_EMAIL = 'Founder@Example.com';
});
afterEach(() => {
  delete process.env.ADMIN_EMAIL;
});

describe('session cookie', () => {
  it('round-trips a valid session', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signSession({ email: 'founder@example.com', exp }, SECRET);
    expect(await verifySession(token, SECRET)).toEqual({ email: 'founder@example.com', exp });
  });

  it('rejects tampering, a wrong secret, expiry and a different email', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signSession({ email: 'founder@example.com', exp }, SECRET);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ email: 'founder@example.com', exp: exp + 9999 })).toString('base64url');
    expect(await verifySession(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(await verifySession(`${payload}.${sig}x`, SECRET)).toBeNull();
    expect(await verifySession(token, SECRET + 'x')).toBeNull();
    expect(await verifySession(token, null)).toBeNull();
    expect(await verifySession(undefined, SECRET)).toBeNull();
    expect(await verifySession(token, SECRET, (exp + 1) * 1000)).toBeNull();

    const other = await signSession({ email: 'someone@example.com', exp }, SECRET);
    expect(await verifySession(other, SECRET)).toBeNull();
  });
});

describe('checkCredentials', () => {
  it('accepts the env password and rejects others', () => {
    const env = { ADMIN_EMAIL: 'founder@example.com', ADMIN_PASSWORD: 'correct horse battery' } as unknown as NodeJS.ProcessEnv;
    expect(checkCredentials(' Founder@example.com ', 'correct horse battery', env)).toBe(true);
    expect(checkCredentials('founder@example.com', 'wrong', env)).toBe(false);
    expect(checkCredentials('other@example.com', 'correct horse battery', env)).toBe(false);
    expect(checkCredentials('founder@example.com', '', env)).toBe(false);
  });

  it('prefers a scrypt hash when set', () => {
    const env = {
      ADMIN_EMAIL: 'founder@example.com',
      ADMIN_PASSWORD_HASH: hashPassword('long enough password'),
      ADMIN_PASSWORD: 'ignored',
    } as unknown as NodeJS.ProcessEnv;
    expect(checkCredentials('founder@example.com', 'long enough password', env)).toBe(true);
    expect(checkCredentials('founder@example.com', 'ignored', env)).toBe(false);
  });

  it('fails closed with no configuration', () => {
    expect(checkCredentials('founder@example.com', 'x', {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('locks out after 5 failures', () => {
    const key = `ip-${Math.random()}`;
    for (let i = 0; i < 5; i++) recordFailure(key);
    expect(isLockedOut(key)).toBe(true);
    expect(isLockedOut(`${key}-other`)).toBe(false);
  });
});
