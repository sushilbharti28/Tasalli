import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Logger } from '../log.js';
import {
  ALERTS_QUEUE, CALL_ENGINE_QUEUE, type AddOptions, type AlertJob, type AlertSink, type EngineJobName, type EngineJobs,
  type JobQueue,
} from './jobs.js';

const KEEP = { removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 30 * 24 * 3600 } };

/** BullMQ-backed queues (Redis). Completed jobs are kept 7 days so jobId dedupe holds across retries. */
export class BullQueues implements JobQueue, AlertSink {
  readonly engine: Queue;
  readonly alerts: Queue;

  constructor(private readonly connection: ConnectionOptions, prefix?: string) {
    this.engine = new Queue(CALL_ENGINE_QUEUE, { connection, prefix });
    this.alerts = new Queue(ALERTS_QUEUE, { connection, prefix });
  }

  async add<N extends EngineJobName>(name: N, data: EngineJobs[N], opts: AddOptions = {}): Promise<void> {
    await this.engine.add(name, data, { ...KEEP, delay: opts.delayMs && opts.delayMs > 0 ? opts.delayMs : undefined, jobId: opts.jobId, attempts: opts.attempts ?? 3, backoff: { type: 'exponential', delay: 5000 } });
  }

  async alert(job: AlertJob, jobId: string): Promise<void> {
    await this.alerts.add('alert', job, { ...KEEP, jobId, attempts: 5, backoff: { type: 'exponential', delay: 10000 } });
  }

  /** Hourly re-plan of every schedulable person. */
  async ensurePlanAllSchedule(everyMs = 3600_000): Promise<void> {
    await this.engine.upsertJobScheduler('plan-all', { every: everyMs }, { name: 'schedule.plan_all', data: {} });
  }
  /** v1.7: finish stale calls and never-dialled groups every 5 minutes. */
  async ensureSweepSchedule(everyMs = 5 * 60_000): Promise<void> {
    await this.engine.upsertJobScheduler('calls-sweep', { every: everyMs }, { name: 'calls.sweep', data: {} });
  }

  startWorker(handle: (name: EngineJobName, data: unknown) => Promise<void>, log: Logger, concurrency = 20): Worker {
    const worker = new Worker(CALL_ENGINE_QUEUE, async (job) => handle(job.name as EngineJobName, job.data), {
      connection: this.connection, prefix: (this.engine.opts as { prefix?: string }).prefix, concurrency,
    });
    worker.on('failed', (job, err) => log.error('job failed', { job: job?.name, jobId: job?.id, err: err.message }));
    return worker;
  }

  async close(): Promise<void> {
    await Promise.all([this.engine.close(), this.alerts.close()]);
  }
}
