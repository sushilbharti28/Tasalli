import type { CallEvent, CallLanguage, NextAction } from '@tasalli/contracts';
import { TestClock } from './clock';
import type { EngineFactory, EngineUnderTest, PersonFixture, ScheduleFixture, WebhookResponse } from './engine';
import { FakeSpeechProvider } from './fake-speech';
import { FakeTelephonyProvider, type CallStatus, type PlacedCall } from './fake-telephony';

/** Monday of launch week, 00:00 UTC (05:30 IST). */
export const DEFAULT_START = '2027-01-18T00:00:00.000Z';

let phoneSeq = 0;
/** Fictional Indian mobile numbers, unique per call. */
export function testPhone(): string {
  phoneSeq += 1;
  return `+9198${String(70000000 + phoneSeq).padStart(8, '0')}`;
}

/** One isolated test world: clock, fake providers and the engine under test. */
export class World {
  private idSeq = 0;

  private constructor(
    readonly engine: EngineUnderTest,
    readonly clock: TestClock,
    readonly telephony: FakeTelephonyProvider,
    readonly speech: FakeSpeechProvider,
  ) {}

  static async create(factory: EngineFactory, startIso = DEFAULT_START): Promise<World> {
    const clock = new TestClock(startIso);
    const telephony = new FakeTelephonyProvider(clock);
    const speech = new FakeSpeechProvider();
    const engine = await factory({ telephony, speech, clock, webhookBaseUrl: 'https://engine.test/webhooks/telephony/fake' });
    return new World(engine, clock, telephony, speech);
  }

  id(prefix: string): string {
    this.idSeq += 1;
    return `${prefix}-${this.idSeq}`;
  }

  async account(timeZone = 'Asia/Kolkata'): Promise<string> {
    const id = this.id('acct');
    await this.engine.addAccount(id, { timeZone });
    return id;
  }

  /** Add a person; defaults to a consented Hindi speaker in IST with a fresh number. */
  async person(over: Partial<PersonFixture> & { accountId?: string } = {}): Promise<PersonFixture> {
    const accountId = over.accountId ?? (await this.account());
    const p: PersonFixture = {
      accountId,
      personId: this.id('person'),
      phone: testPhone(),
      language: 'hi' as CallLanguage,
      timeZone: 'Asia/Kolkata',
      consent: 'consented',
      ...over,
    };
    const res = await this.engine.addPerson(p);
    if (!res.ok) throw new Error(`addPerson failed: ${res.reason}`);
    return p;
  }

  async schedule(person: PersonFixture, localTime: string, over: Partial<ScheduleFixture> = {}): Promise<ScheduleFixture> {
    const s: ScheduleFixture = {
      personId: person.personId,
      medicineId: this.id('med'),
      spokenName: 'BP wali',
      localTime,
      amountText: '1 goli',
      food: 'after',
      ...over,
    };
    await this.engine.addSchedule(s);
    return s;
  }

  /** Advance minute by minute until `iso`, ticking the scheduler each minute. */
  async runUntil(iso: string): Promise<void> {
    const target = Date.parse(iso);
    await this.engine.tick();
    while (this.clock.now().getTime() + 60_000 <= target) {
      this.clock.advanceMinutes(1);
      await this.engine.tick();
    }
    if (this.clock.now().getTime() < target) {
      this.clock.set(iso);
      await this.engine.tick();
    }
  }

  async runMinutes(minutes: number): Promise<void> {
    await this.runUntil(new Date(this.clock.now().getTime() + minutes * 60_000).toISOString());
  }

  callsTo(phone: string, purpose?: PlacedCall['purpose']): PlacedCall[] {
    return this.telephony.placed.filter((c) => c.to === phone && (!purpose || c.purpose === purpose));
  }

  lastCallTo(phone: string): PlacedCall {
    const calls = this.callsTo(phone);
    const last = calls[calls.length - 1];
    if (!last) throw new Error('No call placed to this number');
    return last;
  }

  async deliver(event: CallEvent): Promise<WebhookResponse> {
    const { headers, body } = this.telephony.signed(event);
    return this.engine.handleWebhook(headers, body);
  }

  async status(call: PlacedCall, status: CallStatus): Promise<WebhookResponse> {
    return this.deliver(this.telephony.statusEvent(call, status));
  }

  async answer(call: PlacedCall): Promise<void> {
    await this.status(call, 'ringing');
    await this.status(call, 'answered');
  }

  async press(call: PlacedCall, key: string): Promise<NextAction | undefined> {
    return (await this.deliver(this.telephony.keyEvent(call, key))).next;
  }

  async say(call: PlacedCall, transcript: string | undefined): Promise<NextAction | undefined> {
    return (await this.deliver(this.telephony.speechEvent(call, transcript))).next;
  }

  /** Answer, press a key, hang up. */
  async answerAndPress(call: PlacedCall, key: string): Promise<NextAction | undefined> {
    await this.answer(call);
    const next = await this.press(call, key);
    await this.status(call, 'completed');
    return next;
  }

  async doses(person: PersonFixture) {
    return this.engine.listDoses(person.personId);
  }

  async close(): Promise<void> {
    await this.engine.close?.();
  }
}
