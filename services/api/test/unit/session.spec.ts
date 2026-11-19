import { SessionService } from '../../src/auth/session.service';
import { FixedClock } from '../../src/common/clock';
import { loadConfig } from '../../src/config';

describe('session tokens', () => {
  const clock = new FixedClock(new Date('2026-11-19T00:00:00Z'));
  const config = { ...loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'unit-test-secret' }), sessionTtlDays: 30 };
  const sessions = new SessionService(config, clock);

  it('issues a token that verifies to the user id', () => {
    expect(sessions.verify(sessions.issue('user-1'))).toBe('user-1');
  });

  it('rejects tampered, foreign and malformed tokens', () => {
    const t = sessions.issue('user-1');
    const [v, body, sig] = t.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ sub: 'user-2', iat: 0, exp: 9e9 })).toString('base64url');
    expect(sessions.verify(`${v}.${forgedBody}.${sig}`)).toBeNull();
    expect(sessions.verify(`${v}.${body}.${sig.slice(0, -2)}xx`)).toBeNull();
    const other = new SessionService({ ...config, sessionSecret: 'another-secret' }, clock);
    expect(other.verify(t)).toBeNull();
    expect(sessions.verify('garbage')).toBeNull();
  });

  it('expires after the TTL', () => {
    const t = sessions.issue('user-1');
    clock.set('2026-12-19T00:00:01Z');
    expect(sessions.verify(t)).toBeNull();
  });
});
