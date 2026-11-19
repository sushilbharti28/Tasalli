import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Clock, CLOCK } from '../common/clock';
import { Db } from '../db/db.service';
import { TRIAL_DAYS } from '../billing/plans';

export interface UserRow {
  id: string;
  phone_e164: string;
  name: string | null;
  time_zone: string;
  locale: string;
  deleted_at: Date | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  toApi(u: UserRow) {
    // The user's own number, verified by OTP; returned to them only.
    return { id: u.id, phone: u.phone_e164, name: u.name ?? '', timeZone: u.time_zone, locale: u.locale };
  }

  findByPhone(phone: string) {
    return this.db.one<UserRow>(this.db, 'select * from users where phone_e164 = $1', [phone]);
  }

  async get(id: string): Promise<UserRow> {
    return (await this.db.one<UserRow>(this.db, 'select * from users where id = $1 and deleted_at is null', [id]))!;
  }

  /** Signs in an existing user or creates one with a 7-day trial. */
  async findOrCreate(phone: string): Promise<UserRow> {
    return this.db.tx(async (c) => {
      const inserted = await this.db.one<UserRow>(
        c,
        `insert into users (phone_e164) values ($1) on conflict (phone_e164) do nothing returning *`,
        [phone],
      );
      if (!inserted) {
        const existing = (await this.db.one<UserRow>(c, 'select * from users where phone_e164 = $1', [phone]))!;
        if (existing.deleted_at) throw new ForbiddenException('This account was closed');
        return existing;
      }
      const trialEnds = new Date(this.clock.now().getTime() + TRIAL_DAYS * 86400_000);
      const sub = await this.db.one<{ id: string }>(
        c,
        `insert into subscriptions (user_id, plan, status, trial_ends_at) values ($1, 'trial', 'trialing', $2) returning id`,
        [inserted.id, trialEnds],
      );
      await this.audit.record(c, { actorUserId: inserted.id, actorKind: 'user', entity: 'user', entityId: inserted.id, action: 'signed_up' });
      await this.audit.record(c, { actorUserId: null, actorKind: 'system', entity: 'subscription', entityId: sub!.id, action: 'trial_started', after: { trialEndsAt: trialEnds } });
      return inserted;
    });
  }

  async update(id: string, patch: { name?: string; timeZone?: string; locale?: string }): Promise<UserRow> {
    return this.db.tx(async (c) => {
      const before = (await this.db.one<UserRow>(c, 'select * from users where id = $1 for update', [id]))!;
      const after = (await this.db.one<UserRow>(
        c,
        `update users set name = coalesce($2, name), time_zone = coalesce($3, time_zone), locale = coalesce($4, locale)
         where id = $1 returning *`,
        [id, patch.name ?? null, patch.timeZone ?? null, patch.locale ?? null],
      ))!;
      await this.audit.record(c, {
        actorUserId: id, actorKind: 'user', entity: 'user', entityId: id, action: 'updated',
        before: { name: before.name, time_zone: before.time_zone, locale: before.locale },
        after: { name: after.name, time_zone: after.time_zone, locale: after.locale },
      });
      return after;
    });
  }
}
