-- Bahrain Grand Prix in Malaysia 2026 (Sepang International Circuit, 2–4 Oct).
-- Distinct from bahrain-2026 (Sakhir, April).

insert into public.races (
  id, name, short_name, location, country, country_code, event_date, date_range, image, season
)
values (
  'bahrain-malaysia-2026',
  'Bahrain Grand Prix in Malaysia',
  'Malaysia',
  'Sepang International Circuit',
  'Malaysia',
  'MY',
  '2026-10-04',
  '02 - 04 Oct',
  '/images/circuits/sepang.jpg',
  2026
)
on conflict (id) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  location = excluded.location,
  country = excluded.country,
  country_code = excluded.country_code,
  event_date = excluded.event_date,
  date_range = excluded.date_range,
  image = excluded.image,
  season = excluded.season;
