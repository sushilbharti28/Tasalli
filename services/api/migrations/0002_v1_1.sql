-- v1.1: grace period after a failed payment, and internal support notes.
-- Mirrors the v1.1 additions in packages/contracts/schema.sql.
alter table subscriptions add column past_due_since timestamptz;

create table support_notes (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id),
  author      text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index on support_notes (person_id, created_at);
