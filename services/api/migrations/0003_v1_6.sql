-- v1.6: three medicine sizes (very_small, small, large) instead of five.
-- Mirrors packages/contracts/schema.sql. Existing rows are mapped: rai -> very_small; dal, matar -> small; badam, bigger -> large.
-- people.full_name stays nullable in the database (a deleted person's name is cleared); the API requires it for new people.
alter table medicines drop constraint if exists medicines_size_check;
update medicines set size = case size
    when 'rai' then 'very_small'
    when 'dal' then 'small'
    when 'matar' then 'small'
    when 'badam' then 'large'
    when 'bigger' then 'large'
    else size end
  where size is not null;
alter table medicines add constraint medicines_size_check check (size in ('very_small','small','large'));
