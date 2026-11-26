import { ApiEventsWorker } from '../../src/doses/api-events.worker';
import { auth, createApp, Harness } from './harness';

const tablet = (over: any = {}, app: any = {}) => ({
  kind: 'tablet', stripName: 'Amlodac', spokenName: 'BP wali',
  appearance: { colourPrimary: 'white', shape: 'round', size: 'small', marking: 'plain', keptIn: 'strip', packColour: 'green', ...app },
  schedules: [{ localTime: '09:00', amountText: '1 tablet', food: 'after' }],
  ...over,
});

describe('medicines, look-alike, doses, consent gating', () => {
  let h: Harness;
  let token: string;
  let personId: string;
  const makePerson = async (tz = 'Asia/Kolkata', canRead = 'no') => {
    const r = await h.http().post('/people').set(auth(token)).send({ isSelf: false, nickname: 'Papa', fullName: 'Ramesh Sharma', phone: '+919876543211', language: 'hi', timeZone: tz, canReadStrip: canRead }).expect(201);
    return r.body.id as string;
  };
  /** What call-engine does after the consent call, followed by its consent-recorded event. */
  const consent = async (id: string) => {
    await h.db.query(`update people set consent = 'consented', consent_at = now() where id = $1`, [id]);
    await h.app.get(ApiEventsWorker).handle({ name: 'consent-recorded', data: { personId: id, result: 'consented' } });
  };

  beforeAll(async () => { h = await createApp('2026-11-20T06:00:00Z'); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => {
    await h.db.query('truncate users, blocked_numbers, audit_log cascade');
    h.publisher.jobs.length = 0;
    token = await h.login('+19175550100');
    await h.http().patch('/me').set(auth(token)).send({ timeZone: 'America/New_York' }).expect(200); // US child
    personId = await makePerson();
  });

  const addMed = (body: any, t = token, id = personId) => h.http().post(`/people/${id}/medicines`).set(auth(t)).send(body);
  const doses = async (from = '2026-11-20', to = '2026-11-27') =>
    (await h.http().get(`/people/${personId}/doses?from=${from}&to=${to}`).set(auth(token)).expect(200)).body as any[];

  it('meal: stored and returned; a time outside the meal window is refused; custom times keep meal null', async () => {
    const r = (await addMed(tablet({ schedules: [
      { localTime: '08:00', amountText: '1 tablet', food: 'before', meal: 'breakfast' },
      { localTime: '21:00', amountText: '1 tablet', food: 'after', meal: 'dinner' },
      { localTime: '06:00', amountText: '1 tablet', food: 'before' },
    ] })).expect(201)).body;
    const med = r.medicine ?? r;
    expect(med.schedules.map((s: any) => [s.localTime, s.meal])).toEqual(expect.arrayContaining([['08:00', 'breakfast'], ['21:00', 'dinner'], ['06:00', null]]));
    const bad = await addMed(tablet({ stripName: 'Other', schedules: [{ localTime: '20:00', amountText: '1 tablet', food: 'before', meal: 'breakfast' }] })).expect(400);
    expect(bad.body.code).toBe('outside_meal_window');
    await addMed(tablet({ stripName: 'Other', schedules: [{ localTime: '09:00', amountText: '1 tablet', food: 'after', meal: 'brunch' }] })).expect(400);
    await addMed(tablet({ stripName: 'Late', schedules: [{ localTime: '00:30', amountText: '1 tablet', food: 'any', meal: 'bedtime' }] })).expect(201);
  });

  it('creates no doses before consent, and none for a blocked number even after', async () => {
    await addMed(tablet()).expect(201);
    expect(await doses()).toHaveLength(0);
    await h.db.query(`insert into blocked_numbers (phone_e164, reason) values ('+919876543211','key_9')`);
    await consent(personId);
    expect(await doses()).toHaveLength(0);
  });

  it('generates doses in the parent time zone (IST parent, US child)', async () => {
    await addMed(tablet()).expect(201);
    await consent(personId);
    const d = await doses();
    expect(d.length).toBeGreaterThanOrEqual(6);
    // 09:00 IST = 03:30 UTC, whatever the child's zone. 11:30 IST has passed on the 20th, so the first is the 21st.
    expect(d[0].dueAt).toBe('2026-11-21T03:30:00.000Z');
    for (const x of d) expect(x.dueAt.endsWith('T03:30:00.000Z')).toBe(true);
    expect(d[0].status).toBe('upcoming');
    expect(d[0].spokenName).toBe('BP wali');
  });

  it('Today is the parent\'s today: a US-evening child query still returns IST-date doses', async () => {
    await addMed(tablet({ schedules: [{ localTime: '23:30', amountText: '1 tablet', food: 'any' }] })).expect(201);
    await consent(personId);
    // 23:30 IST on 20 Nov = 18:00 UTC = 13:00 in New York on the 20th; and 22 Nov 23:30 IST for the 22nd.
    const d = await doses('2026-11-20', '2026-11-20');
    expect(d.map((x) => x.dueAt)).toEqual(['2026-11-20T18:00:00.000Z']);
  });

  it('look-alike: two similar tablets conflict; no-strip-reader gets number_label, reader gets say_printed_name', async () => {
    const first = (await addMed(tablet()).expect(201)).body;
    expect(first.lookAlike).toEqual([]);
    const second = (await addMed(tablet({ stripName: 'Telma', spokenName: 'Sugar wali' }, { packColour: 'green' })).expect(201)).body;
    expect(second.lookAlike).toHaveLength(1);
    expect(second.lookAlike[0]).toMatchObject({ otherMedicineId: first.medicine.id, autoResolvedBy: null, recommended: 'number_label' });
    await h.http().patch(`/people/${personId}`).set(auth(token)).send({ canReadStrip: 'yes' }).expect(200);
    const third = (await addMed(tablet({ stripName: 'Zyr', spokenName: 'Allergy wali' })).expect(201)).body;
    expect(third.lookAlike.every((c: any) => c.recommended === 'say_printed_name')).toBe(true);
  });

  it('look-alike auto-resolves by pack colour; different shape is not a look-alike', async () => {
    await addMed(tablet()).expect(201);
    const diffPack = (await addMed(tablet({ stripName: 'B', spokenName: 'B wali' }, { packColour: 'blue' })).expect(201)).body;
    expect(diffPack.lookAlike[0].autoResolvedBy).toBe('pack_colour');
    const diffShape = (await addMed(tablet({ stripName: 'C', spokenName: 'C wali' }, { shape: 'oval' })).expect(201)).body;
    expect(diffShape.lookAlike).toEqual([]);
  });

  it('look-alike ignores names and strength (appearance only)', async () => {
    await addMed(tablet({ strengthText: '5 mg' })).expect(201);
    const same = (await addMed(tablet({ stripName: 'Totally Different Name', strengthText: '500 mg', spokenName: 'Other' })).expect(201)).body;
    expect(same.lookAlike).toHaveLength(1); // same look, different names/strengths: still flagged
  });

  it('supports all four kinds and rejects fields that do not fit the kind', async () => {
    await addMed(tablet({ kind: 'capsule', appearance: { colourPrimary: 'red', colourSecondary: 'white', shape: 'long', size: 'small', keptIn: 'loose' } })).expect(201);
    await addMed({ kind: 'syrup', stripName: 'Cough syrup', spokenName: 'Khansi ki dawa', appearance: { keptIn: 'bottle', packColour: 'brown', capColour: 'white' },
      schedules: [{ localTime: '21:00', amountText: '1 chammach (5 ml)', food: 'after' }] }).expect(201);
    await addMed({ kind: 'other', stripName: 'Inhaler', spokenName: 'Inhaler', schedules: [{ localTime: '08:00', amountText: '2 puffs', food: 'any' }] }).expect(201);
    await addMed(tablet({ kind: 'syrup', appearance: { shape: 'round' } })).expect(400);
  });

  it('a syrup can carry its label colour in colourPrimary (what the app sends)', async () => {
    const r = await addMed({ kind: 'syrup', stripName: 'Cremaffin', spokenName: 'Pet wali', appearance: { keptIn: 'bottle', packColour: 'brown', capColour: 'red', colourPrimary: 'white' },
      schedules: [{ localTime: '21:00', amountText: '1 chammach (5 ml)', food: 'after' }] }).expect(201);
    expect(r.body.medicine.appearance.colourPrimary).toBe('white');
  });

  it('v1.6: the look the call describes is required by kind (the app form already asks for it)', async () => {
    const look = { colourPrimary: 'white', shape: 'round', size: 'small', keptIn: 'strip', packColour: 'green' };
    const without = (k: string) => Object.fromEntries(Object.entries(look).filter(([x]) => x !== k));
    for (const k of ['colourPrimary', 'shape', 'size', 'keptIn', 'packColour']) {
      const r = await addMed(tablet({ appearance: without(k) })).expect(400);
      expect(JSON.stringify(r.body)).toContain(`appearance.${k}`);
    }
    await addMed(tablet({ appearance: undefined })).expect(400);
    await addMed(tablet({ appearance: { ...look, colourPrimary: '  ' } })).expect(400);
    await addMed(tablet({ appearance: { ...without('packColour'), keptIn: 'loose' } })).expect(201); // loose: no strip colour needed
    await addMed(tablet({ kind: 'capsule', appearance: { colourPrimary: 'red', keptIn: 'loose' } })).expect(400); // capsule without size
    await addMed({ kind: 'syrup', stripName: 'Syrup', spokenName: 'Syrup', appearance: { keptIn: 'bottle' },
      schedules: [{ localTime: '21:00', amountText: '1 chammach', food: 'after' }] }).expect(400); // bottle colour missing
  });

  it('keeps amount text verbatim and validates input', async () => {
    const r = await addMed(tablet({ schedules: [{ localTime: '09:00', amountText: 'aadhi goli (half)', food: 'with' }] })).expect(201);
    expect(r.body.medicine.schedules[0].amountText).toBe('aadhi goli (half)');
    await addMed(tablet({ schedules: [] })).expect(400);
    await addMed(tablet({ schedules: [{ localTime: '25:00', amountText: 'x', food: 'any' }] })).expect(400);
    await addMed(tablet({ dose: 5 })).expect(400);
  });

  it('medicines are isolated between families and stop removes future doses', async () => {
    const m = (await addMed(tablet()).expect(201)).body.medicine;
    await consent(personId);
    const other = await h.login('+19175550199');
    await addMed(tablet(), other).expect(404);
    await h.http().delete(`/medicines/${m.id}`).set(auth(other)).expect(404);
    await h.http().get(`/medicines/${m.id}/preview`).set(auth(other)).expect(404);
    expect((await h.http().get(`/people/${personId}/medicines`).set(auth(other))).status).toBe(404);
    await h.http().delete(`/medicines/${m.id}`).set(auth(token)).expect(204);
    expect(await doses()).toHaveLength(0);
  });

  it('manual mark-taken: owner only, idempotent, audited, blocked when far in the future', async () => {
    await addMed(tablet({ schedules: [{ localTime: '09:00', amountText: '1 tablet', food: 'any' }] })).expect(201);
    await consent(personId);
    const d = await doses();
    await h.http().post(`/doses/${d[0].id}/mark-taken`).set(auth(token)).expect(409); // tomorrow's dose, not due yet
    await h.db.query(`update doses set due_at = $2 where id = $1`, [d[0].id, '2026-11-20T05:00:00Z']);
    const other = await h.login('+19175550199');
    await h.http().post(`/doses/${d[0].id}/mark-taken`).set(auth(other)).expect(404);
    h.publisher.jobs.length = 0;
    const ok = (await h.http().post(`/doses/${d[0].id}/mark-taken`).set(auth(token)).expect(200)).body;
    expect(ok).toMatchObject({ status: 'confirmed', confirmedVia: 'manual' });
    await h.http().post(`/doses/${d[0].id}/mark-taken`).set(auth(token)).expect(200);
    const n = await h.db.query(`select count(*) from audit_log where entity = 'dose' and action = 'marked_taken_manually'`);
    expect(n.rows[0].count).toBe('1');
    expect(h.publisher.named('schedule.replan')).toHaveLength(1);
  });

  it('writes audit entries for medicine changes without phone numbers', async () => {
    await addMed(tablet()).expect(201);
    const r = await h.db.query(`select * from audit_log where entity = 'medicine'`);
    expect(r.rowCount).toBeGreaterThan(0);
    expect(JSON.stringify((await h.db.query('select * from audit_log')).rows)).not.toContain('9876543211');
  });

  it('autocomplete, devices, subscription and test call', async () => {
    const names = (await h.http().get('/medicine-names?q=am').set(auth(token)).expect(200)).body;
    expect(Array.isArray(names)).toBe(true);
    await h.http().get('/medicine-names?q=a').set(auth(token)).expect(400);
    await h.http().post('/devices').set(auth(token)).send({ token: 'fcm-abc' }).expect(204);
    await h.http().post('/devices').set(auth(token)).send({}).expect(400);
    const s = (await h.http().get('/subscription').set(auth(token)).expect(200)).body;
    expect(s.plan).toBe('trial');
    expect(s.status).toBe('trialing');
    const started = (await h.http().post('/subscription').set(auth(token)).send({ plan: 'one_parent' }).expect(200)).body;
    expect(started.subscription.status).toBe('active');
    await h.http().post('/subscription').set(auth(token)).send({ plan: 'gold' }).expect(400);
    await h.http().post('/test-call').set(auth(token)).expect(202);
    expect(h.publisher.named('test.call')).toHaveLength(1);
  });
});
