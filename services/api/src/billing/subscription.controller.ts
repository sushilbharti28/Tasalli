import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { applySubscriptionEvent } from '@tasalli/integrations';
import { DateTime } from 'luxon';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { Clock, CLOCK } from '../common/clock';
import { conflict } from '../common/http-errors';
import { Db } from '../db/db.service';
import { BILLING_PROVIDER, BillingProvider } from './billing-provider';
import { PaidPlan, PLANS } from './plans';
import { entitlementOf, persistSub, rowToSub, SubRow } from './subscription-store';

export class StartSubscriptionDto {
  @IsIn(['one_parent', 'two_parents', 'family_yearly']) plan: PaidPlan;
}

@Controller('subscription')
export class SubscriptionController {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    @Inject(BILLING_PROVIDER) private readonly billing: BillingProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private latest(userId: string) {
    return this.db.one<SubRow>(this.db, 'select * from subscriptions where user_id = $1 order by created_at desc, id limit 1', [userId]);
  }

  private toApi(s: SubRow) {
    const nowDate = this.clock.now();
    const now = nowDate.getTime();
    const ent = entitlementOf(s, nowDate);
    // A trial past its end with no paid plan is reported as past_due (payment needed).
    const expiredTrial = s.status === 'trialing' && s.trial_ends_at && s.trial_ends_at.getTime() <= now;
    return {
      plan: s.plan,
      status: expiredTrial ? 'past_due' : s.status,
      trialEndsAt: s.trial_ends_at ? s.trial_ends_at.toISOString() : null,
      currentPeriodEnd: s.current_period_end ? s.current_period_end.toISOString() : null,
      pastDueSince: s.past_due_since ? s.past_due_since.toISOString() : null,
      entitled: ent.entitled,
      graceEndsAt: ent.graceEndsAt ? ent.graceEndsAt.toISOString() : null,
    };
  }

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const s = await this.latest(user.id);
    return s ? this.toApi(s) : { plan: 'trial', status: 'past_due', trialEndsAt: null, currentPeriodEnd: null, pastDueSince: null, entitled: false, graceEndsAt: null };
  }

  @Post()
  @HttpCode(200)
  async start(@CurrentUser() user: AuthUser, @Body() dto: StartSubscriptionDto) {
    const current = await this.latest(user.id);
    if (current && current.status === 'active' && current.plan === dto.plan) {
      throw conflict('already_active', 'This plan is already active');
    }
    const started = await this.billing.startSubscription(user.id, dto.plan);
    const now = DateTime.fromJSDate(this.clock.now());
    const periodEnd = PLANS[dto.plan].period === 'year' ? now.plus({ years: 1 }) : now.plus({ months: 1 });
    const sub = await this.db.tx(async (c) => {
      if (started.activeNow) {
        await c.query(`update subscriptions set status = 'cancelled' where user_id = $1 and status in ('trialing','active','past_due')`, [user.id]);
      }
      const row = (await this.db.one<SubRow>(
        c,
        `insert into subscriptions (user_id, plan, status, razorpay_sub_id, current_period_end)
         values ($1, $2, $3, $4, $5) returning *`,
        // A real provider confirms by webhook; until then the row stays past_due (payment pending).
        [user.id, dto.plan, started.activeNow ? 'active' : 'past_due', started.providerSubscriptionId, started.activeNow ? periodEnd.toJSDate() : null],
      ))!;
      await this.audit.record(c, { actorUserId: user.id, actorKind: 'user', entity: 'subscription', entityId: row.id, action: 'started', after: { plan: dto.plan, provider: this.billing.name } });
      return row;
    });
    return { provider: this.billing.name, subscription: this.toApi(sub), checkout: started.checkout };
  }

  /** Stops renewals. Access continues until the paid period ends (entitlement); a trial or unpaid plan ends at once. */
  @Post('cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: AuthUser) {
    const row = await this.db.tx(async (c) => {
      const r = await this.db.one<SubRow>(c, `select * from subscriptions where user_id = $1 and status <> 'cancelled' order by created_at desc, id limit 1 for update`, [user.id]);
      if (!r) throw conflict('nothing_to_cancel', 'There is no active subscription to cancel');
      await this.billing.cancelSubscription(r.razorpay_sub_id);
      const now = this.clock.now();
      const res = applySubscriptionEvent(rowToSub(r), { id: `cancel_${r.id}`, type: 'subscription.cancelled', subscriptionId: r.razorpay_sub_id ?? r.id, occurredAt: now.toISOString() });
      await persistSub(c, r, res.subscription, now);
      await this.audit.record(c, { actorUserId: user.id, actorKind: 'user', entity: 'subscription', entityId: r.id, action: 'cancelled', before: { status: r.status }, after: { status: 'cancelled' } });
      return (await this.db.one<SubRow>(c, 'select * from subscriptions where id = $1', [r.id]))!;
    });
    return this.toApi(row);
  }
}
