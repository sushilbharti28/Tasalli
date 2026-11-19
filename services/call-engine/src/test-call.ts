import { systemClock } from './clock.js';
import { defaultConfig } from './engine/deps.js';
import { Engine } from './engine/engine.js';
import { MemorySessionStore } from './flows/session.js';
import { createLogger, maskPhone } from './log.js';
import { FakeSpeech } from './providers/fake-speech.js';
import { buildTwilio, twilioEnv } from './providers/twilio-factory.js';
import { MemoryQueue } from './queue/memory.js';
import { loadRootEnv } from './env.js';
import { DEFAULT_SCRIPTS_DIR, ScriptLibrary } from './scripts/loader.js';
import { createWebhookServer } from './server.js';
import { MemoryStore } from './store/memory.js';

/**
 * pnpm --filter call-engine test-call <E.164>
 * Starts a throwaway webhook server on PORT (default 8080), places one consent-style call through the
 * real consent flow, waits for the call to finish and prints the outcome. Needs the tunnel to be up.
 */
async function main() {
  loadRootEnv();
  const to = process.argv[2];
  if (!to || !/^\+[1-9]\d{6,14}$/.test(to)) throw new Error('Usage: test-call <E.164 number>, e.g. +919876543210');
  const env = twilioEnv(process.env);
  const log = createLogger();
  const { provider, audio } = buildTwilio(process.env);
  const store = new MemoryStore();
  const queue = new MemoryQueue(systemClock);
  const engine = new Engine({
    store, queue, provider, audio, speech: new FakeSpeech(), sessions: new MemorySessionStore(), scripts: new ScriptLibrary(process.env.SCRIPTS_DIR || DEFAULT_SCRIPTS_DIR, log),
    clock: systemClock, log, config: defaultConfig({ callerId: env.fromNumber, publicBaseUrl: env.publicBaseUrl }),
  });
  queue.setHandler((n, d) => engine.handleJob(n, d));
  const user = store.addUser({ phone: to, name: 'Test', locale: 'hi' });
  store.addSubscription(user.id); // local test only: the billing gate needs an entitled account
  const person = store.addPerson({ ownerUserId: user.id, phone: to, nickname: 'Test', language: 'hi', consent: 'pending' });
  const port = Number(process.env.CALL_ENGINE_PORT || process.env.PORT || 8080);
  const server = createWebhookServer(engine, provider, env.publicBaseUrl, log).listen(port);
  await queue.add('consent.call', { personId: person.id });
  await queue.runDue();
  console.log(`Calling ${maskPhone(to)}. Answer, then press 1 or say "haan" (9 to opt out). Waiting up to 3 minutes...`);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const call = store.allCalls()[0];
    if (call?.endedAt) {
      console.log(`Call ${call.status}; result: ${call.result ?? 'none'}; input: ${call.inputKind ?? '-'} ${call.inputValue ?? ''}; consent now: ${store.state.people.get(person.id)!.consent}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
