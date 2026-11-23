import { hmacSha256Hex } from '@tasalli/integrations';
import { ApiEventsWorker } from '../../src/doses/api-events.worker';
import { auth, createApp, Harness, WEBHOOK_SECRET } from './harness';

const tablet = () => ({
  kind: 'tablet', stripName: 'Amlodac', spokenName: 'BP wali',
  appearance: { colourPrimary: 'white', shape: 'round', size: 'small', marking: 'plain', keptIn: 'strip', packColour: 'green' },
  schedules: [{ localTime: '09:00', amountText: '1 tablet', food: 'after' }],
});

describe('v1.1: billing, remind, devices, languages', () => {
  let h: Harness;
  beforeAll(async () => { h = await createApp('2026-11-20T06:00:00Z'); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => {
    await h.db.query('truncate users, blocked_numbers, audit_log, webhook_events cascade');
    h.publisher.jobs.length = 0;
    const keys = [...(await h.redis.keys('tasalli:extra-reminders:*')), ...(await h.redis.keys('tasalli:devices:*'))];
    if (keys.length) await h.redis.del(...keys);
  });

  describe('billing', () => {
    const send = (e: object, secret = WEBHOOK_SECRET) => {
      const raw = JSON.stringify(e);
      return h.http().post('/webhooks/billing').set('Content-Type', 'application/json').set('X-Signature', hmacSha256Hex(secret, raw)).send(raw);
    };
    const subscribe = async (token: string, plan = 'one_parent') => {
      await h.http().post('/subscription').set(auth(token)).send({ plan }).expect(200);
      return (await h.db.query('select razorpay_sub_id as id from subscriptions where status = $1', ['active'])).rows[0].id as string;
    };
    const get = async (token: string) => (await h.http().get('/subscription').set(auth(token)).expect(200)).body;
    let n = 0;
    const evt = (type: string, subscriptionId: string, at = h.clock.now(), plan?: string) => ({ id: `evt_${++n}`, type, subscriptionId, occurredAt: at.toISOString(), plan });

    it('rejects a bad or missing signature and a bad payload; accepts nothing unsigned', async () => {
      const token = await h.login('+919999900001');
      const id = await subscribe(token);
      await send(evt('payment.failed', id), 'wrong-secret').expect(401);
      await h.http().post('/webhooks/billing').send(evt('payment.failed', id)).expect(401);
      await send({ nonsense: true }).expect(400);
      expect((await get(token)).status).toBe('active');
    });

    it('trial is entitled; payment failure gives a 3-day grace, then access ends; recovery clears it', async () => {
      const token = await h.login('+919999900001');
      expect(await get(token)).toMatchObject({ status: 'trialing', entitled: true });
      const id = await subscribe(token);
      expect(await get(token)).toMatchObject({ status: 'active', entitled: true, pastDueSince: null });

      await send(evt('payment.failed', id)).expect(200);
      const s = await get(token);
      expect(s).toMatchObject({ status: 'past_due', entitled: true, pastDueSince: '2026-11-20T06:00:00.000Z', graceEndsAt: '2026-11-23T06:00:00.000Z' });

      h.clock.set(new Date('2026-11-23T05:59:00Z'));
      expect((await get(token)).entitled).toBe(true);
      h.clock.set(new Date('2026-11-23T06:01:00Z'));
      expect(await get(token)).toMatchObject({ status: 'past_due', entitled: false });

      h.clock.set(new Date('2026-11-23T07:00:00Z'));
      await send(evt('payment.succeeded', id, h.clock.now())).expect(200);
      expect(await get(token)).toMatchObject({ status: 'active', entitled: true, pastDueSince: null, graceEndsAt: null });
    });

    it('is exactly-once: a repeated event id changes nothing', async () => {
      const token = await h.login('+919999900001');
      const id = await subscribe(token);
      const e = evt('payment.failed', id);
      expect((await send(e).expect(200)).body.result).toBe('applied');
      await h.db.query(`update subscriptions set past_due_since = past_due_since - interval '1 day'`);
      const before = await get(token);
      expect((await send(e).expect(200)).body.result).toBe('duplicate');
      expect(await get(token)).toEqual(before);
      expect((await h.db.query('select count(*)::int as n from webhook_events')).rows[0].n).toBe(1);
    });

    it('ignores events for unknown subscriptions with 200', async () => {
      expect((await send(evt('payment.failed', 'nope')).expect(200)).body.result).toBe('ignored');
    });

    it('cancel keeps access until the period end, then stops; cancelling twice is 409; families are separate', async () => {
      const a = await h.login('+919999900001');
      const b = await h.login('+919999900002');
      await subscribe(a);
      expect((await get(b)).status).toBe('trialing');
      const r = (await h.http().post('/subscription/cancel').set(auth(a)).expect(200)).body;
      expect(r).toMatchObject({ status: 'cancelled', entitled: true });
      expect((await get(b)).status).toBe('trialing'); // untouched
      await h.http().post('/subscription/cancel').set(auth(a)).expect(409);
      await h.db.query(`update subscriptions set current_period_end = $1 where status = 'cancelled'`, [new Date(h.clock.now().getTime() - 1000)]);
      expect((await get(a)).entitled).toBe(false);
    });

    it('cancelling a trial ends access at once; unauthenticated cancel is 401', async () => {
      const a = await h.login('+919999900001');
      expect(await h.http().post('/subscription/cancel').set(auth(a)).expect(200).then((r) => r.body)).toMatchObject({ status: 'cancelled', entitled: false });
      await h.http().post('/subscription/cancel').expect(401);
    });
  });

  describe('POST /doses/:id/remind', () => {
    const setup = async (phone: string, p = '+919876543211') => {
      const token = await h.login(phone);
      const person = (await h.http().post('/people').set(auth(token)).send({ isSelf: false, nickname: 'Papa', fullName: 'Ramesh Sharma', phone: p, language: 'hi' }).expect(201)).body.id as string;
      await h.http().post(`/people/${person}/medicines`).set(auth(token)).send(tablet()).expect(201);
      return { token, person };
    };
    const consent = async (id: string) => {
      await h.db.query(`update people set consent = 'consented', consent_at = now() where id = $1`, [id]);
      await h.app.get(ApiEventsWorker).handle({ name: 'consent-recorded', data: { personId: id, result: 'consented' } });
    };
    const firstDose = async () => (await h.db.query('select id from doses order by due_at limit 1')).rows[0]?.id as string;

    it('queues one dose.remind job for an upcoming dose of a consented person', async () => {
      const { token, person } = await setup('+919999900001');
      await consent(person);
      const id = await firstDose();
      await h.http().post(`/doses/${id}/remind`).set(auth(token)).expect(202);
      expect(h.publisher.named('dose.remind')).toEqual([{ queue: 'call-engine', name: 'dose.remind', data: { doseId: id } }]);
    });

    it('works for a missed dose; refuses a confirmed one (409)', async () => {
      const { token, person } = await setup('+919999900001');
      await consent(person);
      const id = await firstDose();
      await h.db.query(`update doses set status = 'missed' where id = $1`, [id]);
      await h.http().post(`/doses/${id}/remind`).set(auth(token)).expect(202);
      await h.db.query(`update doses set status = 'confirmed' where id = $1`, [id]);
      expect((await h.http().post(`/doses/${id}/remind`).set(auth(token)).expect(409)).body.code).toBe('dose_not_remindable');
    });

    it('refuses before consent (409), for a blocked number (409) and a paused person (409): no job queued', async () => {
      const { token, person } = await setup('+919999900001');
      await consent(person);
      const id = await firstDose();
      await h.db.query(`update people set consent = 'pending' where id = $1`, [person]);
      expect((await h.http().post(`/doses/${id}/remind`).set(auth(token)).expect(409)).body.code).toBe('not_consented');
      await h.db.query(`update people set consent = 'consented' where id = $1`, [person]);
      await h.db.query(`insert into blocked_numbers (phone_e164, reason) values ('+919876543211','key_9')`);
      expect((await h.http().post(`/doses/${id}/remind`).set(auth(token)).expect(409)).body.code).toBe('number_blocked');
      await h.db.query('truncate blocked_numbers');
      await h.db.query(`update people set paused = true where id = $1`, [person]);
      expect((await h.http().post(`/doses/${id}/remind`).set(auth(token)).expect(409)).body.code).toBe('person_paused');
      expect(h.publisher.named('dose.remind')).toHaveLength(0);
    });

    it("a user only reaches their own people's doses (404), and unauthenticated is 401", async () => {
      const { person } = await setup('+919999900001');
      await consent(person);
      const id = await firstDose();
      const other = await h.login('+919999900002');
      await h.http().post(`/doses/${id}/remind`).set(auth(other)).expect(404);
      await h.http().post(`/doses/${id}/remind`).expect(401);
      await h.http().post(`/doses/not-a-uuid/remind`).set(auth(other)).expect(404);
      expect(h.publisher.named('dose.remind')).toHaveLength(0);
    });

    it('safety rule 5: refused with 429 once the number has had 6 calls today across all accounts', async () => {
      const { token, person } = await setup('+919999900001');
      await consent(person);
      const id = await firstDose();
      // 6 calls today to the same number, placed for another account's person
      const other = await h.login('+919999900002');
      const op = (await h.http().post('/people').set(auth(other)).send({ isSelf: false, nickname: 'Dad', fullName: 'Ramesh Sharma', phone: '+919876543211', language: 'hi' }).expect(201)).body.id;
      for (let i = 0; i < 6; i++) await h.db.query(`insert into calls (person_id, purpose, provider, status, created_at) values ($1, 'reminder', 'fake', 'completed', $2)`, [op, h.clock.now()]);
      expect((await h.http().post(`/doses/${id}/remind`).set(auth(token)).expect(429)).body.code).toBe('daily_cap');
      expect(h.publisher.named('dose.remind')).toHaveLength(0);
    });

    it('limits extra reminder requests per number per day', async () => {
      const { token, person } = await setup('+919999900001');
      await consent(person);
      const id = await firstDose();
      for (let i = 0; i < 3; i++) await h.http().post(`/doses/${id}/remind`).set(auth(token)).expect(202);
      await h.http().post(`/doses/${id}/remind`).set(auth(token)).expect(429);
      expect(h.publisher.named('dose.remind')).toHaveLength(3);
    });
  });

  describe('devices', () => {
    it('stores tokens in the devices table, upserts repeats, and moves a token to the new account', async () => {
      const a = await h.login('+919999900001');
      const b = await h.login('+919999900002');
      await h.http().post('/devices').set(auth(a)).send({ token: 'tok-1' }).expect(204);
      await h.http().post('/devices').set(auth(a)).send({ token: 'tok-1' }).expect(204);
      await h.http().post('/devices').set(auth(a)).send({ token: 'tok-2' }).expect(204);
      expect((await h.db.query('select count(*)::int as n from devices')).rows[0].n).toBe(2);
      await h.http().post('/devices').set(auth(b)).send({ token: 'tok-1' }).expect(204);
      const rows = (await h.db.query(`select push_token, u.phone_e164 from devices d join users u on u.id = d.user_id order by 1`)).rows;
      expect(rows).toEqual([{ push_token: 'tok-1', phone_e164: '+919999900002' }, { push_token: 'tok-2', phone_e164: '+919999900001' }]);
      expect(await h.redis.keys('tasalli:devices:*')).toEqual([]);
      await h.http().post('/devices').set(auth(a)).send({}).expect(400);
      await h.http().post('/devices').send({ token: 'x' }).expect(401);
    });
  });

  describe('languages', () => {
    it('accepts hi, rejects other languages for new people with a clear error, still rejects unknown values', async () => {
      const t = await h.login('+919999900001');
      const body = (language: string, n: number) => ({ isSelf: false, nickname: 'P', fullName: 'Ramesh Sharma', phone: `+91987654321${n}`, language });
      await h.http().post('/people').set(auth(t)).send(body('hi', 1)).expect(201);
      for (const l of ['en', 'bn', 'mr', 'ta', 'te']) {
        const r = await h.http().post('/people').set(auth(t)).send(body(l, 2)).expect(400);
        expect(r.body.code).toBe('language_not_supported');
        expect(r.body.message).toMatch(/Hindi/);
      }
      await h.http().post('/people').set(auth(t)).send(body('xx', 2)).expect(400);
      expect((await h.http().get('/people').set(auth(t)).expect(200)).body).toHaveLength(1);
    });

    it('existing people keep their language (even non-hi); changing to another non-hi language is refused', async () => {
      const t = await h.login('+919999900001');
      const id = (await h.http().post('/people').set(auth(t)).send({ isSelf: false, nickname: 'P', fullName: 'Ramesh Sharma', phone: '+919876543211', language: 'hi' }).expect(201)).body.id;
      await h.db.query(`update people set language = 'en' where id = $1`, [id]); // legacy row
      await h.http().patch(`/people/${id}`).set(auth(t)).send({ nickname: 'Q', language: 'en' }).expect(200);
      expect((await h.http().patch(`/people/${id}`).set(auth(t)).send({ language: 'ta' }).expect(400)).body.code).toBe('language_not_supported');
      await h.http().patch(`/people/${id}`).set(auth(t)).send({ language: 'hi' }).expect(200);
      expect((await h.db.query('select language from people where id = $1', [id])).rows[0].language).toBe('hi');
    });
  });
});
