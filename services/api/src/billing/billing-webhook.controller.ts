import { BadRequestException, Controller, Headers, HttpCode, HttpException, Inject, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import { handleBillingWebhook } from '@tasalli/integrations';
import { Public } from '../common/decorators';
import { Clock, CLOCK } from '../common/clock';
import { AppConfig, CONFIG } from '../config';
import { Db } from '../db/db.service';
import { PgIdempotencyStore, PgSubscriptionStore } from './subscription-store';

/** Signed billing events (fake provider today). Signature is checked over the raw body before anything else. */
@Controller('webhooks/billing')
export class BillingWebhookController {
  private readonly logger = new Logger('BillingWebhook');

  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: { rawBody?: Buffer }, @Headers('x-signature') signature?: string) {
    const raw = req.rawBody?.toString('utf8') ?? '';
    const out = await handleBillingWebhook(raw, signature, {
      store: new PgSubscriptionStore(this.db, () => this.clock.now()),
      idempotency: new PgIdempotencyStore(this.db),
      logger: { info: (m) => this.logger.log(m), warn: (m) => this.logger.warn(m), error: (m) => this.logger.error(m) },
      secret: this.config.billingWebhookSecret,
    });
    if (out.status === 401) throw new UnauthorizedException();
    if (out.status === 400) throw new BadRequestException('Invalid billing event');
    if (out.status !== 200) throw new HttpException('error', 500);
    return { result: out.result };
  }
}
