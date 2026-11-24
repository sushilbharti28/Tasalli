import { Client } from 'pg';
import { FakePushSender, FakeWhatsAppSender, InMemoryIdempotencyStore, MemoryLogger, handleAlertJob } from '@tasalli/integrations';
import { PgAlertData } from '../../src/alerts/pg-alert-data';
import { TEST_DB_URL } from './global-setup';

describe('alerts: PgAlertData + the integrations alert handler', () => {
  let c: Client;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    c = new Client({ connectionString: TEST_DB_URL });
    await c.connect();
    const one = async (sql: string, p: unknown[]) => (await c.query(sql, p)).rows[0].id as string;
    ids.user = await one(`insert into users (phone_e164, name, locale) values ('+919999955501', 'Rahul', 'hi') returning id`, []);
    await c.query(`insert into devices (user_id, push_token) values ($1, 'tok-alerts-1')`, [ids.user]);
    ids.person = await one(`insert into people (owner_user_id, is_self, nickname, full_name, phone_e164, language, time_zone, consent)
      values ($1, false, 'Papa', 'Ramesh Sharma', '+919999955502', 'hi', 'Asia/Kolkata', 'consented') returning id`, [ids.user]);
    ids.med = await one(`insert into medicines (person_id, created_by_user_id, kind, strip_name, spoken_name) values ($1, $2, 'tablet', 'Telma 40', 'BP wali') returning id`, [ids.person, ids.user]);
    ids.sched = await one(`insert into schedules (medicine_id, local_time, amount_text, food, start_date) values ($1, '09:00', '1 goli', 'after', '2026-01-01') returning id`, [ids.med]);
    ids.dose = await one(`insert into doses (schedule_id, person_id, due_at, status) values ($1, $2, '2026-03-10T03:30:00Z', 'missed') returning id`, [ids.sched, ids.person]);
  });
  afterAll(async () => { await c.end(); });

  it('reads person, recipient (push tokens) and doses by id and by the parent\'s local date', async () => {
    const data = new PgAlertData(c);
    expect(await data.getPerson(ids.person)).toEqual({ id: ids.person, ownerUserId: ids.user, nickname: 'Papa', timeZone: 'Asia/Kolkata' });
    expect(await data.getRecipient(ids.user)).toMatchObject({ userId: ids.user, locale: 'hi', pushTokens: ['tok-alerts-1'], whatsappOptIn: false });
    expect(await data.getDoses([ids.dose])).toEqual([{ doseId: ids.dose, spokenName: 'BP wali', dueAt: '2026-03-10T03:30:00.000Z', status: 'missed' }]);
    expect((await data.getDosesForLocalDate(ids.person, '2026-03-10')).map((d) => d.doseId)).toEqual([ids.dose]); // 09:00 IST
    expect(await data.getDosesForLocalDate(ids.person, '2026-03-09')).toEqual([]);
    expect(await data.getPerson('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('a dose_missed job sends one push to the family, naming the medicine as they entered it', async () => {
    const push = new FakePushSender();
    const deps = { data: new PgAlertData(c), push, whatsapp: new FakeWhatsAppSender(), idempotency: new InMemoryIdempotencyStore(), logger: new MemoryLogger() };
    const job = { kind: 'dose_missed' as const, personId: ids.person, ownerUserId: ids.user, callGroupId: null, doseIds: [ids.dose], at: new Date().toISOString(), reason: 'said_not_taken' };
    await handleAlertJob('missed_test', job, deps);
    await handleAlertJob('missed_test', job, deps); // a retried job does not send twice (rule 6)
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.token).toBe('tok-alerts-1');
    expect(JSON.stringify(push.sent[0])).toContain('BP wali');
  });

  it('a dead push token is removed', async () => {
    const data = new PgAlertData(c);
    await data.removePushToken(ids.user, 'tok-alerts-1');
    expect((await data.getRecipient(ids.user))!.pushTokens).toEqual([]);
  });
});
