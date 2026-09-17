-- Store the track/venue name on the event (races.circuit) instead of copying the
-- Grand Prix title onto every package. Event edits fan out to linked products.

alter table public.races
  add column if not exists circuit text not null default '';

comment on column public.races.circuit is
  'Track or venue name (e.g. Albert Park Circuit). Copied onto linked packages when the event is updated.';

create or replace function public.official_f1_circuit_name(p_race_id text)
returns text
language sql
immutable
as $$
  -- Race id stems (not Grand Prix titles):
  --   spain-*  = Barcelona Grand Prix
  --   madrid-* = Spanish Grand Prix
  select case regexp_replace(coalesce(p_race_id, ''), '-\d{4}$', '')
    when 'australia' then 'Albert Park Circuit'
    when 'china' then 'Shanghai International Circuit'
    when 'japan' then 'Suzuka International Racing Course'
    when 'bahrain' then 'Bahrain International Circuit'
    when 'saudi' then 'Jeddah Corniche Circuit'
    when 'miami' then 'Miami International Autodrome'
    when 'canada' then 'Circuit Gilles Villeneuve'
    when 'monaco' then 'Circuit de Monaco'
    when 'spain' then 'Circuit de Barcelona-Catalunya'
    when 'austria' then 'Red Bull Ring'
    when 'britain' then 'Silverstone Circuit'
    when 'belgium' then 'Circuit de Spa-Francorchamps'
    when 'hungary' then 'Hungaroring'
    when 'netherlands' then 'Circuit Zandvoort'
    when 'italy' then 'Autodromo Nazionale Monza'
    when 'madrid' then 'MADRING'
    when 'azerbaijan' then 'Baku City Circuit'
    when 'bahrain-malaysia' then 'Sepang International Circuit'
    when 'singapore' then 'Marina Bay Street Circuit'
    when 'usa' then 'Circuit of the Americas'
    when 'mexico' then 'Autódromo Hermanos Rodríguez'
    when 'brazil' then 'Autódromo José Carlos Pace'
    when 'vegas' then 'Las Vegas Strip Circuit'
    when 'qatar' then 'Lusail International Circuit'
    when 'abudhabi' then 'Yas Marina Circuit'
    when 'portugal' then 'Algarve International Circuit'
    when 'turkey' then 'Istanbul Park'
    else null
  end;
$$;

create or replace function public.sync_packages_from_race_event_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.packages
  set
    circuit = new.circuit,
    location = new.location,
    country = new.country,
    country_code = new.country_code,
    event_date = new.event_date,
    date_range = new.date_range
  where race_id = new.id
    and (
      circuit is distinct from new.circuit
      or location is distinct from new.location
      or country is distinct from new.country
      or country_code is distinct from new.country_code
      or event_date is distinct from new.event_date
      or date_range is distinct from new.date_range
    );
  return new;
end;
$$;

drop trigger if exists races_sync_packages_event_fields_trg on public.races;
create trigger races_sync_packages_event_fields_trg
after update of circuit, location, country, country_code, event_date, date_range
on public.races
for each row execute function public.sync_packages_from_race_event_fields();

-- Event titles: madrid is the Spanish Grand Prix (MADRING).
-- spain-* is the Barcelona Grand Prix, not the Spanish Grand Prix.
update public.races
set name = 'Barcelona Grand Prix',
    short_name = 'Barcelona'
where id ~ '^spain-[0-9]{4}$'
  and (name is distinct from 'Barcelona Grand Prix' or short_name is distinct from 'Barcelona');

update public.races
set name = 'Spanish Grand Prix',
    short_name = 'Spain'
where id ~ '^madrid-[0-9]{4}$'
  and (name is distinct from 'Spanish Grand Prix' or short_name is distinct from 'Spain');

update public.races
set circuit = coalesce(
  public.official_f1_circuit_name(id),
  (
    select pkg.circuit
    from public.packages pkg
    where pkg.race_id = races.id
      and nullif(btrim(pkg.circuit), '') is not null
      and lower(btrim(pkg.circuit)) is distinct from lower(btrim(races.name))
    group by pkg.circuit
    order by count(*) desc, pkg.circuit
    limit 1
  ),
  nullif(btrim(location), ''),
  name
)
where nullif(btrim(circuit), '') is null;

-- Catch any packages whose event fields still differ after the backfill trigger.
update public.packages pkg
set
  circuit = race.circuit,
  location = race.location,
  country = race.country,
  country_code = race.country_code,
  event_date = race.event_date,
  date_range = race.date_range
from public.races race
where pkg.race_id = race.id
  and (
    pkg.circuit is distinct from race.circuit
    or pkg.location is distinct from race.location
    or pkg.country is distinct from race.country
    or pkg.country_code is distinct from race.country_code
    or pkg.event_date is distinct from race.event_date
    or pkg.date_range is distinct from race.date_range
  );
