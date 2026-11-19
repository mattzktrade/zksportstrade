-- Backstop against duplicate enquiry/catalog events and products.
-- Skip each unique index when existing rows would collide, so this can apply
-- on databases that already have near-duplicate names.

do $$
begin
  if exists (
    select 1
    from public.races
    group by lower(btrim(name)), season
    having count(*) > 1
  ) then
    raise notice 'Skipping races_name_season_unique_idx because duplicate event names already exist.';
  else
    execute $sql$
      create unique index if not exists races_name_season_unique_idx
        on public.races (lower(btrim(name)), season)
    $sql$;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from public.packages
    where shell_parent_package_id is null
    group by race_id, lower(btrim(name))
    having count(*) > 1
  ) then
    raise notice 'Skipping packages_race_name_unique_idx because duplicate product names already exist.';
  else
    execute $sql$
      create unique index if not exists packages_race_name_unique_idx
        on public.packages (race_id, lower(btrim(name)))
        where shell_parent_package_id is null
    $sql$;
  end if;
end
$$;
