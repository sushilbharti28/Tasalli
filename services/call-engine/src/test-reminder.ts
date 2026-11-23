import { systemClock } from './clock.js';
import { defaultConfig } from './engine/deps.js';
import { Engine } from './engine/engine.js';
import { softLimitSeconds } from './flows/limits.js';
import { MemorySessionStore } from './flows/session.js';
import { createLogger, maskPhone } from './log.js';
import { FakeSpeech } from './providers/fake-speech.js';
import { buildTwilio, twilioEnv } from './providers/twilio-factory.js';
import { MemoryQueue } from './queue/memory.js';
import { DateTime } from 'luxon';
import { loadRootEnv } from './env.js';
import { DEFAULT_SCRIPTS_DIR, ScriptLibrary } from './scripts/loader.js';
import { createWebhookServer } from './server.js';
import { MemoryStore } from './store/memory.js';
import type { MedicineRow } from './types.js';

/**
 * pnpm --filter call-engine test-reminder <E.164> [--split]
 * One reminder call with three medicines due now (tablet, capsule, syrup, all after food), gone through one at a time.
 * --split: the capsule is before food, so it is a separate call; only the first call is placed and the second is reported as scheduled.
 * Throwaway webhook server on CALL_ENGINE_PORT (default 8080), in-memory store, no recording. Prints each medicine's outcome and what was heard.
 * Needs the tunnel to be up (same setup as test-call).
 */
async function main() {
  process.env.TWILIO_RECORD = 'false'; // test: not recorded
  loadRootEnv();
  process.env.TWILIO_RECORD = 'false';
  const split = process.argv.includes('--split');
  const to = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!to || !/^\+[1-9]\d{6,14}$/.test(to)) throw new Error('Usage: test-reminder <E.164 number> [--split], e.g. +919876543210');
  const env = twilioEnv(process.env);
  const log = createLogger();
  const { provider, audio } = buildTwilio(process.env);
  const store = new MemoryStore();
  const queue = new MemoryQueue(systemClock);
  const sessions = new MemorySessionStore();
  const engine = new Engine({
    store, queue, provider, audio, speech: new FakeSpeech(), sessions, scripts: new ScriptLibrary(process.env.SCRIPTS_DIR || DEFAULT_SCRIPTS_DIR, log),
    clock: systemClock, log, config: defaultConfig({ callerId: env.fromNumber, publicBaseUrl: env.publicBaseUrl }),
  });
  queue.setHandler((n, d) => engine.handleJob(n, d));
  const user = store.addUser({ phone: to, name: 'Rahul', locale: 'hi' });
  store.addSubscription(user.id); // local test only: the billing gate needs an entitled account
  const person = store.addPerson({ ownerUserId: user.id, phone: to, nickname: 'Papa', fullName: 'Ramesh Sharma', callerRelation: 'son', language: 'hi', consent: 'consented' });

  const now = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const localTime = DateTime.fromJSDate(now, { zone: person.timeZone }).toFormat('HH:mm');
  const meds: Array<{ m: Partial<MedicineRow> & { spokenName: string }; amount: string; food: 'before' | 'after' }> = [
    { m: { stripName: 'Telma 40', spokenName: 'BP wali tablet', kind: 'tablet', size: 'dal', colourPrimary: 'white', shape: 'round', marking: 'line', keptIn: 'strip', packColour: 'red' },
      amount: '1 goli', food: 'after' },
    { m: { stripName: 'Glycomet 500', spokenName: 'sugar wali', kind: 'capsule', colourPrimary: 'yellow', colourSecondary: 'white', keptIn: 'strip', packColour: 'silver' },
      amount: '1 capsule', food: split ? 'before' : 'after' },
    { m: { stripName: 'Cremaffin', spokenName: 'pet wali dawai', kind: 'syrup', keptIn: 'bottle', packColour: 'brown', capColour: 'red' },
      amount: '1 chammach (5 ml)', food: 'after' },
  ];
  const doseIds: string[] = [];
  const names = new Map<string, string>();
  for (const x of meds) {
    const med = store.addMedicine({ personId: person.id, ...x.m });
    const sched = store.addSchedule({ medicineId: med.id, localTime, amountText: x.amount, food: x.food });
    await store.insertDoses([{ scheduleId: sched.id, personId: person.id, dueAt: now }]);
    const dose = (await store.listDoses(person.id, now, new Date(now.getTime() + 1000)))?.find((d) => d.scheduleId === sched.id);
    if (dose) { doseIds.push(dose.id); names.set(dose.id, med.spokenName); }
  }
  const port = Number(process.env.CALL_ENGINE_PORT || process.env.PORT || 8080);
  const server = createWebhookServer(engine, provider, env.publicBaseUrl, log).listen(port);
  for (const id of doseIds) await queue.add('dose.due', { doseId: id }); // like the scheduler: same time and food timing share one call
  await queue.runDue();
  console.log(`Calling ${maskPhone(to)} about ${split ? 'the first call of ' : ''}3 medicines. Answer "haan" or 1 to the opening; for each medicine say "haan" or press 1, "nahi li" or 2 for not now, "phir se" or 0 to hear it again (at most twice). Waiting up to 5 minutes...`);
  const deadline = Date.now() + 300_000;
  let call = store.allCalls()[0];
  while (Date.now() < deadline) {
    call = store.allCalls()[0];
    if (call?.endedAt) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!call?.endedAt) console.log('The call did not finish in time.');
  const session = call ? await sessions.get(call.id) : null;
  console.log(`Call ${call?.status ?? 'not placed'}. (Test: no retries or snooze calls are placed.)`);
  // Elapsed call time, from answer to hang-up: the soft limit is 180 s for up to 5 medicines, +40 s per medicine above 5.
  const from = session?.answeredAtMs ?? call?.startedAt?.getTime();
  const to2 = call?.endedAt?.getTime();
  console.log(from !== undefined && to2 !== undefined ? `Elapsed call seconds: ${Math.round((to2 - from) / 1000)} (soft limit ${softLimitSeconds(doseIds.length)} s)` : 'Elapsed call seconds: unknown (the call did not connect or finish)');
  if (session?.presence) {
    const h = session.presence.heard ?? [];
    console.log(`- opening question ("haan" or 1 to hear the medicines): ${session.presence.state === 'ok' ? 'answered' : 'not answered'}; heard: ${h.length ? h.map((x) => `"${x}"`).join(', ') : 'nothing'}`);
  }
  for (const id of doseIds) {
    const outcome = session?.reminder?.outcomes[id];
    const dose = await store.getDose(id);
    if (!dose?.callGroupId) {
      const at = queue.nextRunAt();
      console.log(`- ${names.get(id)}: second call scheduled${at ? ` for ${new Date(at).toLocaleTimeString()}` : ''} (different food timing); not placed in this test`);
      continue;
    }
    const label = outcome === 'confirmed' ? 'confirmed' : outcome === 'declined' ? 'not taken' : 'no answer';
    const heard = session?.reminder?.heard[id] ?? [];
    console.log(`- ${names.get(id)}: ${label}; heard: ${heard.length ? heard.map((h) => `"${h}"`).join(', ') : 'nothing'}`);
  }
  server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
