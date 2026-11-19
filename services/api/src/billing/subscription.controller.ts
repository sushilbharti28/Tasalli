import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { DateTime } from 'luxon';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { Clock, CLOCK } from '../common/clock';
import { conflict } from '../common/http-errors';
import { Db } from '../db/db.service';
import { BILLING_PROVIDER, BillingProvider } from './billing-provider';
import { PaidPlan, PLANS } from './plans';

export class StartSubscriptionDto {
  @IsIn(['one_parent', 'two_parents', 'family_yearly']) plan: PaidPlan;
}

interface SubRow {
  id: string;
  plan: 'trial' | PaidPlan;
  status: 'trialing' | 'active' | 'past_due' | 'cancelled';
  trial_ends_at: Date | null;
  current_period_end: Date | null;
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
    const now = this.clock.now().getTime();
    // A trial past its end with no paid plan is reported as past_due (payment needed).
    const expiredTrial = s.status === 'trialing' && s.trial_ends_at && s.trial_ends_at.getTime() <= now;
    return {
      plan: s.plan,
      status: expiredTrial ? 'past_due' : s.status,
      trialEndsAt: s.trial_ends_at ? s.trial_ends_at.toISOString() : null,
      currentPeriodEnd: s.current_period_end ? s.current_period_end.toISOString() : null,
    };
  }

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const s = await this.latest(user.id);
    return s ? this.toApi(s) : { plan: 'trial', status: 'past_due', trialEndsAt: null, currentPeriodEnd: null };
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
}
