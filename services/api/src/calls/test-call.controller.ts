import { Controller, HttpCode, HttpException, HttpStatus, Inject, Post } from '@nestjs/common';
import { RULES } from '@tasalli/contracts';
import { DateTime } from 'luxon';
import Redis from 'ioredis';
import { REDIS } from '../auth/otp-store';
import { AuthUser, CurrentUser } from '../common/decorators';
import { Clock, CLOCK } from '../common/clock';
import { conflict } from '../common/http-errors';
import { Db } from '../db/db.service';
import { EventsService } from '../queues/events.service';

/** Test calls a user may ask for per day, inside the overall per-number cap. */
export const MAX_TEST_CALLS_PER_DAY = 3;

/**
 * Sample reminder call to the user's own (OTP-verified) number. call-engine places it
 * through its FakeProvider (founder rule: no paid telephony yet).
 */
@Controller('test-call')
export class TestCallController {
  constructor(
    private readonly db: Db,
    private readonly events: EventsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post()
  @HttpCode(202)
  async request(@CurrentUser() user: AuthUser) {
    if (await this.db.one(this.db, 'select 1 from blocked_numbers where phone_e164 = $1', [user.phone])) {
      throw conflict('number_blocked', 'This number has asked not to be called');
    }
    const u = (await this.db.one<{ time_zone: string }>(this.db, 'select time_zone from users where id = $1', [user.id]))!;
    const now = DateTime.fromJSDate(this.clock.now(), { zone: u.time_zone });
    const dayStart = now.startOf('day').toJSDate();

    // Safety rule 5: at most 6 calls a day to this number across all accounts.
    const placed = await this.db.one<{ n: string }>(
      this.db,
      `select count(*) as n from calls c join people p on p.id = c.person_id where p.phone_e164 = $1 and c.created_at >= $2`,
      [user.phone, dayStart],
    );
    const testKey = `tasalli:test-calls:${user.id}:${now.toISODate()}`;
    const tests = Number((await this.redis.get(testKey)) ?? 0);
    if (tests >= MAX_TEST_CALLS_PER_DAY || Number(placed!.n) + tests >= RULES.maxCallsPerNumberPerDay) {
      throw new HttpException({ statusCode: 429, code: 'daily_cap', message: 'Daily call limit reached' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.redis.multi().incr(testKey).expire(testKey, 2 * 86400).exec();
    await this.events.testCallRequested({ userId: user.id });
    return { status: 'queued' };
  }
}
