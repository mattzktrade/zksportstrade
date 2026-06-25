-- Optional per-package manual Wix price. When set, this overrides retail_price_multiplier for Wix sync.

alter table public.packages
  add column if not exists wix_retail_price numeric;

alter table public.packages
  drop constraint if exists packages_wix_retail_price_check;

alter table public.packages
  add constraint packages_wix_retail_price_check
  check (wix_retail_price is null or wix_retail_price >= 0);

comment on column public.packages.wix_retail_price is
  'Manual Wix unit price override. Null means use trade_price x retail_price_multiplier.';
