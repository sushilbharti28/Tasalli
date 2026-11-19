import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { AppConfig, CONFIG } from '../config';
import { Clock, CLOCK } from '../common/clock';

interface Payload {
  sub: string;
  iat: number;
  exp: number;
}

/** Stateless signed session tokens (HMAC-SHA256 with SESSION_SECRET). */
@Injectable()
export class SessionService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private sign(body: string) {
    return createHmac('sha256', this.config.sessionSecret).update(body).digest('base64url');
  }

  issue(userId: string): string {
    const now = Math.floor(this.clock.now().getTime() / 1000);
    const payload: Payload = { sub: userId, iat: now, exp: now + this.config.sessionTtlDays * 86400 };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `v1.${body}.${this.sign(body)}`;
  }

  /** Returns the user id, or null for a forged, malformed or expired token. */
  verify(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const [, body, sig] = parts;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
      if (typeof p.sub !== 'string' || typeof p.exp !== 'number') return null;
      if (p.exp * 1000 <= this.clock.now().getTime()) return null;
      return p.sub;
    } catch {
      return null;
    }
  }
}
