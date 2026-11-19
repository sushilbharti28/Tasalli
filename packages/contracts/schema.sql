-- Tasalli version 1 database schema (DRAFT, needs founder approval)
-- Postgres 15+. All timestamps are timestamptz (UTC). Local dose times are stored
-- as wall-clock time plus the person's IANA time zone (safety rule 7).

create extension if not exists pgcrypto;

-- Account holders (the child, or a person using it for themselves)
create table users (
  id              uuid primary key default gen_random_uuid(),
  phone_e164      text not null unique,
  name            text,
  time_zone       text not null default 'Asia/Kolkata',
  locale          text not null default 'en',      -- app language: en | hi
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- People who receive calls (a parent, or the user themselves)
create type consent_state as enum ('pending', 'consented', 'declined', 'opted_out');
create type call_language as enum ('hi', 'en', 'bn', 'mr', 'ta', 'te');

create table people (
  id                 uuid primary key default gen_random_uuid(),
  owner_user_id      uuid not null references users(id),
  is_self            boolean not null default false,
  nickname           text not null,                 -- "Papa"
  full_name          text,
  phone_e164         text not null,
  language           call_language not null,
  time_zone          text not null default 'Asia/Kolkata',
  can_read_strip     text not null default 'not_sure' check (can_read_strip in ('yes','no','not_sure')),
  consent            consent_state not null default 'pending',
  consent_at         timestamptz,
  paused             boolean not null default false,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index on people (owner_user_id);
create index on people (phone_e164);
-- Safety rule 5: at most 4 people per account is enforced in the API layer.

-- Numbers that pressed 9 or asked to stop: blocked for every account
create table blocked_numbers (
  phone_e164   text primary key,
  reason       text not null,                -- 'key_9' | 'stop_phrase' | 'declined' | 'admin'
  blocked_at   timestamptz not null default now()
);

-- Consent records (kept as evidence)
create table consent_events (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references people(id),
  result       text not null check (result in ('consented','declined','no_answer','opted_out')),
  via          text not null check (via in ('key','speech','self_otp','admin')),
  call_id      uuid,
  created_at   timestamptz not null default now()
);

-- Medicines, entered by the family only (safety rules 1 and 2)
create type medicine_kind as enum ('tablet', 'capsule', 'syrup', 'other');

create table medicines (
  id                 uuid primary key default gen_random_uuid(),
  person_id          uuid not null references people(id),
  kind               medicine_kind not null,
  strip_name         text not null,                 -- "Amlodac"
  strength_text      text,                          -- "5 mg", as printed; never parsed
  spoken_name        text not null,                 -- "BP wali": what the call says
  -- appearance (tablet/capsule)
  colour_primary     text,
  colour_secondary   text,                          -- capsules only
  shape              text check (shape in ('round','oval','long','square')),
  size               text check (size in ('rai','dal','matar','badam','bigger')),
  marking            text check (marking in ('plain','line','letters','unknown')),
  -- packaging
  kept_in            text check (kept_in in ('strip','loose','bottle')),
  pack_colour        text,
  print_colour       text,
  cap_colour         text,                          -- syrup
  -- disambiguation chosen in the look-alike step
  number_label       int,                           -- "1 number wali"
  say_printed_name   boolean not null default false,
  -- free text the family typed, repeated verbatim
  extra_instruction  text,
  photo_url          text,
  active             boolean not null default true,
  created_by_user_id uuid not null references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on medicines (person_id);

-- When to take it
create table schedules (
  id             uuid primary key default gen_random_uuid(),
  medicine_id    uuid not null references medicines(id),
  local_time     time not null,                   -- in people.time_zone
  amount_text    text not null,                   -- "1 tablet", "1 chammach (5 ml)": verbatim
  food           text not null check (food in ('before','after','with','any')),
  days_of_week   int[] not null default '{1,2,3,4,5,6,7}',  -- ISO 1=Mon
  start_date     date not null,
  end_date       date,                            -- null = ongoing
  created_at     timestamptz not null default now()
);

-- One row per scheduled dose occurrence
create type dose_status as enum ('upcoming', 'calling', 'confirmed', 'missed', 'skipped_paused', 'cancelled');

create table doses (
  id               uuid primary key default gen_random_uuid(),
  schedule_id      uuid not null references schedules(id),
  person_id        uuid not null references people(id),
  due_at           timestamptz not null,
  status           dose_status not null default 'upcoming',
  confirmed_at     timestamptz,
  confirmed_via    text check (confirmed_via in ('key','speech','manual')),
  manual_by_user   uuid references users(id),
  call_group_id    uuid,                          -- doses grouped into one call
  unique (schedule_id, due_at)
);
create index on doses (person_id, due_at);

-- Every call attempt (consent, reminder, test)
create table calls (
  id                 uuid primary key default gen_random_uuid(),
  person_id          uuid references people(id),
  purpose            text not null check (purpose in ('consent','reminder','test')),
  call_group_id      uuid,
  attempt            int not null default 1,       -- 1, 2, 3
  provider           text not null,
  provider_call_id   text unique,
  status             text not null,                -- queued|ringing|answered|no_answer|busy|failed|completed
  result             text,                         -- confirmed|snoozed|repeat|doctor_changed|unwell|stop|none
  input_kind         text,                         -- key|speech
  input_value        text,                         -- '1' or recognised phrase
  recording_url      text,                         -- only with consent
  started_at         timestamptz,
  ended_at           timestamptz,
  created_at         timestamptz not null default now()
);
create index on calls (person_id, created_at);

-- Idempotency for provider webhooks (safety rule 6)
create table webhook_events (
  provider        text not null,
  event_id        text not null,
  received_at     timestamptz not null default now(),
  primary key (provider, event_id)
);

-- Push notification tokens for the child app
create table devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id),
  push_token    text not null unique,
  platform      text not null default 'android',
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index on devices (user_id);

-- Subscriptions
create table subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id),
  plan               text not null check (plan in ('trial','one_parent','two_parents','family_yearly')),
  status             text not null check (status in ('trialing','active','past_due','cancelled')),
  trial_ends_at      timestamptz,
  razorpay_sub_id    text unique,
  current_period_end timestamptz,
  past_due_since     timestamptz,                  -- set when a payment fails; 3-day grace period from here
  created_at         timestamptz not null default now()
);

-- Audit log for medicines, consents and manual actions
create table audit_log (
  id            bigserial primary key,
  actor_user_id uuid,
  actor_kind    text not null,                     -- user|system|admin
  entity        text not null,
  entity_id     uuid not null,
  action        text not null,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);

-- Internal support notes about a person (admin console)
create table support_notes (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id),
  author      text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index on support_notes (person_id, created_at);
