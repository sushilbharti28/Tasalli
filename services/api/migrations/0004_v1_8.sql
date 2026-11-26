-- v1.8: a schedule remembers the meal the family picked, so the call names it instead of guessing from the hour.
-- Mirrors packages/contracts/schema.sql. Existing rows stay null (custom time: the meal is read from the hour, as before).
alter table schedules add column if not exists meal text check (meal in ('breakfast','lunch','dinner','bedtime'));
