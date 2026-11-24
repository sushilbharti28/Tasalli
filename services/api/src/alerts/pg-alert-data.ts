import type { AlertDataSource, AlertDose, AlertPerson, AlertRecipient, AppLocale } from '@tasalli/integrations';
import type { Queryable } from '../db/db.service';

/**
 * Postgres implementation of the alert worker's data source (packages/integrations, "Alerts to the child").
 * Alert jobs carry ids only; names and statuses are read here at send time, so a deleted person or account
 * gets nothing (rule 9) and a dose marked taken meanwhile is not reported as missed.
 */
export class PgAlertData implements AlertDataSource {
  constructor(private readonly db: Queryable) {}

  async getPerson(personId: string): Promise<AlertPerson | null> {
    const { rows } = await this.db.query<{ id: string; owner_user_id: string; nickname: string; time_zone: string }>(
      `select id, owner_user_id, nickname, time_zone from people where id = $1 and deleted_at is null`, [personId]);
    const r = rows[0];
    return r ? { id: r.id, ownerUserId: r.owner_user_id, nickname: r.nickname, timeZone: r.time_zone } : null;
  }

  async getRecipient(userId: string): Promise<AlertRecipient | null> {
    const { rows } = await this.db.query<{ id: string; phone_e164: string; locale: string; time_zone: string; tokens: string[] }>(
      `select u.id, u.phone_e164, u.locale, u.time_zone,
              coalesce(array(select d.push_token from devices d where d.user_id = u.id order by d.last_seen_at desc), '{}') as tokens
         from users u where u.id = $1 and u.deleted_at is null`, [userId]);
    const r = rows[0];
    if (!r) return null;
    // No WhatsApp opt-in column yet (WhatsApp is a fake until the founder decides to pay): push only.
    return { userId: r.id, phoneE164: r.phone_e164, locale: (r.locale === 'hi' ? 'hi' : 'en') as AppLocale, timeZone: r.time_zone,
      whatsappOptIn: false, pushTokens: r.tokens };
  }

  async getDoses(doseIds: string[]): Promise<AlertDose[]> {
    if (doseIds.length === 0) return [];
    const { rows } = await this.db.query<DoseRow>(`${DOSE_SELECT} where d.id = any($1::uuid[]) order by d.due_at`, [doseIds]);
    return rows.map(toDose);
  }

  async getDosesForLocalDate(personId: string, localDate: string): Promise<AlertDose[]> {
    const { rows } = await this.db.query<DoseRow>(
      `${DOSE_SELECT} join people p on p.id = d.person_id
        where d.person_id = $1 and (d.due_at at time zone p.time_zone)::date = $2::date order by d.due_at`, [personId, localDate]);
    return rows.map(toDose);
  }

  async removePushToken(userId: string, token: string): Promise<void> {
    await this.db.query(`delete from devices where user_id = $1 and push_token = $2`, [userId, token]);
  }
}

interface DoseRow { id: string; spoken_name: string; due_at: Date; status: string }
const DOSE_SELECT = `select d.id, m.spoken_name, d.due_at, d.status
  from doses d join schedules s on s.id = d.schedule_id join medicines m on m.id = s.medicine_id`;
const toDose = (r: DoseRow): AlertDose =>
  ({ doseId: r.id, spokenName: r.spoken_name, dueAt: r.due_at.toISOString(), status: r.status as AlertDose['status'] });
