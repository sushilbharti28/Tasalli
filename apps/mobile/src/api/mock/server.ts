/**
 * In-app mock of the Tasalli API (packages/contracts/openapi.yaml), so the whole app runs with
 * no backend. It is plugged in as the `fetch` of the generated client, so every screen goes
 * through the same typed calls it will use against the real API.
 *
 * Demo behaviour:
 * - Any phone; any 6-digit OTP signs in, except "000000" (wrong code).
 * - A new parent is "calling" for consent, then consents after CONSENT_DELAY_MS.
 *   Numbers ending 0000 decline; numbers ending 9999 press 9 (opted_out).
 * - Doses are generated from medicine schedules in the parent's time zone.
 */
import type {
  CallAttempt,
  Dose,
  Medicine,
  MedicineCreate,
  Person,
  PersonCreate,
  Subscription,
  User,
} from '../types';
import { findLookAlikes } from '@/features/medicine/lookalike';
import { buildPreviewText } from '@/features/medicine/preview';
import { maskPhone } from '@/lib/phone';
import { addDays, dateInZone, isoWeekday, zonedTimeToUtc } from '@/lib/time';

export const CONSENT_DELAY_MS = 6000;
const MAX_PEOPLE = 4;

type MockPerson = Person & { id: string; phone: string; consentRequestedAt: number; createdAt: string };
type MockMedicine = Medicine & { id: string; personId: string; createdAt: string };
type DoseOverride = Pick<Dose, 'status' | 'confirmedAt' | 'confirmedVia'>;

interface Db {
  user: User | null;
  people: MockPerson[];
  medicines: MockMedicine[];
  overrides: Record<string, DoseOverride>;
  extraReminders: Record<string, number>;
  subscription: Subscription;
  devices: string[];
  testCallsToday: number;
  seq: number;
}

let db: Db = freshDb();
let now: () => number = () => Date.now();

function freshDb(): Db {
  return {
    user: null,
    people: [],
    medicines: [],
    overrides: {},
    extraReminders: {},
    subscription: { plan: 'trial', status: 'trialing', trialEndsAt: null, currentPeriodEnd: null },
    devices: [],
    testCallsToday: 0,
    seq: 1,
  };
}

/** Test hooks. */
export const mockControl = {
  reset() {
    db = freshDb();
    now = () => Date.now();
  },
  setNow(fn: () => number) {
    now = fn;
  },
  get db() {
    return db;
  },
};

function uuid(): string {
  const n = (db.seq++).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${n}`;
}

function seed(phone: string) {
  const t = now();
  db.user = { id: uuid(), phone, name: 'Rahul', timeZone: 'Asia/Kolkata', locale: 'en' };
  db.subscription = {
    plan: 'trial',
    status: 'trialing',
    trialEndsAt: new Date(t + 5 * 86400000).toISOString(),
    currentPeriodEnd: null,
  };
  const startDate = addDays(dateInZone(new Date(t), 'Asia/Kolkata'), -40);
  const papa: MockPerson = {
    id: uuid(),
    isSelf: false,
    nickname: 'Papa',
    fullName: 'Ramesh Sharma',
    phone: '+919876512861',
    phoneMasked: maskPhone('+919876512861'),
    language: 'hi',
    timeZone: 'Asia/Kolkata',
    canReadStrip: 'no',
    consent: 'consented',
    paused: false,
    consentRequestedAt: t - 40 * 86400000,
    createdAt: new Date(t - 40 * 86400000).toISOString(),
  };
  db.people.push(papa);
  const meds: MedicineCreate[] = [
    {
      kind: 'tablet',
      stripName: 'Amlodac',
      strengthText: '5 mg',
      spokenName: 'BP wali goli',
      appearance: { colourPrimary: 'white', shape: 'round', size: 'small', marking: 'line', keptIn: 'strip', packColour: 'silver' },
      numberLabel: null,
      sayPrintedName: false,
      schedules: [{ localTime: '08:00', amountText: '1 goli', food: 'after', startDate }],
    },
    {
      kind: 'tablet',
      stripName: 'Glycomet',
      strengthText: '500 mg',
      spokenName: 'sugar wali goli',
      appearance: { colourPrimary: 'white', shape: 'round', size: 'small', marking: 'plain', keptIn: 'strip', packColour: 'red' },
      numberLabel: null,
      sayPrintedName: false,
      schedules: [
        { localTime: '08:30', amountText: '1 goli', food: 'after', startDate },
        { localTime: '20:30', amountText: '1 goli', food: 'after', startDate },
      ],
    },
  ];
  for (const m of meds) {
    db.medicines.push({ ...m, id: uuid(), personId: papa.id, active: true, createdAt: papa.createdAt });
  }
}

// ---------- consent simulation ----------
function refreshConsent(p: MockPerson) {
  if (p.consent !== 'pending' || p.isSelf) return;
  if (now() - p.consentRequestedAt < CONSENT_DELAY_MS) return;
  if (p.phone.endsWith('0000')) p.consent = 'declined';
  else if (p.phone.endsWith('9999')) p.consent = 'opted_out';
  else p.consent = 'consented';
}

function publicPerson(p: MockPerson): Person {
  refreshConsent(p);
  const { phone: _phone, consentRequestedAt: _c, createdAt: _d, ...rest } = p;
  return rest;
}

function publicMedicine(m: MockMedicine): Medicine {
  const { personId: _p, createdAt: _c, ...rest } = m;
  return rest;
}

// ---------- doses ----------
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

export function dosesFor(personId: string, from: string, to: string): Dose[] {
  const p = db.people.find((x) => x.id === personId);
  if (!p) return [];
  refreshConsent(p);
  // Safety rule 3: nothing is scheduled before consent.
  if (p.consent !== 'consented') return [];
  const tz = p.timeZone ?? 'Asia/Kolkata';
  const out: Dose[] = [];
  const t = now();
  const consentDate = dateInZone(new Date(p.consentRequestedAt), tz);
  for (let date = from; date <= to; date = addDays(date, 1)) {
    for (const m of db.medicines.filter((x) => x.personId === personId && x.active !== false)) {
      m.schedules.forEach((s) => {
        const start = s.startDate ?? m.createdAt.slice(0, 10);
        if (date < start || date < consentDate) return;
        if (s.endDate && date > s.endDate) return;
        if (s.daysOfWeek?.length && !s.daysOfWeek.includes(isoWeekday(date))) return;
        const due = zonedTimeToUtc(date, s.localTime, tz);
        const id = `${m.id}.${date}.${s.localTime.replace(':', '')}`;
        const base: Dose = { id, medicineId: m.id, spokenName: m.spokenName, dueAt: due.toISOString(), status: 'upcoming', confirmedAt: null, confirmedVia: null };
        const diffMin = (t - due.getTime()) / 60000;
        if (p.paused && diffMin < 0) base.status = 'skipped_paused';
        else if (diffMin < 0) base.status = 'upcoming';
        else if (diffMin < 25) base.status = 'calling';
        else if (hash(id) % 9 === 0) base.status = 'missed';
        else {
          base.status = 'confirmed';
          base.confirmedAt = new Date(due.getTime() + (2 + (hash(id) % 6)) * 60000).toISOString();
          base.confirmedVia = hash(id) % 3 === 0 ? 'key' : 'speech';
        }
        out.push({ ...base, ...(db.overrides[id] ?? {}) });
      });
    }
  }
  return out.sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
}

function findDose(doseId: string): Dose | undefined {
  const [medId, date] = doseId.split('.');
  const m = db.medicines.find((x) => x.id === medId);
  if (!m || !date) return undefined;
  return dosesFor(m.personId, date, date).find((d) => d.id === doseId);
}

function callsFor(dose: Dose): CallAttempt[] {
  const due = new Date(dose.dueAt ?? 0).getTime();
  const at = (min: number) => new Date(due + min * 60000).toISOString();
  const attempt = (n: number, result: string, input?: [string, string]): CallAttempt => ({
    id: `${dose.id}.a${n}`,
    attempt: n,
    status: 'completed',
    result,
    inputKind: input?.[0] ?? null,
    inputValue: input?.[1] ?? null,
    startedAt: at((n - 1) * 10),
    recordingUrl: null,
  });
  switch (dose.status) {
    case 'confirmed':
      return dose.confirmedVia === 'manual'
        ? [attempt(1, 'no_answer'), attempt(2, 'no_answer'), attempt(3, 'busy')]
        : [attempt(1, 'confirmed', dose.confirmedVia === 'key' ? ['dtmf', '1'] : ['speech', 'le li'])];
    case 'missed': {
      const list = [attempt(1, 'no_answer'), attempt(2, 'rejected', ['speech', 'nahi li']), attempt(3, 'no_answer')];
      const extra = db.extraReminders[dose.id ?? ''] ?? 0;
      for (let i = 0; i < extra; i++) list.push({ ...attempt(4 + i, 'no_answer'), status: 'queued', result: null, startedAt: new Date(now()).toISOString() });
      return list;
    }
    case 'calling':
      return [{ ...attempt(1, 'no_answer'), status: 'ringing', result: null }];
    default:
      return [];
  }
}

// ---------- HTTP plumbing ----------
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const empty = (status: number) => new Response(null, { status });

type Handler = (ctx: { params: string[]; body: any; query: URLSearchParams }) => Response | Promise<Response>;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, pattern: string, h: Handler) =>
  routes.push([method, new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`), h]);

function personOr404(id: string) {
  return db.people.find((p) => p.id === id);
}

route('POST', '/auth/otp/request', ({ body }) => (/^\+\d{8,15}$/.test(body?.phone ?? '') ? empty(204) : json(400, { message: 'bad phone' })));
route('POST', '/auth/otp/verify', ({ body }) => {
  if (!/^\d{6}$/.test(body?.code ?? '') || body.code === '000000') return json(401, { message: 'wrong code' });
  if (!db.user) seed(body.phone);
  return json(200, { token: `mock-token-${db.user!.id}`, user: db.user });
});
route('GET', '/me', () => json(200, db.user));
route('PATCH', '/me', ({ body }) => {
  db.user = { ...db.user!, ...body };
  return json(200, db.user);
});
route('GET', '/people', () => json(200, db.people.map(publicPerson)));
route('POST', '/people', ({ body }) => {
  const b = body as PersonCreate;
  if (db.people.length >= MAX_PEOPLE) return json(409, { message: 'limit' });
  const phone = b.isSelf ? db.user!.phone! : b.phone ?? '';
  if (!b.isSelf && !/^\+\d{8,15}$/.test(phone)) return json(400, { message: 'bad phone' });
  const p: MockPerson = {
    id: uuid(),
    isSelf: b.isSelf,
    nickname: b.nickname,
    fullName: b.fullName,
    phone,
    phoneMasked: maskPhone(phone),
    language: b.language,
    timeZone: b.timeZone ?? 'Asia/Kolkata',
    canReadStrip: b.canReadStrip ?? 'not_sure',
    // Yourself: OTP-verified number, no consent call needed (scope item 2).
    consent: b.isSelf ? 'consented' : 'pending',
    paused: false,
    consentRequestedAt: now(),
    createdAt: new Date(now()).toISOString(),
  };
  db.people.push(p);
  return json(201, publicPerson(p));
});
route('GET', '/people/:id', ({ params }) => {
  const p = personOr404(params[0]);
  return p ? json(200, publicPerson(p)) : empty(404);
});
route('PATCH', '/people/:id', ({ params, body }) => {
  const p = personOr404(params[0]);
  if (!p) return empty(404);
  Object.assign(p, body);
  return json(200, publicPerson(p));
});
route('DELETE', '/people/:id', ({ params }) => {
  db.people = db.people.filter((p) => p.id !== params[0]);
  db.medicines = db.medicines.filter((m) => m.personId !== params[0]);
  return empty(204);
});
route('POST', '/people/:id/consent-call', ({ params }) => {
  const p = personOr404(params[0]);
  if (!p) return empty(404);
  refreshConsent(p);
  if (p.consent === 'consented' || p.consent === 'opted_out') return json(409, { message: p.consent });
  p.consent = 'pending';
  p.consentRequestedAt = now();
  return empty(202);
});
route('GET', '/people/:id/medicines', ({ params }) =>
  json(200, db.medicines.filter((m) => m.personId === params[0] && m.active !== false).map(publicMedicine)),
);
route('POST', '/people/:id/medicines', ({ params, body }) => {
  const p = personOr404(params[0]);
  if (!p) return empty(404);
  const b = body as MedicineCreate;
  if (!b.stripName || !b.spokenName || !b.schedules?.length) return json(400, { message: 'missing fields' });
  const others = db.medicines.filter((m) => m.personId === p.id && m.active !== false);
  const m: MockMedicine = { ...b, id: uuid(), personId: p.id, active: true, createdAt: new Date(now()).toISOString() };
  db.medicines.push(m);
  return json(201, { medicine: publicMedicine(m), lookAlike: findLookAlikes(m, others, p.canReadStrip) });
});
route('PATCH', '/medicines/:id', ({ params, body }) => {
  const m = db.medicines.find((x) => x.id === params[0]);
  if (!m) return empty(404);
  Object.assign(m, body);
  const p = personOr404(m.personId)!;
  const others = db.medicines.filter((x) => x.personId === m.personId && x.active !== false && x.id !== m.id);
  return json(200, { medicine: publicMedicine(m), lookAlike: findLookAlikes(m, others, p.canReadStrip) });
});
route('DELETE', '/medicines/:id', ({ params }) => {
  const m = db.medicines.find((x) => x.id === params[0]);
  if (m) m.active = false;
  return empty(204);
});
route('GET', '/medicines/:id/preview', ({ params }) => {
  const m = db.medicines.find((x) => x.id === params[0]);
  if (!m) return empty(404);
  const p = personOr404(m.personId)!;
  const text = buildPreviewText({ medicine: m, personName: p.nickname ?? '', childName: db.user?.name ?? '', language: p.language ?? 'hi' });
  return json(200, { text, audioUrl: '' });
});
route('GET', '/medicine-names', ({ query }) => {
  const q = (query.get('q') ?? '').toLowerCase();
  const kind = query.get('kind');
  return json(200, MEDICINE_NAMES.filter((n) => (!kind || n.kind === kind) && n.name.toLowerCase().startsWith(q)).slice(0, 8));
});
route('GET', '/people/:id/doses', ({ params, query }) => json(200, dosesFor(params[0], query.get('from')!, query.get('to')!)));
route('POST', '/doses/:id/mark-taken', ({ params }) => {
  const id = decodeURIComponent(params[0]);
  const d = findDose(id);
  if (!d) return empty(404);
  if (d.status !== 'confirmed') db.overrides[id] = { status: 'confirmed', confirmedAt: new Date(now()).toISOString(), confirmedVia: 'manual' };
  return json(200, {});
});
route('GET', '/doses/:id/calls', ({ params }) => {
  const d = findDose(decodeURIComponent(params[0]));
  return d ? json(200, callsFor(d)) : empty(404);
});
// PENDING CONTRACT: not in openapi.yaml yet (see src/api/pending.ts).
route('POST', '/doses/:id/remind', ({ params }) => {
  const id = decodeURIComponent(params[0]);
  db.extraReminders[id] = (db.extraReminders[id] ?? 0) + 1;
  return empty(202);
});
route('POST', '/test-call', () => (db.testCallsToday++ >= 3 ? empty(429) : empty(202)));
route('GET', '/subscription', () => json(200, db.subscription));
route('POST', '/subscription', ({ body }) => {
  // Fake billing only: no payment provider is called (founder rule: nothing that costs money).
  db.subscription = { plan: body.plan, status: 'active', trialEndsAt: null, currentPeriodEnd: new Date(now() + 30 * 86400000).toISOString() };
  return json(200, { fake: true });
});
route('POST', '/devices', ({ body }) => {
  if (body?.token && !db.devices.includes(body.token)) db.devices.push(body.token);
  return empty(204);
});

const MEDICINE_NAMES: { name: string; kind: 'tablet' | 'capsule' | 'syrup' | 'other' }[] = [
  { name: 'Amlodac', kind: 'tablet' },
  { name: 'Amlong', kind: 'tablet' },
  { name: 'Atorva', kind: 'tablet' },
  { name: 'Ecosprin', kind: 'tablet' },
  { name: 'Glycomet', kind: 'tablet' },
  { name: 'Telma', kind: 'tablet' },
  { name: 'Thyronorm', kind: 'tablet' },
  { name: 'Pan 40', kind: 'tablet' },
  { name: 'Shelcal', kind: 'tablet' },
  { name: 'Omez', kind: 'capsule' },
  { name: 'Becosules', kind: 'capsule' },
  { name: 'Evion', kind: 'capsule' },
  { name: 'Ascoril', kind: 'syrup' },
  { name: 'Benadryl', kind: 'syrup' },
  { name: 'Cremaffin', kind: 'syrup' },
  { name: 'Digene', kind: 'syrup' },
  { name: 'Electral', kind: 'other' },
];

let delayMs = Number(process.env.EXPO_PUBLIC_MOCK_DELAY_MS ?? 300);
export function setMockDelay(ms: number) {
  delayMs = ms;
}

export async function mockFetch(input: Request): Promise<Response> {
  const url = new URL(input.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = input.method.toUpperCase();
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  const isPublic = path.startsWith('/auth/');
  if (!isPublic && !(input.headers.get('Authorization') ?? '').startsWith('Bearer ')) return empty(401);
  if (!isPublic && !db.user) return empty(401);
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = re.exec(path);
    if (!match) continue;
    let body: unknown;
    if (method !== 'GET' && method !== 'DELETE') {
      const text = await input.text();
      body = text ? JSON.parse(text) : undefined;
    }
    return h({ params: match.slice(1), body, query: url.searchParams });
  }
  return empty(404);
}
