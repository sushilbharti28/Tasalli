import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CALL_LANGUAGES, RULES } from '@tasalli/contracts';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { Clock, CLOCK } from '../common/clock';
import { conflict } from '../common/http-errors';
import { maskPhoneForDisplay, maskPhoneForLog, normalizeE164 } from '../common/phone';
import { Db, Queryable } from '../db/db.service';
import { DoseGenerator } from '../doses/dose-generator.service';
import { EventsService } from '../queues/events.service';
import { PersonCreateDto, PersonUpdateDto, SUPPORTED_NEW_LANGUAGES } from './people.dto';

export interface PersonRow {
  id: string;
  owner_user_id: string;
  is_self: boolean;
  nickname: string;
  full_name: string | null;
  phone_e164: string;
  language: string;
  time_zone: string;
  can_read_strip: 'yes' | 'no' | 'not_sure';
  consent: 'pending' | 'consented' | 'declined' | 'opted_out';
  consent_at: Date | null;
  paused: boolean;
}

export function personToApi(p: PersonRow) {
  return {
    id: p.id,
    isSelf: p.is_self,
    nickname: p.nickname,
    fullName: p.full_name ?? '',
    phoneMasked: maskPhoneForDisplay(p.phone_e164),
    language: p.language,
    timeZone: p.time_zone,
    canReadStrip: p.can_read_strip,
    consent: p.consent,
    paused: p.paused,
  };
}

/** Audit snapshot without the phone number. */
function snapshot(p: PersonRow) {
  const { phone_e164: _phone, ...rest } = p;
  return rest;
}

function assertLanguageSupported(language: string) {
  if (!(SUPPORTED_NEW_LANGUAGES as readonly string[]).includes(language)) {
    throw new BadRequestException({ statusCode: 400, code: 'language_not_supported', message: `Calls in this language are coming soon. Available now: ${CALL_LANGUAGES.filter((l) => l.status === 'available').map((l) => l.englishName).join(', ')}` });
  }
}

@Injectable()
export class PeopleService {
  private readonly logger = new Logger('People');

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly doses: DoseGenerator,
    private readonly events: EventsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(userId: string) {
    return this.db
      .query<PersonRow>('select * from people where owner_user_id = $1 and deleted_at is null order by created_at', [userId])
      .then((r) => r.rows);
  }

  get(userId: string, personId: string) {
    return this.getOwned(this.db, userId, personId);
  }

  /**
   * Ownership check used by every person-scoped endpoint. Another family's person
   * gives 404, never 403, so ids cannot be probed.
   */
  async getOwned(q: Queryable, userId: string, personId: string, forUpdate = false): Promise<PersonRow> {
    const p = await this.db.one<PersonRow>(
      q,
      `select * from people where id = $1 and owner_user_id = $2 and deleted_at is null ${forUpdate ? 'for update' : ''}`,
      [personId, userId],
    );
    if (!p) throw new NotFoundException();
    return p;
  }

  async isBlocked(q: Queryable, phone: string): Promise<boolean> {
    return !!(await this.db.one(q, 'select 1 from blocked_numbers where phone_e164 = $1', [phone]));
  }

  async create(user: AuthUser, dto: PersonCreateDto): Promise<PersonRow> {
    assertLanguageSupported(dto.language);
    const phone = dto.isSelf ? user.phone : normalizeE164(dto.phone!)!;
    const person = await this.db.tx(async (c) => {
      // Lock the account row so two concurrent adds cannot both pass the limit check.
      await c.query('select id from users where id = $1 for update', [user.id]);
      const existing = (await c.query<PersonRow>('select * from people where owner_user_id = $1 and deleted_at is null', [user.id])).rows;
      if (existing.length >= RULES.maxPeoplePerAccount) {
        throw conflict('limit_reached', `An account can have at most ${RULES.maxPeoplePerAccount} people`);
      }
      if (dto.isSelf && existing.some((p) => p.is_self)) throw conflict('self_exists', 'You have already added yourself');
      if (existing.some((p) => p.phone_e164 === phone)) throw conflict('duplicate_number', 'This number is already added');
      // Safety rule 3: a number that pressed 9 (or asked to stop) is blocked for every account.
      if (await this.isBlocked(c, phone)) throw conflict('number_blocked', 'This number has asked not to be called');

      const now = this.clock.now();
      const p = (await this.db.one<PersonRow>(
        c,
        `insert into people (owner_user_id, is_self, nickname, full_name, phone_e164, language, time_zone, can_read_strip, consent, consent_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
        [
          user.id, dto.isSelf, dto.nickname, dto.fullName.trim(), phone, dto.language,
          dto.timeZone ?? 'Asia/Kolkata', dto.canReadStrip ?? 'not_sure',
          dto.isSelf ? 'consented' : 'pending', dto.isSelf ? now : null,
        ],
      ))!;
      await this.audit.record(c, { actorUserId: user.id, actorKind: 'user', entity: 'person', entityId: p.id, action: 'created', after: snapshot(p) });
      if (dto.isSelf) {
        // Their own number, already verified by OTP: no consent call (scope item 2).
        const ev = await this.db.one<{ id: string }>(
          c,
          `insert into consent_events (person_id, result, via) values ($1, 'consented', 'self_otp') returning id`,
          [p.id],
        );
        await this.audit.record(c, { actorUserId: user.id, actorKind: 'user', entity: 'consent', entityId: ev!.id, action: 'consented_self_otp', after: { personId: p.id } });
      }
      return p;
    });

    if (!person.is_self) {
      try {
        await this.events.consentCallRequested(person.id, user.id, 'person_added');
      } catch (err) {
        // The person stays 'pending'; the app can retry with POST /people/{id}/consent-call.
        this.logger.error(`consent call for person ${person.id} (${maskPhoneForLog(phone)}) not queued: ${(err as Error).message}`);
      }
    }
    return person;
  }

  async update(user: AuthUser, personId: string, dto: PersonUpdateDto): Promise<PersonRow> {
    const { before, after } = await this.db.tx(async (c) => {
      const before = await this.getOwned(c, user.id, personId, true);
      if (dto.language && dto.language !== before.language) assertLanguageSupported(dto.language);
      const after = (await this.db.one<PersonRow>(
        c,
        `update people set nickname = coalesce($2, nickname), language = coalesce($3::call_language, language),
                time_zone = coalesce($4, time_zone), paused = coalesce($5, paused), can_read_strip = coalesce($6, can_read_strip),
                full_name = coalesce($7, full_name)
          where id = $1 returning *`,
        [personId, dto.nickname ?? null, dto.language ?? null, dto.timeZone ?? null, dto.paused ?? null, dto.canReadStrip ?? null, dto.fullName?.trim() ?? null],
      ))!;
      await this.audit.record(c, { actorUserId: user.id, actorKind: 'user', entity: 'person', entityId: personId, action: 'updated', before: snapshot(before), after: snapshot(after) });
      if (before.time_zone !== after.time_zone || before.paused !== after.paused) await this.doses.refresh(c, personId);
      return { before, after };
    });
    if (before.time_zone !== after.time_zone || before.paused !== after.paused) {
      const reason = before.paused !== after.paused ? (after.paused ? 'person_paused' : 'person_resumed') : 'person_changed';
      await this.events.dosesChanged(personId, reason, this.doses.window());
    }
    return after;
  }

  /**
   * Removes the person and their health data (safety rule 9): medicines, schedules,
   * doses, calls and their audit entries are deleted. The person row is kept
   * soft-deleted with names scrubbed, together with consent_events, as evidence of
   * consent for that number; blocked_numbers is never touched.
   */
  async remove(user: AuthUser, personId: string): Promise<void> {
    await this.db.tx(async (c) => {
      await this.getOwned(c, user.id, personId, true);
      const meds = (await c.query<{ id: string }>('select id from medicines where person_id = $1', [personId])).rows.map((r) => r.id);
      const doseIds = (await c.query<{ id: string }>('select id from doses where person_id = $1', [personId])).rows.map((r) => r.id);
      await c.query(`delete from audit_log where (entity = 'medicine' and entity_id = any($1::uuid[])) or (entity = 'dose' and entity_id = any($2::uuid[]))`, [meds, doseIds]);
      await c.query('delete from doses where person_id = $1', [personId]);
      await c.query('delete from schedules where medicine_id = any($1::uuid[])', [meds]);
      await c.query('delete from medicines where person_id = $1', [personId]);
      await c.query(`update calls set recording_url = null, input_value = null where person_id = $1`, [personId]);
      await c.query(`update people set deleted_at = now(), nickname = 'removed', full_name = null, paused = true where id = $1`, [personId]);
      await this.audit.record(c, { actorUserId: user.id, actorKind: 'user', entity: 'person', entityId: personId, action: 'removed' });
    });
    await this.events.dosesChanged(personId, 'person_removed', this.doses.window());
  }

  async retryConsentCall(user: AuthUser, personId: string): Promise<void> {
    const p = await this.getOwned(this.db, user.id, personId);
    if (p.consent === 'consented') throw conflict('already_consented', 'Already consented');
    if (p.consent === 'opted_out' || (await this.isBlocked(this.db, p.phone_e164))) {
      throw conflict('number_blocked', 'This number has asked not to be called');
    }
    if (p.consent === 'declined') throw conflict('declined', 'This person said no to reminder calls');
    await this.db.tx((c) =>
      this.audit.record(c, { actorUserId: user.id, actorKind: 'user', entity: 'person', entityId: personId, action: 'consent_call_requested' }),
    );
    await this.events.consentCallRequested(personId, user.id, 'manual_retry');
  }
}
