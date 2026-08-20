-- Event categories support expansion beyond Formula 1.
-- Existing events are Formula 1 and are backfilled by the default.

alter table public.races
  add column if not exists category text not null default 'formula_1';

alter table public.races
  drop constraint if exists races_category_check;

alter table public.races
  add constraint races_category_check
  check (category in ('formula_1', 'tennis', 'football', 'concert', 'other'));

create index if not exists races_category_event_date_idx
  on public.races (category, event_date);

comment on column public.races.category is
  'Top-level event category used for CMS and storefront filtering.';

