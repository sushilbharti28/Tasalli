import { describe, expect, it } from 'vitest';
import { FAKE_SIGNATURE_HEADER, sign } from '../src/providers/fake-telephony.js';
import { PARENT, world } from './helpers.js';

async function setup(scenario: Parameters<ReturnType<typeof world>['provider']['script']>[1]) {
  const w = world();
  w.med('Amlodac', '09:00');
  w.provider.script(PARENT, scenario);
  await w.queue.add('schedule.replan', { personId: w.mom.id });
  await w.advance(5);
  return w;
}

describe('idempotent signed webhooks (rule 6)', () => {
  it('duplicate webhooks: one call, one confirmation', async () => {
    const w = await setup({ answer: 'answered', inputs: [{ key: '1' }], duplicateWebhooks: true });
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
    expect(w.store.allDoses().filter((d) => d.status === 'confirmed')).toHaveLength(1);
    // the duplicate input got the same reply as the original
    const r = w.provider.callsTo(PARENT)[0]!.responses.filter((x) => x.body.includes('hangup'));
    expect(r.length).toBe(2);
    expect(r[0]!.body).toBe(r[1]!.body);
  });

  it('concurrent duplicates behave the same', async () => {
    const w = await setup({ answer: 'answered', inputs: [{ say: 'nahi li' }], duplicateWebhooks: true, concurrentDuplicates: true });
    expect(w.queue.history.filter((h) => h.name === 'reminder.snooze')).toHaveLength(0);
    await w.advance(16);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1); // v1.6: "nahi li" is not taken; no call back
    expect(w.queue.alerts).toHaveLength(1); // the family is told exactly once
  });

  it('duplicate no_answer status does not double the retries', async () => {
    const w = await setup({ answer: 'no_answer', duplicateWebhooks: true });
    await w.advance(11);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
  });

  it('a terminal status re-sent with a new event id is ignored', async () => {
    const w = await setup({ answer: 'no_answer', resendTerminalWithNewId: true });
    await w.advance(11);
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    await w.advance(10);
    expect(w.provider.callsTo(PARENT)).toHaveLength(3);
  });

  it('duplicate stop does not duplicate the opted_out alert', async () => {
    const w = await setup({ answer: 'answered', inputs: [{ key: '9' }], duplicateWebhooks: true });
    expect(w.queue.alerts.filter((a) => a.job.kind === 'opted_out')).toHaveLength(1);
  });

  it('wrong signature is rejected and changes nothing', async () => {
    const w = await setup({ answer: 'answered', inputs: [{ key: '1' }], badSignature: true });
    expect(w.provider.callsTo(PARENT)[0]!.responses.every((r) => r.status === 401)).toBe(true);
    expect(w.store.allDoses().some((d) => d.status === 'confirmed')).toBe(false);
  });

  it('forged key press without a signature is rejected', async () => {
    const w = await setup({ answer: 'no_answer' });
    const call = w.store.allCalls()[0]!;
    const body = { type: 'input', kind: 'key', value: '1', eventId: 'x1', callId: call.id, providerCallId: 'p', at: new Date().toISOString() };
    expect((await w.engine.handleWebhook({}, body)).status).toBe(401);
    expect((await w.engine.handleWebhook({ [FAKE_SIGNATURE_HEADER]: sign('nope', body) }, body)).status).toBe(401);
    expect(w.store.allDoses().some((d) => d.status === 'confirmed')).toBe(false);
  });

  it('a replayed job (same dose.due delivered twice) does not create a second call', async () => {
    const w = world();
    w.med('Amlodac', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }] });
    await w.queue.add('schedule.replan', { personId: w.mom.id });
    await w.advance(1);
    const dose = w.store.allDoses()[0]!;
    await w.engine.handleJob('dose.due', { doseId: dose.id });
    await w.engine.handleJob('dose.due', { doseId: dose.id });
    await w.settle();
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
  });
});

describe('logs (rule 8)', () => {
  it('mask phone numbers', async () => {
    const { maskPhone } = await import('../src/log.js');
    expect(maskPhone(PARENT)).toBe('********3210');
  });
});
