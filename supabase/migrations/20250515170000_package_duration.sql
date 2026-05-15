-- Package duration (replaces tier in admin UI; tier column kept for legacy portal data).

alter table public.packages
  add column if not exists duration text;

comment on column public.packages.duration is
  'Coverage length, e.g. 3_day, friday_only. Shown in admin and portal instead of tier.';
