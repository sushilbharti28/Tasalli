import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock, CLOCK } from '../common/clock';
import { JOB_PUBLISHER, JobPublisher } from './job-publisher';
import { JOBS, QUEUES } from './queues';

/**
 * Typed wrappers for jobs the API sends to call-engine (queue "call-engine"). Always called
 * AFTER the database transaction commits, so call-engine never reads uncommitted state.
 * BullMQ custom job ids may not contain ':'.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger('Events');

  constructor(
    @Inject(JOB_PUBLISHER) private readonly publisher: JobPublisher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Throws if the job could not be queued (the caller decides what the user sees). */
  async consentCallRequested(personId: string, _ownerUserId: string, reason: 'person_added' | 'manual_retry') {
    // A manual retry must not be swallowed by dedupe of the first request, so the id includes the time.
    const id = reason === 'person_added' ? `consent_${personId}` : `consent_${personId}_${this.clock.now().getTime()}`;
    await this.publisher.publish(QUEUES.callEngine, JOBS.consentCall, { personId }, { jobId: id });
  }

  async testCallRequested(job: { userId: string }) {
    await this.publisher.publish(QUEUES.callEngine, JOBS.testCall, { userId: job.userId }, { jobId: `test_${job.userId}_${this.clock.now().getTime()}` });
  }

  /** One extra reminder call for a dose. call-engine re-checks consent, block list and the 6/day cap. */
  async doseRemindRequested(doseId: string) {
    await this.publisher.publish(QUEUES.callEngine, JOBS.doseRemind, { doseId }, { jobId: `remind_${doseId}_${this.clock.now().getTime()}` });
  }

  /**
   * Doses, medicines, pause or time zone changed: call-engine re-plans this person.
   * Best effort: call-engine also re-plans hourly, so a lost event is logged, not fatal.
   */
  async dosesChanged(personId: string, _reason: string, _window?: { from: string; to: string }) {
    await this.publisher.publish(QUEUES.callEngine, JOBS.scheduleReplan, { personId }).catch((err) =>
      this.logger.error(`could not queue schedule.replan for person ${personId}: ${(err as Error).message}`),
    );
  }

  /** A manual "taken" is already in Postgres; a re-plan makes call-engine skip any pending call for it. */
  async doseManuallyConfirmed(job: { doseId: string; personId: string; byUserId: string; at: string }) {
    await this.dosesChanged(job.personId, 'dose_manually_confirmed');
  }
}
