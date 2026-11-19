import type { Clock } from '../clock.js';
import type { AddOptions, AlertJob, AlertSink, EngineJobName, EngineJobs, JobQueue } from './jobs.js';

export interface MemoryJob {
  id: string;
  name: EngineJobName;
  data: unknown;
  runAt: number;
  seq: number;
}

export type JobHandler = (name: EngineJobName, data: unknown) => Promise<void>;

/**
 * Deterministic in-memory queue for tests and local dev, driven by a Clock.
 * Same dedupe semantics as BullMQ with retained completed jobs: a jobId is accepted once.
 */
export class MemoryQueue implements JobQueue, AlertSink {
  private pending: MemoryJob[] = [];
  private seenIds = new Set<string>();
  private seq = 0;
  private handler: JobHandler | null = null;
  readonly alerts: Array<{ jobId: string; job: AlertJob }> = [];
  readonly history: Array<{ name: EngineJobName; data: unknown; ranAt: Date }> = [];

  constructor(private readonly clock: Clock) {}

  setHandler(h: JobHandler) {
    this.handler = h;
  }

  async add<N extends EngineJobName>(name: N, data: EngineJobs[N], opts: AddOptions = {}): Promise<void> {
    const id = opts.jobId ?? `auto_${++this.seq}`;
    if (this.seenIds.has(id)) return;
    this.seenIds.add(id);
    this.pending.push({ id, name, data: structuredClone(data), runAt: this.clock.now().getTime() + (opts.delayMs ?? 0), seq: ++this.seq });
  }

  async alert(job: AlertJob, jobId: string): Promise<void> {
    const id = `alert/${jobId}`;
    if (this.seenIds.has(id)) return;
    this.seenIds.add(id);
    this.alerts.push({ jobId, job: structuredClone(job) });
  }

  pendingJobs(): MemoryJob[] {
    return [...this.pending].sort(order);
  }

  nextRunAt(): number | null {
    const next = this.pendingJobs()[0];
    return next ? next.runAt : null;
  }

  /** Run every job due at the clock's current time (including jobs those jobs add for "now"). */
  async runDue(): Promise<number> {
    if (!this.handler) throw new Error('MemoryQueue: no handler');
    let n = 0;
    for (;;) {
      const now = this.clock.now().getTime();
      const due = this.pendingJobs().find((j) => j.runAt <= now);
      if (!due) return n;
      this.pending = this.pending.filter((j) => j !== due);
      this.history.push({ name: due.name, data: due.data, ranAt: this.clock.now() });
      await this.handler(due.name, due.data);
      n++;
    }
  }
}

function order(a: MemoryJob, b: MemoryJob) {
  return a.runAt - b.runAt || a.seq - b.seq;
}
