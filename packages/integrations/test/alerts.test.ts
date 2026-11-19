import { beforeEach, describe, expect, it } from 'vitest';
import {
  AlertRetryableError,
  FakePushSender,
  FakeWhatsAppSender,
  InMemoryAlertData,
  InMemoryIdempotencyStore,
  MemoryLogger,
  handleAlertJob,
  type AlertDeps,
  type AlertJob,
} from '../src';
import missedFixture from './fixtures/alerts/dose-missed.json';

const CHILD_PHONE = '+919876512861';

function world() {
  const data = new InMemoryAlertData();
  data.people.set('p1', { id: 'p1', ownerUserId: 'u1', nickname: 'Papa', timeZone: 'Asia/Kolkata' });
  data.recipients.set('u1', {
    userId: 'u1', phoneE164: CHILD_PHONE, locale: 'en', timeZone: 'Asia/Kolkata', whatsappOptIn: true, pushTokens: ['tok-a', 'tok-b'],
  });
  // 9:00 IST = 03:30 UTC
  data.doses.set('d1', { personId: 'p1', doseId: 'd1', spokenName: 'BP wali', dueAt: '2026-11-19T03:30:00Z', status: 'missed' });
  data.doses.set('d2', { personId: 'p1', doseId: 'd2', spokenName: 'Sugar wali', dueAt: '2026-11-19T03:30:00Z', status: 'missed' });
  data.doses.set('d3', { personId: 'p1', doseId: 'd3', spokenName: 'BP wali', dueAt: '2026-11-19T15:30:00Z', status: 'confirmed' });
  data.doses.set('d4', { personId: 'p1', doseId: 'd4', spokenName: 'Neend wali', dueAt: '2026-11-19T16:30:00Z', status: 'upcoming' });
  data.doses.set('d5', { personId: 'p1', doseId: 'd5', spokenName: 'BP wali', dueAt: '2026-11-18T15:30:00Z', status: 'missed' }); // yesterday
  const push = new FakePushSender();
  const whatsapp = new FakeWhatsAppSender();
  const logger = new MemoryLogger();
  const deps: AlertDeps = { data, push, whatsapp, idempotency: new InMemoryIdempotencyStore(), logger, androidChannelId: 'alerts' };
  return { data, push, whatsapp, logger, deps };
}

const missed = missedFixture.data as AlertJob;
const missedId = missedFixture.id;

describe('dose_missed alert', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => { w = world(); });

  it('sends one push (to every device) and one WhatsApp, with the family words verbatim', async () => {
    const out = await handleAlertJob(missedId, missed, w.deps);
    expect(out).toEqual({ status: 'sent', channels: ['push', 'whatsapp'] });
    expect(w.push.sent.map((p) => p.token)).toEqual(['tok-a', 'tok-b']);
    expect(w.push.sent[0]).toMatchObject({
      title: 'Papa: medicine not confirmed',
      body: 'The 9:00 am reminder (BP wali, Sugar wali) was not confirmed.',
      data: { type: 'dose_missed', personId: 'p1', callGroupId: 'g1' },
      androidChannelId: 'alerts',
      tag: 'g1',
    });
    expect(w.whatsapp.sent).toHaveLength(1);
    expect(w.whatsapp.sent[0]).toMatchObject({ to: CHILD_PHONE, template: 'missed_dose_alert' });
    expect(w.whatsapp.sent[0]!.text).toBe(
      'Tasalli: Papa did not confirm the 9:00 am medicine reminder (BP wali, Sugar wali). You may want to check on them.',
    );
  });

  it('a duplicate delivery of the same job sends nothing more (exactly one alert)', async () => {
    await handleAlertJob(missedId, missed, w.deps);
    await handleAlertJob(missedId, missed, w.deps);
    await handleAlertJob(missedId, { ...missed }, w.deps);
    expect(w.push.sent).toHaveLength(2); // 2 devices, one logical push
    expect(w.whatsapp.sent).toHaveLength(1);
  });

  it('on a retry, only the channel that failed is sent again', async () => {
    w.whatsapp.failNext(1, true);
    await expect(handleAlertJob(missedId, missed, w.deps)).rejects.toBeInstanceOf(AlertRetryableError);
    expect(w.push.sent).toHaveLength(2);
    expect(w.whatsapp.sent).toHaveLength(0);
    expect(await handleAlertJob(missedId, missed, w.deps)).toEqual({ status: 'sent', channels: ['whatsapp'] });
    expect(w.push.sent).toHaveLength(2);
    expect(w.whatsapp.sent).toHaveLength(1);
  });

  it('push retries when every device failed temporarily, but one good device is enough', async () => {
    w.push.failNext('tok-a');
    await handleAlertJob(missedId, missed, w.deps);
    expect(w.push.sent.map((p) => p.token)).toEqual(['tok-b']);

    const w2 = world();
    w2.push.failNext('tok-a');
    w2.push.failNext('tok-b');
    await expect(handleAlertJob(missedId, missed, w2.deps)).rejects.toThrow(/retry push/);
    await handleAlertJob(missedId, missed, w2.deps);
    expect(w2.push.sent).toHaveLength(2);
    expect(w2.whatsapp.sent).toHaveLength(1);
  });

  it('removes dead push tokens and does not retry them', async () => {
    w.push.markInvalid('tok-a');
    await handleAlertJob(missedId, missed, w.deps);
    expect(w.data.removedTokens).toEqual([{ userId: 'u1', token: 'tok-a' }]);
    expect(w.data.recipients.get('u1')!.pushTokens).toEqual(['tok-b']);
  });

  it('a permanent WhatsApp failure is logged with a masked number and not retried', async () => {
    w.whatsapp.failNext(1, false);
    expect(await handleAlertJob(missedId, missed, w.deps)).toEqual({ status: 'sent', channels: ['push'] });
    const log = w.logger.lines.join('\n');
    expect(log).toContain('failed permanently');
    expect(log).not.toContain('9876512861');
    await handleAlertJob(missedId, missed, w.deps);
    expect(w.whatsapp.sent).toHaveLength(0);
  });

  it('skips when the family marked the doses taken in the meantime', async () => {
    w.data.doses.get('d1')!.status = 'confirmed';
    w.data.doses.get('d2')!.status = 'confirmed';
    expect(await handleAlertJob(missedId, missed, w.deps)).toEqual({ status: 'skipped', why: 'doses no longer missed' });
    expect(w.push.sent).toHaveLength(0);
  });

  it('only lists the doses still missed', async () => {
    w.data.doses.get('d2')!.status = 'confirmed';
    await handleAlertJob(missedId, missed, w.deps);
    expect(w.whatsapp.sent[0]!.params['medicines']).toBe('BP wali');
  });

  it('no WhatsApp without opt-in; no push without tokens', async () => {
    w.data.recipients.get('u1')!.whatsappOptIn = false;
    w.data.recipients.get('u1')!.pushTokens = [];
    expect(await handleAlertJob(missedId, missed, w.deps)).toEqual({ status: 'sent', channels: [] });
    expect(w.whatsapp.sent).toHaveLength(0);
  });

  it('says "said not taken" when the parent said so', async () => {
    await handleAlertJob('x', { ...missed, reason: 'said_not_taken' }, w.deps);
    expect(w.push.sent[0]!.body).toBe('Papa said they have not taken the 9:00 am medicine (BP wali, Sugar wali).');
  });

  it('shows the parent\'s time with the zone name when the child lives elsewhere', async () => {
    w.data.recipients.get('u1')!.timeZone = 'America/New_York';
    await handleAlertJob(missedId, missed, w.deps);
    expect(w.whatsapp.sent[0]!.params['time']).toMatch(/^9:00 am (IST|GMT\+5:30)$/);
  });

  it('Hindi recipient gets Hindi texts', async () => {
    w.data.recipients.get('u1')!.locale = 'hi';
    await handleAlertJob(missedId, missed, w.deps);
    expect(w.push.sent[0]!.title).toBe('Papa: दवाई की पुष्टि नहीं हुई');
    expect(w.whatsapp.sent[0]!.text).toContain('BP wali, Sugar wali');
    expect(w.whatsapp.sent[0]!.locale).toBe('hi');
  });

  it('skips deleted people and accounts (rule 9) and unknown kinds', async () => {
    w.data.people.delete('p1');
    expect(await handleAlertJob(missedId, missed, w.deps)).toMatchObject({ status: 'skipped', why: 'person deleted' });
    const w2 = world();
    w2.data.recipients.delete('u1');
    expect(await handleAlertJob(missedId, missed, w2.deps)).toMatchObject({ status: 'skipped', why: 'account deleted' });
    expect(await handleAlertJob('y', { ...missed, kind: 'mystery' as AlertJob['kind'] }, w.deps)).toMatchObject({ status: 'skipped' });
  });
});

describe('other alert kinds', () => {
  it.each([
    ['doctor_changed', 'Papa: doctor changed a medicine'],
    ['unwell', 'Papa is not feeling well'],
    ['opted_out', 'Papa stopped the calls'],
    ['consent_given', 'Papa said yes'],
    ['consent_declined', 'Papa said no'],
    ['consent_no_answer', 'Papa did not answer'],
  ])('%s sends a push only', async (kind, title) => {
    const w = world();
    const job: AlertJob = { kind: kind as AlertJob['kind'], personId: 'p1', ownerUserId: 'u1', callGroupId: null, doseIds: [], at: '2026-11-19T04:00:00Z' };
    expect(await handleAlertJob(`${kind}_p1`, job, w.deps)).toEqual({ status: 'sent', channels: ['push'] });
    expect(w.push.sent[0]!.title).toBe(title);
    expect(w.push.sent[0]!.tag).toBe(`${kind}-p1`);
    expect(w.whatsapp.sent).toHaveLength(0);
  });
});

describe('evening_summary', () => {
  const job: AlertJob = {
    kind: 'evening_summary', personId: 'p1', ownerUserId: 'u1', callGroupId: null, doseIds: [],
    at: '2026-11-19T15:00:00Z', localDate: '2026-11-19',
  };

  it('counts decided doses of the parent\'s local day and lists the missed ones', async () => {
    const w = world();
    await handleAlertJob('evening_summary_p1_2026-11-19', job, w.deps);
    expect(w.whatsapp.sent[0]!.params).toEqual({
      person_name: 'Papa', date: '19 Nov', confirmed: '1', total: '3',
      not_confirmed: '9:00 am BP wali, 9:00 am Sugar wali',
    });
    expect(w.push.sent[0]!.body).toBe('1 of 3 medicine reminders confirmed. Not confirmed: 9:00 am BP wali, 9:00 am Sugar wali');
  });

  it('says none when everything was confirmed, and is sent once', async () => {
    const w = world();
    w.data.doses.get('d1')!.status = 'confirmed';
    w.data.doses.get('d2')!.status = 'confirmed';
    await handleAlertJob('s1', job, w.deps);
    await handleAlertJob('s1', job, w.deps);
    expect(w.whatsapp.sent).toHaveLength(1);
    expect(w.whatsapp.sent[0]!.params['not_confirmed']).toBe('none');
  });

  it('derives the local date from `at` in the parent\'s zone when localDate is absent', async () => {
    const w = world();
    // 20:00 UTC on the 18th is 01:30 IST on the 19th
    await handleAlertJob('s2', { ...job, localDate: undefined, at: '2026-11-18T20:00:00Z' }, w.deps);
    expect(w.whatsapp.sent[0]!.params['total']).toBe('3');
  });

  it('is skipped on a day with nothing decided', async () => {
    const w = world();
    expect(await handleAlertJob('s3', { ...job, localDate: '2026-11-25' }, w.deps)).toMatchObject({ status: 'skipped' });
  });
});

describe('plan_lapsed', () => {
  const job: AlertJob = {
    kind: 'plan_lapsed', personId: 'p1', ownerUserId: 'u1', callGroupId: null, doseIds: [],
    at: '2026-11-19T03:30:00Z', localDate: '2026-11-19', reason: 'plan_not_entitled',
  };

  it('pushes and WhatsApps the founder text with the nickname (English recipient)', async () => {
    const w = world();
    await handleAlertJob('plan_lapsed_u1_2026-11-19', job, w.deps);
    expect(w.push.sent[0]!.body).toBe("Papa's medicine reminder calls have stopped because payment is pending. Please renew your plan in the app.");
    expect(w.whatsapp.sent).toHaveLength(1);
    expect(w.whatsapp.sent[0]).toMatchObject({ template: 'plan_lapsed', params: { person_name: 'Papa' } });
  });

  it('uses the Hindi wording for a Hindi recipient', async () => {
    const w = world();
    w.data.recipients.get('u1')!.locale = 'hi';
    await handleAlertJob('plan_lapsed_u1_2026-11-19', job, w.deps);
    expect(w.push.sent[0]!.body).toBe('Papa ke dawai ke reminder calls ruk gaye hain kyunki payment baaki hai. App mein plan renew karein.');
  });

  it('is sent once for a repeated job id', async () => {
    const w = world();
    await handleAlertJob('plan_lapsed_u1_2026-11-19', job, w.deps);
    await handleAlertJob('plan_lapsed_u1_2026-11-19', job, w.deps);
    expect(w.whatsapp.sent).toHaveLength(1);
    expect(w.push.sent).toHaveLength(2); // one per device token, not repeated
  });
});
