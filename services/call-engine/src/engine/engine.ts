import type { CallEvent, NextAction } from '@tasalli/contracts';
import type { CallRow } from '../types.js';
import type { EngineJobName, EngineJobs } from '../queue/jobs.js';
import { afterNoConfirmation, consentUnanswered, placeConsent, placeReminder, placeTest } from './calls.js';
import { type Deps, decodeAttempt, encodeAttempt } from './deps.js';
import { handleInput } from './flows.js';
import { doseDue, doseRemind, eveningSummary, planAll, planPerson } from './scheduler.js';
import { fetchRecording } from '../recordings/fetch.js';
import type { RecordingEvent } from '../providers/twilio.js';
import { WebhookPayloadError, WebhookSignatureError } from '../providers/fake-telephony.js';

export interface HttpResult {
  status: number;
  contentType: string;
  body: string;
}

/** Download/delete retries with exponential backoff (5 s base): about 10 minutes of retrying in total. */
const RECORDING_ATTEMPTS = 8;
const TERMINAL = new Set(['no_answer', 'busy', 'failed', 'completed']);

export class Engine {
  private chains = new Map<string, Promise<unknown>>();

  constructor(readonly d: Deps) {}

  /** Job dispatcher: used by the BullMQ worker and by MemoryQueue. */
  async handleJob(name: EngineJobName, data: unknown): Promise<void> {
    const { d } = this;
    switch (name) {
      case 'schedule.plan_all': return planAll(d);
      case 'schedule.replan': return planPerson(d, (data as EngineJobs['schedule.replan']).personId);
      case 'dose.due': return doseDue(d, (data as EngineJobs['dose.due']).doseId);
      case 'reminder.retry': {
        const j = data as EngineJobs['reminder.retry'];
        return placeReminder(d, j.callGroupId, j.attempt);
      }
      case 'reminder.snooze': return placeReminder(d, (data as EngineJobs['reminder.snooze']).callGroupId, encodeAttempt(1, 0));
      case 'consent.call': return placeConsent(d, (data as EngineJobs['consent.call']).personId, 0);
      case 'consent.retry': {
        const j = data as EngineJobs['consent.retry'];
        return placeConsent(d, j.personId, j.attempt);
      }
      case 'dose.remind': return doseRemind(d, (data as EngineJobs['dose.remind']).doseId);
      case 'summary.evening': {
        const j = data as EngineJobs['summary.evening'];
        return eveningSummary(d, j.personId, j.localDate);
      }
      case 'recording.fetch': return fetchRecording(d, data as EngineJobs['recording.fetch']);
      case 'test.call': return placeTest(d, (data as EngineJobs['test.call']).userId);
    }
  }

  /** Per-call serialisation so concurrent duplicate webhooks see each other's results. */
  private locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.chains.set(key, tail);
    void tail.then(() => { if (this.chains.get(key) === tail) this.chains.delete(key); });
    return run;
  }

  /** Verify, de-duplicate (rule 6), apply. Always answers 200 for a valid event, however many times it arrives. */
  async handleWebhook(headers: Record<string, string>, body: unknown): Promise<HttpResult> {
    const { d } = this;
    let ev: CallEvent;
    try {
      ev = d.provider.parseWebhook(headers, body);
    } catch (err) {
      if (err instanceof WebhookSignatureError || (err as Error).name === 'WebhookSignatureError') return plain(401, 'invalid signature');
      if (err instanceof WebhookPayloadError || (err as Error).name === 'WebhookPayloadError') return plain(400, 'bad payload');
      d.log.error('webhook parse failed', { err: (err as Error).message });
      return plain(400, 'bad request');
    }
    return this.locked(ev.callId, async () => {
      const call = await d.store.getCall(ev.callId);
      const first = await d.store.recordWebhookEvent(d.provider.name, ev.eventId, d.clock.now());
      if (!call) return ev.type === 'input' ? render(d, { action: 'hangup' }, ev.callId) : plain(200, 'unknown call');
      if (ev.type === 'status') {
        if (first) await this.onStatus(call, ev);
        return plain(200, 'ok');
      }
      const session = await d.sessions.get(call.id);
      if (!session) return render(d, { action: 'hangup' }, call.id);
      const replay = session.responses[ev.eventId];
      if (replay) return render(d, replay, call.id);
      if (!first || call.endedAt) return render(d, { action: 'hangup' }, call.id); // duplicate whose reply was lost: end safely
      const next = await handleInput(d, call, session, ev);
      session.responses[ev.eventId] = next;
      await d.sessions.set(session);
      return render(d, next, call.id);
    });
  }

  /**
   * Recording-completed webhook (Twilio only). Verified, then handed to the `recording.fetch` job (deduped by RecordingSid, rule 6):
   * the audio is copied to our storage in India, calls.recording_url gets our path, and the provider's copy is deleted.
   * Always 200 for a valid event, however many times it arrives.
   */
  async handleRecordingWebhook(headers: Record<string, string>, body: unknown): Promise<HttpResult> {
    const { d } = this;
    const parse = (d.provider as unknown as { parseRecordingWebhook?: (h: Record<string, string>, b: unknown) => RecordingEvent }).parseRecordingWebhook;
    if (!parse) return plain(404, 'not found');
    let ev: RecordingEvent;
    try {
      ev = parse.call(d.provider, headers, body);
    } catch (err) {
      if (err instanceof WebhookSignatureError || (err as Error).name === 'WebhookSignatureError') return plain(401, 'invalid signature');
      return plain(400, 'bad payload');
    }
    if (ev.status !== 'completed' || !ev.recordingUrl) return plain(200, 'ignored');
    return this.locked(ev.callId, async () => {
      const call = await d.store.getCall(ev.callId);
      if (!call) return plain(200, 'unknown call');
      // Enqueue first (jobId makes it idempotent), then log the event: a crash in between lets Twilio's retry enqueue again.
      await d.queue.add('recording.fetch', { callId: call.id, recordingSid: ev.recordingSid, recordingUrl: ev.recordingUrl! },
        { jobId: `recording_${ev.recordingSid}`, attempts: RECORDING_ATTEMPTS });
      await d.store.recordWebhookEvent(d.provider.name, `${ev.recordingSid}:recording:completed`, d.clock.now());
      return plain(200, 'ok');
    });
  }

  private async onStatus(call: CallRow, ev: Extract<CallEvent, { type: 'status' }>): Promise<void> {
    const { d } = this;
    if (call.endedAt) return; // late or re-sent after the call ended
    const at = new Date(ev.at);
    if (ev.status === 'ringing' || ev.status === 'answered') {
      await d.store.updateCall(call.id, { status: ev.status, ...(ev.status === 'answered' ? { startedAt: at } : {}) });
      return;
    }
    if (!TERMINAL.has(ev.status)) return;
    await d.store.updateCall(call.id, { status: ev.status, endedAt: at });
    const resolved = call.result !== null && call.result !== 'none';
    if (ev.status === 'completed' && resolved) return;
    if (call.purpose === 'reminder' && call.callGroupId) await afterNoConfirmation(d, call.callGroupId, call.attempt);
    else if (call.purpose === 'consent' && call.personId) await consentUnanswered(d, call.personId, call.attempt);
  }
}

const plain = (status: number, body: string): HttpResult => ({ status, contentType: 'text/plain', body });
/** Some providers (Twilio) need the call id to build the next webhook URL: an optional second argument. */
type Render = (next: NextAction, ctx?: { callId: string }) => { contentType: string; body: string };
const render = (d: Deps, next: NextAction, callId: string): HttpResult =>
  ({ status: 200, ...(d.provider.renderNextAction as Render).call(d.provider, next, { callId }) });
export { decodeAttempt };
