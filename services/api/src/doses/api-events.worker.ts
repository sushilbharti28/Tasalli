import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { AppConfig, CONFIG } from '../config';
import { Db } from '../db/db.service';
import { redisConnection } from '../queues/job-publisher';
import { EventsService } from '../queues/events.service';
import { ConsentRecordedJob, JOBS, NumberBlockedJob, QUEUES } from '../queues/queues';
import { DoseGenerator } from './dose-generator.service';

/** How often the dose window is extended for every consented person. */
export const EXTEND_EVERY_MS = 60 * 60 * 1000;

/**
 * Consumes tasalli-api-events (from call-engine) and runs the hourly dose-window job.
 * Handlers are idempotent: a repeated job leaves the same doses.
 */
@Injectable()
export class ApiEventsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ApiEventsWorker');
  private workers: Worker[] = [];
  private maintenanceQueue?: Queue;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: Db,
    private readonly doses: DoseGenerator,
    private readonly events: EventsService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.config.runWorkers) return;
    const opts = { connection: redisConnection(this.config.redisUrl), prefix: this.config.bullPrefix };
    this.workers.push(new Worker(QUEUES.apiEvents, (job) => this.handle(job), opts));
    this.workers.push(new Worker(QUEUES.apiMaintenance, () => this.extendAll(), opts));
    this.maintenanceQueue = new Queue(QUEUES.apiMaintenance, opts);
    await this.maintenanceQueue.upsertJobScheduler('extend-dose-window', { every: EXTEND_EVERY_MS }, { name: JOBS.extendDoseWindow });
    for (const w of this.workers) w.on('failed', (job, err) => this.logger.error(`${job?.name} failed: ${err.message}`));
  }

  async handle(job: Pick<Job, 'name' | 'data'>): Promise<void> {
    switch (job.name) {
      case JOBS.consentRecorded:
        return this.onConsentRecorded(job.data as ConsentRecordedJob);
      case JOBS.numberBlocked:
        return this.onNumberBlocked(job.data as NumberBlockedJob);
      default:
        this.logger.warn(`ignoring unknown job ${job.name}`);
    }
  }

  /** call-engine has already written people.consent. Generate doses, or clear them. */
  async onConsentRecorded(data: ConsentRecordedJob) {
    await this.db.tx((c) => this.doses.refresh(c, data.personId)); // generate() itself re-checks consent and block list
    await this.events.dosesChanged(data.personId, 'consent_changed', this.doses.window());
  }

  /** call-engine has already written blocked_numbers. Clear upcoming doses for that number in EVERY account. */
  async onNumberBlocked(data: NumberBlockedJob) {
    const people = await this.db.tx(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `select p2.id from people p1 join people p2 on p2.phone_e164 = p1.phone_e164 where p1.id = $1`,
        [data.personId],
      );
      for (const p of rows) await this.doses.clearFuture(c, p.id);
      return rows;
    });
    for (const p of people) await this.events.dosesChanged(p.id, 'consent_changed', this.doses.window());
  }

  /** Extends the rolling window for everyone eligible. Safe to run any number of times. */
  async extendAll(): Promise<number> {
    const { rows } = await this.db.query<{ id: string }>(
      `select id from people where consent = 'consented' and deleted_at is null`,
    );
    let created = 0;
    for (const p of rows) {
      const n = await this.doses.generate(this.db, p.id);
      if (n > 0) {
        created += n;
        await this.events.dosesChanged(p.id, 'generated', this.doses.window());
      }
    }
    return created;
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
    await this.maintenanceQueue?.close();
  }
}
