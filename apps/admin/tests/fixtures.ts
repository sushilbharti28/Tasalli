/**
 * Fixture families for the data-layer tests. All numbers are fake.
 * Tests run "as of" NOW so the metrics are deterministic.
 */
export const NOW = new Date('2026-11-15T12:00:00Z'); // 17:30 IST

export const ID = {
  u1: '11111111-1111-4111-8111-111111111111', // Asha Sharma: paying, setup done
  u2: '22222222-2222-4222-8222-222222222222', // Ravi Kumar (abroad): trial ended, never paid
  u3: '33333333-3333-4333-8333-333333333333', // deleted account
  u4: '44444444-4444-4444-8444-444444444444', // Neha Iyer: paid once, cancelled
  u5: '55555555-5555-4555-8555-555555555555', // Arjun: trial still running, no people
  p1: 'aaaaaaa1-0000-4000-8000-000000000001', // Papa (u1), consented
  p2: 'aaaaaaa1-0000-4000-8000-000000000002', // Mummy (u1), pending
  p3: 'aaaaaaa1-0000-4000-8000-000000000003', // Amma (u2), opted out, key 9
  p4: 'aaaaaaa1-0000-4000-8000-000000000004', // Nani (u4), consented
  m1: 'bbbbbbb1-0000-4000-8000-000000000001',
  m4: 'bbbbbbb1-0000-4000-8000-000000000004',
  s1: 'ccccccc1-0000-4000-8000-000000000001',
  s4: 'ccccccc1-0000-4000-8000-000000000004',
  c6: 'ddddddd1-0000-4000-8000-000000000006',
  c9: 'ddddddd1-0000-4000-8000-000000000009',
} as const;

export const PHONES = {
  u1: '+919810000001',
  u2: '+14155550123',
  p1: '+919876543210',
  p2: '+919876540000',
  p3: '+919800011111',
  p4: '+919811122222',
  adminBlocked: '+919899999999',
};

export const SEED_SQL = `
insert into users (id, phone_e164, name, time_zone, locale, created_at, deleted_at) values
  ('${ID.u1}', '${PHONES.u1}', 'Asha Sharma', 'Asia/Kolkata', 'hi', '2026-06-01T05:00:00Z', null),
  ('${ID.u2}', '${PHONES.u2}', 'Ravi Kumar', 'America/Los_Angeles', 'en', '2026-08-01T05:00:00Z', null),
  ('${ID.u3}', '+919800000003', 'Gone User', 'Asia/Kolkata', 'en', '2026-09-01T05:00:00Z', '2026-09-20T05:00:00Z'),
  ('${ID.u4}', '+919800000004', 'Neha Iyer', 'Asia/Kolkata', 'en', '2026-10-01T05:00:00Z', null),
  ('${ID.u5}', '+919800000005', 'Arjun', 'Asia/Kolkata', 'en', '2026-11-10T05:00:00Z', null);

insert into people (id, owner_user_id, nickname, full_name, phone_e164, language, consent, consent_at, created_at) values
  ('${ID.p1}', '${ID.u1}', 'Papa', 'Ramesh Sharma', '${PHONES.p1}', 'hi', 'consented', '2026-06-02T05:00:00Z', '2026-06-01T06:00:00Z'),
  ('${ID.p2}', '${ID.u1}', 'Mummy', null, '${PHONES.p2}', 'hi', 'pending', null, '2026-11-12T06:00:00Z'),
  ('${ID.p3}', '${ID.u2}', 'Amma', 'Lakshmi', '${PHONES.p3}', 'ta', 'opted_out', '2026-08-02T05:00:00Z', '2026-08-01T06:00:00Z'),
  ('${ID.p4}', '${ID.u4}', 'Nani', null, '${PHONES.p4}', 'en', 'consented', '2026-10-02T05:00:00Z', '2026-10-01T06:00:00Z');

insert into blocked_numbers (phone_e164, reason, blocked_at) values
  ('${PHONES.p3}', 'key_9', '2026-08-20T05:00:00Z'),
  ('${PHONES.adminBlocked}', 'admin', '2026-11-01T05:00:00Z');

insert into consent_events (person_id, result, via, call_id, created_at) values
  ('${ID.p1}', 'consented', 'key', '${ID.c6}', '2026-06-02T05:00:00Z'),
  ('${ID.p2}', 'no_answer', 'key', null, '2026-11-12T06:05:00Z'),
  ('${ID.p3}', 'consented', 'speech', '${ID.c9}', '2026-08-02T05:00:00Z'),
  ('${ID.p3}', 'opted_out', 'key', null, '2026-08-20T05:00:00Z');

insert into medicines (id, person_id, kind, strip_name, strength_text, spoken_name, created_by_user_id) values
  ('${ID.m1}', '${ID.p1}', 'tablet', 'Amlodac', '5 mg', 'BP wali', '${ID.u1}'),
  ('${ID.m4}', '${ID.p4}', 'tablet', 'Glycomet', '500 mg', 'sugar wali', '${ID.u4}');

insert into schedules (id, medicine_id, local_time, amount_text, food, start_date) values
  ('${ID.s1}', '${ID.m1}', '09:00', '1 tablet', 'after', '2026-06-03'),
  ('${ID.s4}', '${ID.m4}', '20:00', '1 tablet', 'after', '2026-10-03');

insert into doses (schedule_id, person_id, due_at, status, confirmed_at, confirmed_via) values
  ('${ID.s1}', '${ID.p1}', '2026-11-14T03:30:00Z', 'confirmed', '2026-11-14T03:31:00Z', 'key'),
  ('${ID.s1}', '${ID.p1}', '2026-11-14T14:30:00Z', 'confirmed', '2026-11-14T14:31:00Z', 'speech'),
  ('${ID.s1}', '${ID.p1}', '2026-11-13T03:30:00Z', 'missed', null, null),
  ('${ID.s1}', '${ID.p1}', '2026-11-13T14:30:00Z', 'confirmed', '2026-11-13T16:00:00Z', 'manual'),
  ('${ID.s1}', '${ID.p1}', '2026-11-16T03:30:00Z', 'upcoming', null, null),
  ('${ID.s1}', '${ID.p1}', '2026-09-01T03:30:00Z', 'confirmed', '2026-09-01T03:31:00Z', 'key'),
  ('${ID.s4}', '${ID.p4}', '2026-11-10T14:30:00Z', 'confirmed', '2026-11-10T14:31:00Z', 'key'),
  ('${ID.s4}', '${ID.p4}', '2026-11-11T14:30:00Z', 'skipped_paused', null, null);

insert into calls (id, person_id, purpose, attempt, provider, provider_call_id, status, result, input_kind, input_value,
                   recording_url, started_at, ended_at, created_at) values
  (default, '${ID.p1}', 'reminder', 1, 'fake', 'f-c1', 'completed', 'confirmed', 'key', '1',
   'https://rec.example/c1.mp3', '2026-11-14T03:30:05Z', '2026-11-14T03:31:10Z', '2026-11-14T03:30:00Z'),
  (default, '${ID.p1}', 'reminder', 1, 'fake', 'f-c2', 'completed', 'confirmed', 'speech', 'haan le li',
   'javascript:alert(1)', '2026-11-14T14:30:05Z', '2026-11-14T14:31:00Z', '2026-11-14T14:30:00Z'),
  (default, '${ID.p1}', 'reminder', 1, 'fake', 'f-c3', 'no_answer', 'none', null, null, null, null, null, '2026-11-13T03:30:00Z'),
  (default, '${ID.p1}', 'reminder', 2, 'fake', 'f-c4', 'failed', 'none', null, null, null, null, null, '2026-11-13T03:40:00Z'),
  (default, '${ID.p1}', 'reminder', 3, 'fake', 'f-c5', 'no_answer', 'none', null, null, null, null, null, '2026-11-13T03:50:00Z'),
  ('${ID.c6}', '${ID.p1}', 'consent', 1, 'fake', 'f-c6', 'completed', 'confirmed', 'key', '1',
   'https://rec.example/c6.mp3', '2026-06-02T05:00:00Z', '2026-06-02T05:01:00Z', '2026-06-02T05:00:00Z'),
  (default, '${ID.p4}', 'reminder', 1, 'fake', 'f-c7', 'completed', 'confirmed', 'key', '1', null,
   '2026-11-10T14:30:05Z', '2026-11-10T14:31:00Z', '2026-11-10T14:30:00Z'),
  (default, '${ID.p4}', 'reminder', 1, 'fake', 'f-c8', 'queued', null, null, null, null, null, null, '2026-11-15T11:00:00Z'),
  ('${ID.c9}', '${ID.p3}', 'consent', 1, 'fake', 'f-c9', 'completed', 'confirmed', 'speech', 'haan',
   'https://rec.example/c9.mp3', '2026-08-02T05:00:00Z', '2026-08-02T05:01:00Z', '2026-08-02T05:00:00Z');

insert into subscriptions (user_id, plan, status, trial_ends_at, current_period_end, created_at) values
  ('${ID.u1}', 'trial', 'cancelled', '2026-06-08T05:00:00Z', null, '2026-06-01T05:00:00Z'),
  ('${ID.u1}', 'one_parent', 'active', null, '2026-12-08T05:00:00Z', '2026-06-08T05:00:00Z'),
  ('${ID.u2}', 'trial', 'cancelled', '2026-08-08T05:00:00Z', null, '2026-08-01T05:00:00Z'),
  ('${ID.u4}', 'trial', 'cancelled', '2026-10-08T05:00:00Z', null, '2026-10-01T05:00:00Z'),
  ('${ID.u4}', 'two_parents', 'cancelled', null, '2026-11-08T05:00:00Z', '2026-10-08T05:00:00Z'),
  ('${ID.u5}', 'trial', 'trialing', '2026-11-17T05:00:00Z', null, '2026-11-10T05:00:00Z');
`;
