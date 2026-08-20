-- Phase 1C: native event lifecycle management.
-- Additive only: existing races remain active and no event/package is deleted.

alter table public.races
  add column if not exists is_archived boolean not null default false;

alter table public.races
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create index if not exists races_active_event_date_idx
  on public.races (is_archived, event_date);

comment on column public.races.is_archived is
  'Soft archive flag for the native CMS. Archiving also hides its packages from sale.';

create or replace function public.admin_set_event_archived(
  p_race_id text,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_race_id text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_race_id := nullif(btrim(p_race_id), '');
  if v_race_id is null then
    raise exception 'race_id_required';
  end if;

  update public.races
  set is_archived = coalesce(p_archived, false),
      updated_at = timezone('utc', now())
  where id = v_race_id;

  if not found then
    raise exception 'race_not_found';
  end if;

  if coalesce(p_archived, false) then
    update public.packages
    set is_hidden = true
    where race_id = v_race_id;
  end if;
end;
$$;

revoke all on function public.admin_set_event_archived(text, boolean) from public;
grant execute on function public.admin_set_event_archived(text, boolean) to authenticated;
