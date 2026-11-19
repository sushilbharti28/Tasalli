// In-memory reference call engine. It implements EngineUnderTest so the
// scenario suites can be run (and proven green) before services/call-engine
// exists. It documents the behaviour the suites expect; it is not production code.

import { randomUUID } from 'node:crypto';
import {
  CONSENT_KEYS, REMINDER_KEYS, RULES,
  type CallEvent, type CallPurpose, type CallStep, type NextAction, type ReplyIntent,
} from '@tasalli/contracts';
import type {
  AddPersonResult, AlertView, DoseStatus, DoseView, EngineDeps, EngineFactory, EngineUnderTest,
  PersonFixture, PersonView, ScheduleFixture, WebhookResponse,
} from '../harness/engine';
import { maskPhone } from '../harness/mask';
import { addDays, isoWeekdayOf, localDateOf, localToUtc } from '../harness/time';
import { referenceMatcher, type ReplyMatcher } from './reference-matcher';

interface Person extends PersonFixture { consentAt: Date | null; deleted: boolean }
interface Schedule extends ScheduleFixture { id: string; createdAt: Date }
interface Dose {
  id: string; scheduleId: string; personId: string; medicineId: string; dueAt: Date;
  status: DoseStatus; confirmedVia: DoseView['confirmedVia']; confirmedAt: Date | null; groupId: string;
}
interface Group {
  id: string; personId: string; purpose: CallPurpose; doseIds: string[]; anchor: Date;
  attempts: number; snoozes: number; nextCallAt: Date | null; activeCallId: string | null;
  done: boolean; alerted: boolean;
}
interface Call {
  id: string; groupId: string; personId: string; purpose: CallPurpose; to: string; placedAt: Date;
  ended: boolean; outcome: ReplyIntent | null; unclear: number;
}

const MIN = 60_000;
const KEYS_REMINDER = Object.keys(REMINDER_KEYS);
const KEYS_CONSENT = Object.keys(CONSENT_KEYS);

export class ReferenceEngine implements EngineUnderTest {
  private accounts = new Map<string, { timeZone: string }>();
  private people = new Map<string, Person>();
  private schedules: Schedule[] = [];
  private doses = new Map<string, Dose>();
  private doseKeys = new Set<string>();
  private groups = new Map<string, Group>();
  private calls = new Map<string, Call>();
  private seen = new Map<string, WebhookResponse>();
  private blocked = new Set<string>();
  private alerts: AlertView[] = [];
  private logLines: string[] = [];

  constructor(private readonly deps: EngineDeps, private readonly matcher: ReplyMatcher = referenceMatcher) {}

  private now(): Date { return this.deps.clock.now(); }
  private log(msg: string): void { this.logLines.push(`${this.now().toISOString()} ${msg}`); }

  async addAccount(accountId: string, opts?: { timeZone?: string }): Promise<void> {
    this.accounts.set(accountId, { timeZone: opts?.timeZone ?? 'Asia/Kolkata' });
  }

  async addPerson(p: PersonFixture): Promise<AddPersonResult> {
    if (!this.accounts.has(p.accountId)) await this.addAccount(p.accountId);
    const count = [...this.people.values()].filter((x) => x.accountId === p.accountId && !x.deleted).length;
    if (count >= RULES.maxPeoplePerAccount) return { ok: false, reason: 'limit_reached' };
    if (this.blocked.has(p.phone)) return { ok: false, reason: 'blocked' };
    const consent = p.isSelf ? 'consented' : p.consent;
    this.people.set(p.personId, { ...p, consent, consentAt: consent === 'consented' ? this.now() : null, deleted: false });
    this.log(`person added ${p.personId} phone=${maskPhone(p.phone)} consent=${consent}`);
    if (consent === 'pending') {
      const g = this.newGroup(p.personId, 'consent', [], this.now());
      g.nextCallAt = this.now();
    }
    return { ok: true };
  }

  async setPaused(personId: string, paused: boolean): Promise<void> {
    this.person(personId).paused = paused;
  }

  async addSchedule(s: ScheduleFixture): Promise<void> {
    this.schedules.push({ ...s, id: randomUUID(), createdAt: this.now() });
  }

  async listDoses(personId: string): Promise<DoseView[]> {
    return [...this.doses.values()]
      .filter((d) => d.personId === personId)
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      .map((d) => ({
        doseId: d.id, personId: d.personId, medicineId: d.medicineId, dueAt: d.dueAt.toISOString(),
        status: d.status, confirmedVia: d.confirmedVia, confirmedAt: d.confirmedAt?.toISOString() ?? null,
      }));
  }

  async listAlerts(personId: string): Promise<AlertView[]> {
    return this.alerts.filter((a) => a.personId === personId);
  }

  async getPerson(personId: string): Promise<PersonView> {
    const p = this.person(personId);
    return { personId, consent: p.consent };
  }

  async isBlocked(phone: string): Promise<boolean> { return this.blocked.has(phone); }

  logs(): string[] { return [...this.logLines]; }

  // ---------------- scheduler ----------------

  async tick(): Promise<void> {
    this.materialise();
    const now = this.now().getTime();
    const due = [...this.groups.values()]
      .filter((g) => !g.done && !g.activeCallId && g.nextCallAt && g.nextCallAt.getTime() <= now)
      .sort((a, b) => a.nextCallAt!.getTime() - b.nextCallAt!.getTime());
    for (const g of due) await this.placeFor(g);
  }

  private eligible(p: Person): boolean {
    return !p.deleted && p.consent === 'consented' && !p.paused && !this.blocked.has(p.phone);
  }

  private materialise(): void {
    const now = this.now();
    for (const p of this.people.values()) {
      if (!this.eligible(p) || !p.consentAt) continue;
      const today = localDateOf(now, p.timeZone);
      for (const date of [today, addDays(today, 1)]) {
        for (const s of this.schedules.filter((x) => x.personId === p.personId)) {
          const dueAt = localToUtc(date, s.localTime, p.timeZone);
          const days = s.daysOfWeek ?? [1, 2, 3, 4, 5, 6, 7];
          if (!days.includes(isoWeekdayOf(dueAt, p.timeZone))) continue;
          const earliest = Math.max(s.createdAt.getTime(), p.consentAt.getTime());
          if (dueAt.getTime() < earliest) continue;
          const key = `${s.id}|${dueAt.toISOString()}`;
          if (this.doseKeys.has(key)) continue;
          this.doseKeys.add(key);
          const id = randomUUID();
          const group = this.groupFor(p.personId, dueAt);
          group.doseIds.push(id);
          this.doses.set(id, {
            id, scheduleId: s.id, personId: p.personId, medicineId: s.medicineId, dueAt,
            status: 'upcoming', confirmedVia: null, confirmedAt: null, groupId: group.id,
          });
        }
      }
    }
  }

  /** Doses within groupWindowMinutes after a not-yet-called group's first dose join that group. */
  private groupFor(personId: string, dueAt: Date): Group {
    for (const g of this.groups.values()) {
      if (g.personId !== personId || g.purpose !== 'reminder' || g.done || g.attempts > 0 || g.activeCallId) continue;
      const diff = dueAt.getTime() - g.anchor.getTime();
      if (diff >= 0 && diff <= RULES.groupWindowMinutes * MIN) return g;
      if (diff < 0 && -diff <= RULES.groupWindowMinutes * MIN) {
        g.anchor = dueAt; g.nextCallAt = dueAt; return g;
      }
    }
    const g = this.newGroup(personId, 'reminder', [], dueAt);
    g.nextCallAt = dueAt;
    return g;
  }

  private newGroup(personId: string, purpose: CallPurpose, doseIds: string[], anchor: Date): Group {
    const g: Group = {
      id: randomUUID(), personId, purpose, doseIds, anchor, attempts: 0, snoozes: 0,
      nextCallAt: null, activeCallId: null, done: false, alerted: false,
    };
    this.groups.set(g.id, g);
    return g;
  }

  private callsToday(phone: string, tz: string): number {
    const today = localDateOf(this.now(), tz);
    return [...this.calls.values()].filter((c) => c.to === phone && localDateOf(c.placedAt, tz) === today).length;
  }

  private async placeFor(g: Group): Promise<void> {
    const p = this.person(g.personId);
    if (g.purpose === 'reminder' && !this.eligible(p)) {
      this.finish(g, 'skipped_paused');
      return;
    }
    if (g.purpose === 'consent' && (p.consent !== 'pending' || this.blocked.has(p.phone))) {
      g.done = true;
      return;
    }
    if (this.callsToday(p.phone, p.timeZone) >= RULES.maxCallsPerNumberPerDay) {
      this.log(`daily cap reached for ${maskPhone(p.phone)}`);
      if (g.purpose === 'reminder') this.giveUp(g);
      else g.done = true;
      return;
    }
    const callId = randomUUID();
    const purpose = g.purpose;
    try {
      await this.deps.telephony.placeCall({
        callId, to: p.phone, callerId: '+910000000000', language: p.language, purpose,
        firstStep: this.step(purpose, true),
        statusWebhookUrl: `${this.deps.webhookBaseUrl}/status`,
        inputWebhookUrl: `${this.deps.webhookBaseUrl}/input`,
      });
    } catch (err) {
      this.log(`placeCall failed for ${maskPhone(p.phone)}: ${(err as Error).message}`);
      g.nextCallAt = new Date(this.now().getTime() + MIN); // transient: try again next minute
      return;
    }
    g.attempts += 1;
    g.activeCallId = callId;
    g.nextCallAt = null;
    this.calls.set(callId, {
      id: callId, groupId: g.id, personId: p.personId, purpose, to: p.phone, placedAt: this.now(),
      ended: false, outcome: null, unclear: 0,
    });
    for (const id of g.doseIds) this.dose(id).status = 'calling';
    this.log(`call ${callId} placed to ${maskPhone(p.phone)} attempt=${g.attempts} purpose=${purpose}`);
  }

  private step(purpose: CallPurpose, speech: boolean): CallStep {
    return {
      audioUrl: `https://audio.test/${purpose}.mp3`,
      listen: { keys: purpose === 'consent' ? KEYS_CONSENT : KEYS_REMINDER, speech, timeoutSeconds: 8 },
    };
  }

  // ---------------- webhooks ----------------

  async handleWebhook(headers: Record<string, string>, body: unknown): Promise<WebhookResponse> {
    let event: CallEvent;
    try {
      event = this.deps.telephony.parseWebhook(headers, body);
    } catch {
      this.log('webhook rejected: bad signature');
      return { status: 401 };
    }
    const key = `${this.deps.telephony.name}:${event.eventId}`;
    const previous = this.seen.get(key);
    if (previous) return previous; // safety rule 6: same answer, no side effects
    const call = this.calls.get(event.callId);
    if (!call) {
      const res = { status: 404 };
      this.seen.set(key, res);
      return res;
    }
    const res = event.type === 'status' ? this.onStatus(call, event.status) : await this.onInput(call, event);
    this.seen.set(key, res);
    return res;
  }

  private onStatus(call: Call, status: string): WebhookResponse {
    if (!['no_answer', 'busy', 'failed', 'completed'].includes(status) || call.ended) return { status: 200 };
    call.ended = true;
    const g = this.groups.get(call.groupId)!;
    if (g.activeCallId === call.id) g.activeCallId = null;
    if (g.done || call.outcome === 'snooze') return { status: 200 };
    // Not confirmed on this attempt: retry or give up.
    if (g.attempts < 1 + RULES.retryCount) {
      g.nextCallAt = new Date(this.now().getTime() + RULES.retryGapMinutes * MIN);
    } else if (g.purpose === 'reminder') {
      this.giveUp(g);
    } else {
      g.done = true;
      this.log(`consent call unanswered after ${g.attempts} attempts`);
    }
    return { status: 200 };
  }

  private async onInput(call: Call, event: Extract<CallEvent, { type: 'input' }>): Promise<WebhookResponse> {
    const p = this.person(call.personId);
    const g = this.groups.get(call.groupId)!;
    let intent: ReplyIntent;
    let via: 'key' | 'speech';
    if (event.kind === 'key') {
      via = 'key';
      const map = call.purpose === 'consent' ? CONSENT_KEYS : REMINDER_KEYS;
      intent = map[event.value] ?? 'unclear';
    } else {
      via = 'speech';
      let transcript = event.transcript;
      if (transcript === undefined && event.audioUrl) {
        transcript = (await this.deps.speech.transcribe(Buffer.from(event.audioUrl), p.language)).transcript;
      }
      intent = await this.matcher(transcript, { language: p.language, purpose: call.purpose === 'consent' ? 'consent' : 'reminder' });
    }
    if (g.done && intent !== 'stop') return { status: 200, next: { action: 'hangup' } };
    return { status: 200, next: call.purpose === 'consent' ? this.consentReply(call, g, p, intent) : this.reminderReply(call, g, p, intent, via) };
  }

  private consentReply(call: Call, g: Group, p: Person, intent: ReplyIntent): NextAction {
    switch (intent) {
      case 'confirm':
        p.consent = 'consented'; p.consentAt = this.now(); g.done = true; call.outcome = 'confirm';
        return { action: 'hangup', finalAudioUrl: 'https://audio.test/consent-thanks.mp3' };
      case 'stop':
        call.outcome = 'stop'; this.block(p.phone, 'key_9');
        return { action: 'hangup', finalAudioUrl: 'https://audio.test/never-again.mp3' };
      case 'decline':
        p.consent = 'declined'; g.done = true; call.outcome = 'decline';
        return { action: 'hangup' };
      default:
        return this.unclear(call);
    }
  }

  private reminderReply(call: Call, g: Group, p: Person, intent: ReplyIntent, via: 'key' | 'speech'): NextAction {
    switch (intent) {
      case 'confirm':
        call.outcome = 'confirm';
        for (const id of g.doseIds) {
          const d = this.dose(id);
          if (d.status !== 'confirmed') Object.assign(d, { status: 'confirmed', confirmedVia: via, confirmedAt: this.now() });
        }
        g.done = true;
        return { action: 'hangup', finalAudioUrl: 'https://audio.test/thanks.mp3' };
      case 'snooze':
        if (g.snoozes >= RULES.maxSnoozesPerDose) {
          // Second snooze is not honoured: ask for 1 instead.
          return { action: 'play', step: { ...this.step('reminder', false), listen: { keys: KEYS_REMINDER.filter((k) => k !== '2'), speech: false, timeoutSeconds: 8 } } };
        }
        g.snoozes += 1; g.attempts = 0; call.outcome = 'snooze';
        g.nextCallAt = new Date(this.now().getTime() + RULES.snoozeMinutes * MIN);
        return { action: 'hangup', finalAudioUrl: 'https://audio.test/snoozed.mp3' };
      case 'repeat':
        return { action: 'play', step: this.step('reminder', true) };
      case 'stop':
        call.outcome = 'stop';
        this.block(p.phone, 'key_9');
        return { action: 'hangup', finalAudioUrl: 'https://audio.test/never-again.mp3' };
      case 'doctor_changed':
        call.outcome = 'doctor_changed';
        this.alerts.push({ personId: p.personId, kind: 'doctor_changed', doseIds: [...g.doseIds], at: this.now().toISOString() });
        return { action: 'hangup' };
      case 'decline':
      case 'unwell':
        // Not taken: keep the call open on the keypad; the call ending unconfirmed triggers a retry.
        return { action: 'play', step: this.step('reminder', false) };
      default:
        return this.unclear(call);
    }
  }

  /** Unclear: ask once more with speech, then keypad only ("1 dabaiye"). */
  private unclear(call: Call): NextAction {
    call.unclear += 1;
    return { action: 'play', step: this.step(call.purpose, call.unclear < 2) };
  }

  private block(phone: string, reason: string): void {
    this.blocked.add(phone);
    this.log(`number blocked ${maskPhone(phone)} reason=${reason}`);
    for (const p of this.people.values()) {
      if (p.phone !== phone) continue;
      p.consent = 'opted_out';
      for (const g of this.groups.values()) if (g.personId === p.personId && !g.done) this.finish(g, 'skipped_paused');
    }
  }

  private finish(g: Group, status: DoseStatus): void {
    g.done = true; g.nextCallAt = null;
    for (const id of g.doseIds) {
      const d = this.dose(id);
      if (d.status !== 'confirmed') d.status = status;
    }
  }

  private giveUp(g: Group): void {
    this.finish(g, 'missed');
    if (!g.alerted) {
      g.alerted = true;
      this.alerts.push({ personId: g.personId, kind: 'missed_dose', doseIds: [...g.doseIds], at: this.now().toISOString() });
    }
  }

  private person(id: string): Person {
    const p = this.people.get(id);
    if (!p) throw new Error(`Unknown person ${id}`);
    return p;
  }

  private dose(id: string): Dose { return this.doses.get(id)!; }
}

export const referenceEngineFactory: EngineFactory = (deps) => new ReferenceEngine(deps);
