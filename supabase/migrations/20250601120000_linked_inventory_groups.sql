-- Linked inventory groups: schema + group id derivation (cascade rules in 20250601130000).

alter table public.packages
  add column if not exists inventory_group_id text;

comment on column public.packages.inventory_group_id is
  'Links split day options for one product. Cascade rules applied in 20250601130000.';

create index if not exists packages_inventory_group_id_idx
  on public.packages (inventory_group_id)
  where inventory_group_id is not null;

create or replace function public.derive_inventory_group_id(
  p_package_id text,
  p_duration text,
  p_race_id text
)
returns text
language plpgsql
immutable
as $$
declare
  v_base text;
  v_suffixes text[] := array[
    '-sun-sat', '-sat-sun', '-sunday', '-saturday', '-friday', '-thursday', '-2day', '-2-day'
  ];
  v_s text;
begin
  if p_duration is null or btrim(p_duration) = '' then
    return null;
  end if;
  if p_duration not in ('2_day', 'thursday_only', 'friday_only', 'saturday_only', 'sunday_only') then
    return null;
  end if;

  v_base := regexp_replace(p_package_id, '-\d{4}$', '');
  foreach v_s in array v_suffixes loop
    if v_base like '%' || v_s then
      v_base := left(v_base, length(v_base) - length(v_s));
      exit;
    end if;
  end loop;

  return p_race_id || '/' || v_base;
end;
$$;

update public.packages p
set inventory_group_id = public.derive_inventory_group_id(p.id, p.duration, p.race_id)
where p.inventory_group_id is distinct from public.derive_inventory_group_id(p.id, p.duration, p.race_id);

create or replace function public.lock_package_inventory(p_package_id text)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_group text;
begin
  select inventory_group_id into v_group
  from public.packages
  where id = p_package_id;

  if v_group is null then
    perform 1
    from public.package_inventory
    where package_id = p_package_id
    for update;
  else
    perform 1
    from public.package_inventory pi
    join public.packages p on p.id = pi.package_id
    where p.inventory_group_id = v_group
    for update of pi;
  end if;

  return v_group;
end;
$$;
