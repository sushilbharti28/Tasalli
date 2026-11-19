import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfig, CONFIG } from '../config';
import { QUEUES } from './queues';

export const JOB_PUBLISHER = Symbol('JOB_PUBLISHER');

export interface JobPublisher {
  publish(queue: string, name: string, data: object, opts?: { jobId?: string; delayMs?: number }): Promise<void>;
}

export function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

@Injectable()
export class BullJobPublisher implements JobPublisher, OnModuleDestroy {
  private readonly logger = new Logger('JobPublisher');
  private readonly queues = new Map<string, Queue>();

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: redisConnection(this.config.redisUrl), prefix: this.config.bullPrefix });
      this.queues.set(name, q);
    }
    return q;
  }

  async publish(queue: string, name: string, data: object, opts?: { jobId?: string; delayMs?: number }) {
    if (!(Object.values(QUEUES) as string[]).includes(queue)) throw new Error(`Unknown queue ${queue}`);
    await this.queue(queue).add(name, data, {
      jobId: opts?.jobId,
      delay: opts?.delayMs,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    this.logger.log(`queued ${queue}/${name}${opts?.jobId ? ` (${opts.jobId})` : ''}`);
  }

  async onModuleDestroy() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
