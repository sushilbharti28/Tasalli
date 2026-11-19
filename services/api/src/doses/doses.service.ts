import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RULES } from '@tasalli/contracts';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { REDIS } from '../auth/otp-store';
import { DateTime } from 'luxon';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { Clock, CLOCK } from '../common/clock';
import { conflict } from '../common/http-errors';
import { Db, Queryable } from '../db/db.service';
import { PeopleService } from '../people/people.service';
import { EventsService } from '../queues/events.service';
import { localDateRangeToUtc } from './dose-times';

export const MAX_RANGE_DAYS = 92;
/** Extra reminder requests per number per day, so the queue cannot be flooded; call-engine enforces the 6/day cap itself. */
export const MAX_EXTRA_REMINDERS_PER_DAY = 3;
/** A dose may be marked taken up to this long before it is due (parent took it early). */
export const MARK_TAKEN_EARLY_MINUTES = 120;

interface DoseRow {
  id: string;
  person_id: string;
  medicine_id: string;
  spoken_name: string;
  due_at: Date;
  status: 'upcoming' | 'calling' | 'confirmed' | 'missed' | 'skipped_paused';
  confirmed_at: Date | null;
  confirmed_via: 'key' | 'speech' | 'manual' | null;
  call_group_id: string | null;
}

const DOSE_SELECT = `select d.id, d.person_id, s.medicine_id, m.spoken_name, d.due_at, d.status, d.confirmed_at, d.confirmed_via, d.call_group_id
  from doses d join schedules s on s.id = d.schedule_id join medicines m on m.id = s.medicine_id`;

export function doseToApi(d: DoseRow) {
  return {
    id: d.id,
    medicineId: d.medicine_id,
    spokenName: d.spoken_name,
    dueAt: d.due_at.toISOString(),
    status: d.status,
    confirmedAt: d.confirmed_at ? d.confirmed_at.toISOString() : null,
    confirmedVia: d.confirmed_via,
  };
}

@Injectable()
export class DosesService {
  constructor(
    private readonly db: Db,
    private readonly people: PeopleService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Today / History. `from` and `to` are dates in the PERSON's time zone, inclusive:
   * "today" is the parent's today, wherever the child is (safety rule 7). dueAt is UTC.
   */
  async list(user: AuthUser, personId: string, from: string, to: string) {
    const person = await this.people.getOwned(this.db, user.id, personId);
    const f = DateTime.fromISO(from);
    const t = DateTime.fromISO(to);
    if (!f.isValid || !t.isValid) throw new BadRequestException('from and to must be real dates');
    if (t < f) throw new BadRequestException('to is before from');
    if (t.diff(f, 'days').days >= MAX_RANGE_DAYS) throw new BadRequestException(`At most ${MAX_RANGE_DAYS} days at a time`);
    const { start, end } = localDateRangeToUtc(from, to, person.time_zone);
    const { rows } = await this.db.query<DoseRow>(
      `${DOSE_SELECT} where d.person_id = $1 and d.due_at >= $2 and d.due_at < $3 order by d.due_at, m.spoken_name`,
      [personId, start, end],
    );
    return rows.map(doseToApi);
  }

  private async getOwned(q: Queryable, user: AuthUser, doseId: string, forUpdate = false): Promise<DoseRow> {
    const d = await this.db.one<DoseRow>(
      q,
      `${DOSE_SELECT} join people p on p.id = d.person_id
        where d.id = $1 and p.owner_user_id = $2 and p.deleted_at is null ${forUpdate ? 'for update of d' : ''}`,
      [doseId, user.id],
    );
    if (!d) throw new NotFoundException();
    return d;
  }

  /** Manual "he took it". Idempotent: an already confirmed dose is returned unchanged. */
  async markTaken(user: AuthUser, doseId: string) {
    const now = this.clock.now();
    const { dose, changed } = await this.db.tx(async (c) => {
      const d = await this.getOwned(c, user, doseId, true);
      if (d.status === 'confirmed') return { dose: d, changed: false };
      if (d.due_at.getTime() - now.getTime() > MARK_TAKEN_EARLY_MINUTES * 60_000) {
        throw conflict('too_early', 'This dose is not due yet');
      }
      await c.query(
        `update doses set status = 'confirmed', confirmed_at = $2, confirmed_via = 'manual', manual_by_user = $3 where id = $1`,
        [doseId, now, user.id],
      );
      await this.audit.record(c, {
        actorUserId: user.id, actorKind: 'user', entity: 'dose', entityId: doseId, action: 'marked_taken_manually',
        before: { status: d.status }, after: { status: 'confirmed', confirmed_via: 'manual' },
      });
      return { dose: { ...d, status: 'confirmed' as const, confirmed_at: now, confirmed_via: 'manual' as const }, changed: true };
    });
    if (changed) await this.events.doseManuallyConfirmed({ doseId, personId: dose.person_id, byUserId: user.id, at: now.toISOString() });
    return doseToApi(dose);
  }

  /**
   * One extra reminder call. Only for missed or upcoming doses of a consented, unpaused,
   * unblocked person (safety rule 3). Counts toward the 6 calls per number per day
   * across all accounts (rule 5): refused here if the number already had 6 today, and
   * call-engine checks again when it places the call.
   */
  async remind(user: AuthUser, doseId: string) {
    const d = await this.getOwned(this.db, user, doseId);
    if (d.status !== 'missed' && d.status !== 'upcoming') throw conflict('dose_not_remindable', 'Only missed or upcoming doses can be reminded');
    const p = (await this.db.one<{ consent: string; paused: boolean; phone_e164: string; time_zone: string }>(
      this.db, 'select consent, paused, phone_e164, time_zone from people where id = $1', [d.person_id],
    ))!;
    if (p.consent !== 'consented') throw conflict('not_consented', 'This person has not agreed to calls');
    if (await this.people.isBlocked(this.db, p.phone_e164)) throw conflict('number_blocked', 'This number has asked not to be called');
    if (p.paused) throw conflict('person_paused', 'Reminders are paused for this person');

    const now = DateTime.fromJSDate(this.clock.now(), { zone: p.time_zone });
    const placed = await this.db.one<{ n: string }>(
      this.db,
      `select count(*) as n from calls c join people q on q.id = c.person_id where q.phone_e164 = $1 and c.created_at >= $2`,
      [p.phone_e164, now.startOf('day').toJSDate()],
    );
    const key = `tasalli:extra-reminders:${createHash('sha256').update(p.phone_e164).digest('hex').slice(0, 24)}:${now.toISODate()}`;
    const queued = Number((await this.redis.get(key)) ?? 0);
    if (Number(placed!.n) >= RULES.maxCallsPerNumberPerDay || queued >= MAX_EXTRA_REMINDERS_PER_DAY) {
      throw new HttpException({ statusCode: 429, code: 'daily_cap', message: 'Daily call limit reached' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.audit.record(this.db, { actorUserId: user.id, actorKind: 'user', entity: 'dose', entityId: doseId, action: 'extra_reminder_requested', after: { status: d.status } });
    await this.events.doseRemindRequested(doseId);
    await this.redis.multi().incr(key).expire(key, 2 * 86400).exec();
    return { status: 'queued' };
  }

  /** Reminder call attempts for the call this dose was grouped into. */
  async calls(user: AuthUser, doseId: string) {
    const d = await this.getOwned(this.db, user, doseId);
    if (!d.call_group_id) return [];
    const { rows } = await this.db.query<{
      id: string; attempt: number; status: string; result: string | null; input_kind: string | null;
      input_value: string | null; started_at: Date | null; created_at: Date; recording_url: string | null;
    }>(
      `select id, attempt, status, result, input_kind, input_value, started_at, created_at, recording_url
         from calls where call_group_id = $1 and person_id = $2 and purpose = 'reminder' order by attempt, created_at`,
      [d.call_group_id, d.person_id],
    );
    return rows.map((r) => ({
      id: r.id,
      attempt: r.attempt,
      status: r.status,
      result: r.result,
      inputKind: r.input_kind,
      inputValue: r.input_value,
      startedAt: (r.started_at ?? r.created_at).toISOString(),
      recordingUrl: r.recording_url,
    }));
  }
}
