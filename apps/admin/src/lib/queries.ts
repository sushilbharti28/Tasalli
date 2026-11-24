import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { getReadPool } from './db';
import { digitsOnly, maskPhone } from './mask';

/**
 * Read-only data layer for the admin console.
 *
 * Every function here runs on the read pool (default_transaction_read_only=on) and
 * returns phone numbers masked to the last 4 digits (safety rule 8). Full numbers
 * never leave this module; where the UI needs to act on a number it gets a
 * `phoneRef` (sha256 of the E.164 number) instead.
 *
 * These queries stand in for the admin API drafted in apps/admin/admin-api.yaml.
 * When the backend implements that API, swap the bodies for HTTP calls and keep
 * the return types.
 */

export type ConsentState = 'pending' | 'consented' | 'declined' | 'opted_out';

export interface FamilySummary {
  userId: string;
  name: string | null;
  phoneMasked: string;
  createdAt: Date;
  deleted: boolean;
  peopleCount: number;
  plan: string | null;
  subscriptionStatus: string | null;
}

export interface PersonSummary {
  id: string;
  nickname: string;
  fullName: string | null;
  isSelf: boolean;
  phoneMasked: string;
  language: string;
  timeZone: string;
  consent: ConsentState;
  consentAt: Date | null;
  paused: boolean;
  blocked: boolean;
  deleted: boolean;
}

export interface SubscriptionRow {
  id: string;
  plan: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
}

export interface SupportNote {
  id: string;
  text: string;
  personId: string | null;
  by: string | null;
  createdAt: Date;
}

export interface FamilyDetail {
  userId: string;
  name: string | null;
  phoneMasked: string;
  timeZone: string;
  locale: string;
  createdAt: Date;
  deleted: boolean;
  people: PersonSummary[];
  subscriptions: SubscriptionRow[];
  notes: SupportNote[];
}

export interface ConsentEventRow {
  id: string;
  result: string;
  via: string;
  callId: string | null;
  createdAt: Date;
}

export interface CallRow {
  id: string;
  purpose: string;
  attempt: number;
  provider: string;
  status: string;
  result: string | null;
  inputKind: string | null;
  inputValue: string | null;
  /** Only set when the person is consented, not deleted, and the URL is http(s). */
  recordingUrl: string | null;
  hasRecording: boolean;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}

export interface DoseStats {
  confirmedByParent: number;
  confirmedManual: number;
  missed: number;
  skippedPaused: number;
  upcoming: number;
}

export interface PersonDetail extends PersonSummary {
  owner: { userId: string; name: string | null; phoneMasked: string };
  canReadStrip: string;
  createdAt: Date;
  blockReason: string | null;
  blockedAt: Date | null;
  activeMedicines: number;
  doseStats14d: DoseStats;
  consentEvents: ConsentEventRow[];
  calls: CallRow[];
}

export interface BlockedRow {
  phoneRef: string;
  phoneMasked: string;
  reason: string;
  blockedAt: Date;
  peopleCount: number;
  accountCount: number;
  /** Only admin blocks may be lifted from the console; key 9 / stop phrase / declined are the parent's choice. */
  canUnblock: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function phoneRef(phoneE164: string): string {
  return createHash('sha256').update(phoneE164).digest('hex');
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function pool(p?: Pool): Pool {
  return p ?? getReadPool();
}

// ---------------------------------------------------------------------------
// Family search

/**
 * Search families (account holders) by:
 *  - a user or person id (exact uuid),
 *  - 4+ digits of any phone number on the account (account holder or a person),
 *  - text in the account name, a person's nickname or full name.
 * Empty query lists the newest families.
 */
export async function searchFamilies(query: string, opts: { limit?: number; db?: Pool } = {}): Promise<FamilySummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const q = query.trim();
  const digits = digitsOnly(q);
  let where = 'true';
  const params: unknown[] = [];

  if (q === '') {
    // newest first, no filter
  } else if (UUID_RE.test(q)) {
    params.push(q.toLowerCase());
    where = `(u.id = $1::uuid or exists (select 1 from people p where p.owner_user_id = u.id and p.id = $1::uuid))`;
  } else if (digits.length >= 4 && /^[\d\s+()-]+$/.test(q)) {
    params.push(`%${digits}%`);
    where = `(regexp_replace(u.phone_e164, '\\D', '', 'g') like $1
              or exists (select 1 from people p where p.owner_user_id = u.id
                         and regexp_replace(p.phone_e164, '\\D', '', 'g') like $1))`;
  } else if (q.length >= 2) {
    params.push(`%${escapeLike(q)}%`);
    where = `(u.name ilike $1
              or exists (select 1 from people p where p.owner_user_id = u.id
                         and (p.nickname ilike $1 or p.full_name ilike $1)))`;
  } else {
    return [];
  }

  params.push(limit);
  const { rows } = await pool(opts.db).query(
    `select u.id, u.name, u.phone_e164, u.created_at, u.deleted_at,
            (select count(*)::int from people p where p.owner_user_id = u.id and p.deleted_at is null) as people_count,
            s.plan, s.status
       from users u
       left join lateral (
         select plan, status from subscriptions where user_id = u.id order by created_at desc limit 1
       ) s on true
      where ${where}
      order by u.created_at desc
      limit $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    userId: r.id,
    name: r.name,
    phoneMasked: maskPhone(r.phone_e164),
    createdAt: r.created_at,
    deleted: r.deleted_at !== null,
    peopleCount: r.people_count,
    plan: r.plan ?? null,
    subscriptionStatus: r.status ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Family detail

/** The person columns read by toPersonSummary (PERSON_COLUMNS). */
interface PersonDbRow {
  id: string;
  nickname: string;
  full_name: string | null;
  is_self: boolean;
  phone_e164: string;
  language: string;
  time_zone: string;
  consent: ConsentState;
  consent_at: Date | null;
  paused: boolean;
  blocked: boolean;
  deleted_at: Date | null;
}

function toPersonSummary(r: PersonDbRow): PersonSummary {
  return {
    id: r.id,
    nickname: r.nickname,
    fullName: r.full_name,
    isSelf: r.is_self,
    phoneMasked: maskPhone(r.phone_e164),
    language: r.language,
    timeZone: r.time_zone,
    consent: r.consent,
    consentAt: r.consent_at,
    paused: r.paused,
    blocked: r.blocked,
    deleted: r.deleted_at !== null,
  };
}

const PERSON_COLUMNS = `p.id, p.nickname, p.full_name, p.is_self, p.phone_e164, p.language, p.time_zone,
  p.consent, p.consent_at, p.paused, p.deleted_at, p.can_read_strip, p.created_at, p.owner_user_id,
  b.reason as block_reason, b.blocked_at, (b.phone_e164 is not null) as blocked`;

export async function listSupportNotes(userId: string, db?: Pool): Promise<SupportNote[]> {
  const { rows } = await pool(db).query(
    `select id, after, created_at from audit_log
      where entity = 'support_note' and action = 'note_added' and entity_id = $1
      order by created_at desc, id desc`,
    [userId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    text: String(r.after?.text ?? ''),
    personId: r.after?.personId ?? null,
    by: r.after?.by ?? null,
    createdAt: r.created_at,
  }));
}

export async function getFamily(userId: string, db?: Pool): Promise<FamilyDetail | null> {
  if (!UUID_RE.test(userId)) return null;
  const p = pool(db);
  const { rows: users } = await p.query(
    `select id, name, phone_e164, time_zone, locale, created_at, deleted_at from users where id = $1`,
    [userId],
  );
  const u = users[0];
  if (!u) return null;

  const [people, subs, notes] = await Promise.all([
    p.query(
      `select ${PERSON_COLUMNS}
         from people p left join blocked_numbers b on b.phone_e164 = p.phone_e164
        where p.owner_user_id = $1
        order by p.deleted_at nulls first, p.created_at`,
      [userId],
    ),
    p.query(
      `select id, plan, status, trial_ends_at, current_period_end, created_at
         from subscriptions where user_id = $1 order by created_at desc`,
      [userId],
    ),
    listSupportNotes(userId, p),
  ]);

  return {
    userId: u.id,
    name: u.name,
    phoneMasked: maskPhone(u.phone_e164),
    timeZone: u.time_zone,
    locale: u.locale,
    createdAt: u.created_at,
    deleted: u.deleted_at !== null,
    people: people.rows.map(toPersonSummary),
    subscriptions: subs.rows.map((s) => ({
      id: s.id,
      plan: s.plan,
      status: s.status,
      trialEndsAt: s.trial_ends_at,
      currentPeriodEnd: s.current_period_end,
      createdAt: s.created_at,
    })),
    notes,
  };
}

// ---------------------------------------------------------------------------
// Person detail: consent events and call logs

export function safeRecordingUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function getPerson(
  personId: string,
  opts: { callLimit?: number; now?: Date; db?: Pool } = {},
): Promise<PersonDetail | null> {
  if (!UUID_RE.test(personId)) return null;
  const p = pool(opts.db);
  const now = opts.now ?? new Date();
  const { rows } = await p.query(
    `select ${PERSON_COLUMNS}, u.name as owner_name, u.phone_e164 as owner_phone
       from people p
       join users u on u.id = p.owner_user_id
       left join blocked_numbers b on b.phone_e164 = p.phone_e164
      where p.id = $1`,
    [personId],
  );
  const r = rows[0];
  if (!r) return null;

  const [consent, calls, meds, doses] = await Promise.all([
    p.query(
      `select id, result, via, call_id, created_at from consent_events
        where person_id = $1 order by created_at desc, id`,
      [personId],
    ),
    p.query(
      `select id, purpose, attempt, provider, status, result, input_kind, input_value, recording_url,
              started_at, ended_at, created_at
         from calls where person_id = $1
        order by created_at desc, id
        limit $2`,
      [personId, Math.min(Math.max(opts.callLimit ?? 200, 1), 1000)],
    ),
    p.query(`select count(*)::int as n from medicines where person_id = $1 and active`, [personId]),
    p.query(
      `select
         count(*) filter (where status = 'confirmed' and confirmed_via in ('key','speech'))::int as by_parent,
         count(*) filter (where status = 'confirmed' and confirmed_via = 'manual')::int as manual,
         count(*) filter (where status = 'missed')::int as missed,
         count(*) filter (where status = 'skipped_paused')::int as skipped,
         count(*) filter (where status in ('upcoming','calling'))::int as upcoming
       from doses
      where person_id = $1 and due_at >= $2::timestamptz - interval '14 days' and due_at < $2::timestamptz + interval '1 day'`,
      [personId, now],
    ),
  ]);

  // Recordings are played only for a consented, not-deleted person (safety rules 3 and 9).
  const mayPlay = r.consent === 'consented' && r.deleted_at === null;
  const d = doses.rows[0];

  return {
    ...toPersonSummary(r),
    owner: { userId: r.owner_user_id, name: r.owner_name, phoneMasked: maskPhone(r.owner_phone) },
    canReadStrip: r.can_read_strip,
    createdAt: r.created_at,
    blockReason: r.block_reason,
    blockedAt: r.blocked_at,
    activeMedicines: meds.rows[0].n,
    doseStats14d: {
      confirmedByParent: d.by_parent,
      confirmedManual: d.manual,
      missed: d.missed,
      skippedPaused: d.skipped,
      upcoming: d.upcoming,
    },
    consentEvents: consent.rows.map((c) => ({
      id: c.id,
      result: c.result,
      via: c.via,
      callId: c.call_id,
      createdAt: c.created_at,
    })),
    calls: calls.rows.map((c) => ({
      id: c.id,
      purpose: c.purpose,
      attempt: c.attempt,
      provider: c.provider,
      status: c.status,
      result: c.result,
      inputKind: c.input_kind,
      inputValue: c.input_value,
      recordingUrl: mayPlay ? safeRecordingUrl(c.recording_url) : null,
      hasRecording: Boolean(c.recording_url),
      startedAt: c.started_at,
      endedAt: c.ended_at,
      createdAt: c.created_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Block list

export async function listBlocked(opts: { last4?: string; db?: Pool } = {}): Promise<BlockedRow[]> {
  const last4 = digitsOnly(opts.last4 ?? '');
  const params: unknown[] = [];
  let where = 'true';
  if (last4.length > 0) {
    params.push(`%${last4}`);
    where = `regexp_replace(b.phone_e164, '\\D', '', 'g') like $1`;
  }
  const { rows } = await pool(opts.db).query(
    `select b.phone_e164, b.reason, b.blocked_at,
            count(p.id)::int as people_count,
            count(distinct p.owner_user_id)::int as account_count
       from blocked_numbers b
       left join people p on p.phone_e164 = b.phone_e164 and p.deleted_at is null
      where ${where}
      group by b.phone_e164, b.reason, b.blocked_at
      order by b.blocked_at desc
      limit 500`,
    params,
  );
  return rows.map((r) => ({
    phoneRef: phoneRef(r.phone_e164),
    phoneMasked: maskPhone(r.phone_e164),
    reason: r.reason,
    blockedAt: r.blocked_at,
    peopleCount: r.people_count,
    accountCount: r.account_count,
    canUnblock: r.reason === 'admin',
  }));
}
