import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Worker } from 'bullmq';
import Redis from 'ioredis';
import {
  RedisIdempotencyStore, consoleLogger, createPushSenderFromEnv, createWhatsAppSenderFromEnv, startAlertWorker,
} from '@tasalli/integrations';
import { CONFIG, type AppConfig } from '../config';
import { Db } from '../db/db.service';
import { redisConnection } from '../queues/job-publisher';
import { PgAlertData } from './pg-alert-data';

/**
 * Sends the alerts the call engine queues (dose missed, said not taken, evening summary, opted out, plan lapsed) to the
 * family: push (FCM) and, later, WhatsApp. Runs with the API's other workers (RUN_WORKERS, default on).
 * Before this, nothing consumed the `integrations-alerts` queue, so no family was ever told.
 */
@Injectable()
export class AlertsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('AlertsWorker');
  private worker?: Worker;
  private redis?: Redis;

  constructor(@Inject(CONFIG) private readonly config: AppConfig, private readonly db: Db) {}

  async onApplicationBootstrap() {
    if (!this.config.runWorkers) return;
    this.redis = new Redis(this.config.redisUrl, { maxRetriesPerRequest: null });
    this.worker = startAlertWorker(
      { data: new PgAlertData(this.db), push: createPushSenderFromEnv(process.env), whatsapp: createWhatsAppSenderFromEnv(process.env),
        idempotency: new RedisIdempotencyStore(this.redis), logger: consoleLogger, androidChannelId: 'alerts' },
      { connection: redisConnection(this.config.redisUrl), prefix: this.config.bullPrefix },
    );
    this.logger.log('alert worker started');
  }

  async onModuleDestroy() {
    await this.worker?.close();
    this.redis?.disconnect();
  }
}
