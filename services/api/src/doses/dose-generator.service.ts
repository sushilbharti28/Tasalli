import { Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';
import { Clock, CLOCK } from '../common/clock';
import { Db, Queryable } from '../db/db.service';
import { computeDueTimes } from './dose-times';

/**
 * Creates dose rows for a rolling window. Safety rule 3: only for people who are
 * consented, not removed and whose number is not on the block list.
 */
@Injectable()
export class DoseGenerator {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Removes future doses that no call has touched yet. Past doses stay as history. */
  async clearFuture(q: Queryable, personId: string, scheduleIds?: string[]): Promise<number> {
    const res = await q.query(
      `delete from doses where person_id = $1 and due_at > $2 and status in ('upcoming','skipped_paused')
         ${scheduleIds ? 'and schedule_id = any($3::uuid[])' : ''}`,
      scheduleIds ? [personId, this.clock.now(), scheduleIds] : [personId, this.clock.now()],
    );
    return res.rowCount ?? 0;
  }

  /** Generates the window for one person. Returns how many doses were created. */
  async generate(q: Queryable, personId: string): Promise<number> {
    const person = await this.db.one<{ time_zone: string; paused: boolean }>(
      q,
      `select p.time_zone, p.paused from people p
        where p.id = $1 and p.deleted_at is null and p.consent = 'consented'
          and not exists (select 1 from blocked_numbers b where b.phone_e164 = p.phone_e164)`,
      [personId],
    );
    if (!person) return 0;
    const { rows } = await q.query<{ id: string; local_time: string; days_of_week: number[]; start_date: string; end_date: string | null }>(
      `select s.id, s.local_time::text, s.days_of_week, s.start_date::text, s.end_date::text
         from schedules s join medicines m on m.id = s.medicine_id
        where m.person_id = $1 and m.active`,
      [personId],
    );
    const due = computeDueTimes(
      rows.map((r) => ({ id: r.id, localTime: r.local_time, daysOfWeek: r.days_of_week, startDate: r.start_date, endDate: r.end_date })),
      person.time_zone,
      this.clock.now(),
      this.config.doseHorizonDays,
    );
    if (due.length === 0) return 0;
    const res = await q.query(
      `insert into doses (schedule_id, person_id, due_at, status)
       select s, $1, d, $4::dose_status from unnest($2::uuid[], $3::timestamptz[]) as t(s, d)
       on conflict (schedule_id, due_at) do nothing`,
      [personId, due.map((d) => d.scheduleId), due.map((d) => d.dueAt), person.paused ? 'skipped_paused' : 'upcoming'],
    );
    return res.rowCount ?? 0;
  }

  /** Clears and regenerates future doses after any change to the person or medicines. */
  async refresh(q: Queryable, personId: string): Promise<void> {
    await this.clearFuture(q, personId);
    await this.generate(q, personId);
  }

  /** Window covered by a refresh, for the doses-changed event. */
  window(): { from: string; to: string } {
    const now = this.clock.now();
    return { from: now.toISOString(), to: new Date(now.getTime() + (this.config.doseHorizonDays + 1) * 86400_000).toISOString() };
  }
}
