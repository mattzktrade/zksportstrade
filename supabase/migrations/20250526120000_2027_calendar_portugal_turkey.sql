-- 2027 calendar: Portugal replaces Barcelona/Spanish GP slot; Dutch GP removed; Turkish GP added.

delete from public.package_inventory
where package_id in (
  select id from public.packages
  where race_id in ('netherlands-2027', 'spain-2027')
     or id like 'netherlands-%-2027'
     or id like 'spain-%-2027'
);

delete from public.packages
where race_id in ('netherlands-2027', 'spain-2027')
   or id like 'netherlands-%-2027'
   or id like 'spain-%-2027';

delete from public.races where id in ('netherlands-2027', 'spain-2027');

insert into public.races (
  id, name, short_name, location, country, country_code, event_date, date_range, image, season
)
values
  (
    'portugal-2027',
    'Portuguese Grand Prix',
    'Portugal',
    'Portimão',
    'Portugal',
    'PT',
    '2027-06-14',
    'Dates TBC',
    '/images/circuits/portimao.jpg',
    2027
  ),
  (
    'turkey-2027',
    'Turkish Grand Prix',
    'Turkey',
    'Istanbul',
    'Türkiye',
    'TR',
    '2027-09-19',
    'Dates TBC',
    '/images/circuits/istanbul.jpg',
    2027
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
