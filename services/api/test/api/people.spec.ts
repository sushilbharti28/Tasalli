import { auth, createApp, Harness } from './harness';

const P = (n: number, extra = {}) => ({ isSelf: false, nickname: `P${n}`, phone: `+9198765432${String(10 + n)}`, language: 'hi', ...extra });

describe('auth, people, consent', () => {
  let h: Harness;
  beforeAll(async () => { h = await createApp(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => {
    await h.db.query('truncate users, blocked_numbers, audit_log cascade');
    h.publisher.jobs.length = 0;
  });

  it('rejects missing/garbage tokens and wrong OTP', async () => {
    await h.http().get('/people').expect(401);
    await h.http().get('/people').set('Authorization', 'Bearer x.y').expect(401);
    await h.http().post('/auth/otp/request').send({ phone: '+919999900001' }).expect(204);
    await h.http().post('/auth/otp/verify').send({ phone: '+919999900001', code: '000000' }).expect(401);
    await h.http().post('/auth/otp/request').send({ phone: 'not-a-phone' }).expect(400);
  });

  it('families cannot see or touch each other', async () => {
    const a = await h.login('+919999900001');
    const b = await h.login('+919999900002');
    const person = (await h.http().post('/people').set(auth(a)).send(P(1)).expect(201)).body;
    expect(person.consent).toBe('pending');
    expect(person.phoneMasked).not.toContain('98765');
    expect((await h.http().get('/people').set(auth(b)).expect(200)).body).toEqual([]);
    for (const [m, path] of [['get', `/people/${person.id}`], ['delete', `/people/${person.id}`], ['get', `/people/${person.id}/medicines`], ['post', `/people/${person.id}/consent-call`]] as const) {
      await (h.http() as any)[m](path).set(auth(b)).expect(404);
    }
    await h.http().patch(`/people/${person.id}`).set(auth(b)).send({ paused: true }).expect(404);
    await h.http().get(`/people/${person.id}/doses?from=2026-11-20&to=2026-11-21`).set(auth(b)).expect(404);
    await h.http().get(`/people/${person.id}`).set(auth(a)).expect(200);
  });

  it('allows 4 people per account and a 5th gets 409', async () => {
    const a = await h.login('+919999900001');
    for (let i = 1; i <= 4; i++) await h.http().post('/people').set(auth(a)).send(P(i)).expect(201);
    const r = await h.http().post('/people').set(auth(a)).send(P(5)).expect(409);
    expect(r.body.code).toBe('limit_reached');
    // another account is unaffected
    const b = await h.login('+919999900002');
    await h.http().post('/people').set(auth(b)).send(P(5)).expect(201);
  });

  it('refuses a blocked number for every account and does not queue a call', async () => {
    const a = await h.login('+919999900001');
    const b = await h.login('+919999900002');
    await h.db.query(`insert into blocked_numbers (phone_e164, reason) values ('+919876543211','key_9')`);
    const r = await h.http().post('/people').set(auth(a)).send(P(1)).expect(409);
    expect(r.body.code).toBe('number_blocked');
    await h.http().post('/people').set(auth(b)).send(P(1)).expect(409);
    expect(h.publisher.named('consent.call')).toHaveLength(0);
  });

  it('enqueues a consent call (ids only) and retry is refused once blocked or consented', async () => {
    const a = await h.login('+919999900001');
    const p = (await h.http().post('/people').set(auth(a)).send(P(1)).expect(201)).body;
    const jobs = h.publisher.named('consent.call');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.personId).toBe(p.id);
    expect(jobs[0].data).toEqual({ personId: p.id });
    expect(h.publisher.jobs[0].queue).toBe('call-engine');
    await h.http().post(`/people/${p.id}/consent-call`).set(auth(a)).expect(202);
    expect(h.publisher.named('consent.call')).toHaveLength(2);
    await h.db.query(`insert into blocked_numbers (phone_e164, reason) values ('+919876543211','key_9')`);
    await h.http().post(`/people/${p.id}/consent-call`).set(auth(a)).expect(409);
  });

  it('self person is consented immediately with no consent call', async () => {
    const a = await h.login('+919999900001');
    const p = (await h.http().post('/people').set(auth(a)).send({ isSelf: true, nickname: 'Me', language: 'en' }).expect(201)).body;
    expect(p.consent).toBe('consented');
    expect(h.publisher.named('consent.call')).toHaveLength(0);
  });

  it('validates input', async () => {
    const a = await h.login('+919999900001');
    await h.http().post('/people').set(auth(a)).send({ isSelf: false, nickname: 'x', language: 'hi' }).expect(400);
    await h.http().post('/people').set(auth(a)).send(P(1, { timeZone: 'Mars/Base' })).expect(400);
    await h.http().post('/people').set(auth(a)).send(P(1, { language: 'fr' })).expect(400);
    await h.http().post('/people').set(auth(a)).send(P(1, { extra: 1 })).expect(400);
  });

  it('delete removes health data but keeps the number blocked', async () => {
    const a = await h.login('+919999900001');
    const p = (await h.http().post('/people').set(auth(a)).send(P(1)).expect(201)).body;
    await h.http().delete(`/people/${p.id}`).set(auth(a)).expect(204);
    await h.http().get(`/people/${p.id}`).set(auth(a)).expect(404);
  });
});
