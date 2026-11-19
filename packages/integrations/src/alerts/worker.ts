import { Worker, type ConnectionOptions } from 'bullmq';
import { handleAlertJob, type AlertDeps } from './handler';
import { ALERTS_QUEUE, ALERT_JOB_NAME, type AlertJob } from './jobs';

export interface AlertWorkerOptions {
  connection: ConnectionOptions;
  /** Must match the prefix the call engine uses for its queues. */
  prefix?: string;
  concurrency?: number;
}

/**
 * Consumes `integrations-alerts`. Retries come from the producer's job options
 * (call engine: attempts 5, exponential backoff); handleAlertJob throws only for
 * temporary failures, and channels already sent are never sent again.
 */
export function startAlertWorker(deps: AlertDeps, opts: AlertWorkerOptions): Worker<AlertJob> {
  const worker = new Worker<AlertJob>(
    ALERTS_QUEUE,
    async (job) => {
      if (job.name !== ALERT_JOB_NAME) {
        deps.logger.warn(`ignoring unknown job ${job.name}`, { jobId: job.id });
        return;
      }
      return handleAlertJob(job.id ?? `bull-${job.name}-${job.timestamp}`, job.data, deps);
    },
    { connection: opts.connection, prefix: opts.prefix, concurrency: opts.concurrency ?? 10 },
  );
  worker.on('failed', (job, err) => {
    const final = job && job.attemptsMade >= (job.opts.attempts ?? 1);
    deps.logger[final ? 'error' : 'warn'](`alert job ${final ? 'gave up' : 'will retry'}: ${err.message}`, {
      jobId: job?.id, kind: job?.data.kind,
    });
  });
  return worker;
}
