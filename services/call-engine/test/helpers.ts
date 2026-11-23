import { FakeClock, MINUTE } from '../src/clock.js';
import { Engine } from '../src/engine/engine.js';
import { defaultConfig } from '../src/engine/deps.js';
import { MemorySessionStore } from '../src/flows/session.js';
import { FakeProvider } from '../src/providers/fake-telephony.js';
import { FakeSpeech } from '../src/providers/fake-speech.js';
import { MemoryQueue } from '../src/queue/memory.js';
import { ScriptLibrary } from '../src/scripts/loader.js';
import { MemoryStore } from '../src/store/memory.js';
import { AudioCache, MemoryAudioStorage } from '../src/tts/cache.js';
import { silentLogger, type Logger } from '../src/log.js';

export const PARENT = '+919876543210';

/** 2026-03-10 is a Tuesday. 09:00 IST = 03:30Z; default start is one minute before. */
export function world(start = '2026-03-10T03:29:00Z', opts: { scripts?: ScriptLibrary; log?: Logger; presence?: boolean } = {}) {
  const scripts = opts.scripts ?? new ScriptLibrary(null);
  // Most tests are about the medicine flow itself, so the "can you hear me?" step is off unless a test asks for it (presence: true).
  if (!opts.presence) for (const l of ['hi', 'en'] as const) scripts.get(l).templates.reminder.step_presence = undefined;
  const clock = new FakeClock(start);
  const store = new MemoryStore();
  const queue = new MemoryQueue(clock);
  const provider = new FakeProvider('s3cret', clock);
  const speech = new FakeSpeech();
  const audio = new AudioCache(speech, new MemoryAudioStorage());
  const engine = new Engine({
    store, queue, provider, audio, speech, scripts, sessions: new MemorySessionStore(), clock,
    log: opts.log ?? silentLogger, config: defaultConfig(),
  });
  queue.setHandler((n, data) => engine.handleJob(n, data));
  provider.connect(async (h, b) => engine.handleWebhook(h, b));

  const user = store.addUser({ phone: '+919000000001', name: 'Rohit' });
  store.addSubscription(user.id); // active: the billing gate lets reminders through
  const mom = store.addPerson({ ownerUserId: user.id, phone: PARENT, nickname: 'Mummy', consent: 'consented' });
  function med(name: string, time: string, over = {}, person = mom) {
    const m = store.addMedicine({ personId: person.id, spokenName: name, ...over });
    const s = store.addSchedule({ medicineId: m.id, localTime: time, amountText: 'ek goli' });
    return { m, s };
  }
  /** Run jobs and play out fake calls until nothing is left to do at the current time. */
  async function settle() {
    for (let i = 0; i < 50; i++) {
      const jobs = await queue.runDue();
      const calls = await provider.runPending();
      if (!jobs && !calls) return;
    }
    throw new Error('did not settle');
  }
  async function advance(minutes: number) {
    // Step through job times so retries fire at their own instants.
    const end = clock.now().getTime() + minutes * MINUTE;
    for (;;) {
      await settle();
      const next = queue.nextRunAt();
      if (next === null || next > end) break;
      clock.set(new Date(Math.max(next, clock.now().getTime())));
    }
    clock.set(new Date(end));
    await settle();
  }
  const text = (url: string) => audio.textFor(url) ?? '';
  const playedText = (i: number, to = PARENT) => provider.callsTo(to)[i]!.played.map(text);
  return { clock, store, queue, provider, speech, audio, engine, user, mom, med, settle, advance, text, playedText };
}
export type World = ReturnType<typeof world>;
