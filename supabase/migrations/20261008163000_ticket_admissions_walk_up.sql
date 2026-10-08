-- Per-day door admits (one QR covers Fri–Sun) and package-level walk-up tickets.

alter table public.tickets
  add column if not exists walk_up boolean not null default false,
  add column if not exists holder_name text,
  add column if not exists arrived_dates text[] not null default '{}';

alter table public.tickets
  drop constraint if exists tickets_parent_check;
alter table public.tickets
  add constraint tickets_parent_check check (
    deal_id is not null
    or order_id is not null
    or (walk_up = true and package_id is not null)
  );

create table if not exists public.ticket_admissions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  door_date date not null,
  arrived_at timestamptz not null default timezone('utc', now()),
  arrived_by uuid references public.profiles (id) on delete set null,
  method text,
  unique (ticket_id, door_date)
);

create index if not exists ticket_admissions_ticket_idx
  on public.ticket_admissions (ticket_id, door_date desc);

alter table public.ticket_admissions enable row level security;

drop policy if exists "ticket_admissions_cms_select" on public.ticket_admissions;
create policy "ticket_admissions_cms_select"
  on public.ticket_admissions for select
  using (public.has_cms_permission('operations.view') or public.is_admin());

drop policy if exists "ticket_admissions_cms_write" on public.ticket_admissions;
create policy "ticket_admissions_cms_write"
  on public.ticket_admissions for all
  using (public.has_cms_permission('operations.manage') or public.is_admin())
  with check (public.has_cms_permission('operations.manage') or public.is_admin());

drop function if exists public.admit_ticket(uuid, uuid, text);
drop function if exists public.admit_ticket(uuid, uuid, text, date);

create or replace function public.admit_ticket(
  p_ticket_id uuid,
  p_staff_id uuid,
  p_method text,
  p_door_date date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.tickets;
  admission public.ticket_admissions;
  dates text[];
begin
  select * into existing from public.tickets where id = p_ticket_id;
  if existing.id is null then
    return jsonb_build_object('code', 'unknown');
  end if;
  if existing.voided_at is not null or existing.status = 'void' then
    return jsonb_build_object('code', 'void', 'ticket_id', existing.id);
  end if;
  if existing.status not in ('issued', 'sent', 'delivered', 'arrived') then
    return jsonb_build_object('code', 'not_admittable', 'ticket_id', existing.id, 'status', existing.status);
  end if;

  insert into public.ticket_admissions (ticket_id, door_date, arrived_by, method)
  values (p_ticket_id, p_door_date, p_staff_id, coalesce(p_method, 'qr'))
  on conflict (ticket_id, door_date) do nothing
  returning * into admission;

  if admission.id is null then
    select * into admission
      from public.ticket_admissions
     where ticket_id = p_ticket_id and door_date = p_door_date;
    return jsonb_build_object(
      'code', 'already_arrived',
      'ticket_id', existing.id,
      'arrived_at', admission.arrived_at,
      'arrived_by', admission.arrived_by
    );
  end if;

  select coalesce(array_agg(door_date::text order by door_date), '{}')
    into dates
    from public.ticket_admissions
   where ticket_id = p_ticket_id;

  update public.tickets
     set status = 'arrived',
         arrived_at = admission.arrived_at,
         arrived_by = p_staff_id,
         arrived_dates = dates,
         updated_at = timezone('utc', now())
   where id = p_ticket_id
     and voided_at is null;

  insert into public.ticket_events (ticket_id, kind, actor_profile_id, detail, metadata)
  values (
    p_ticket_id,
    'scanned',
    p_staff_id,
    'Arrived',
    jsonb_build_object('method', coalesce(p_method, 'qr'), 'door_date', p_door_date::text)
  );

  return jsonb_build_object('code', 'ok', 'ticket_id', p_ticket_id, 'arrived_at', admission.arrived_at);
end;
$$;

revoke all on function public.admit_ticket(uuid, uuid, text, date) from public;
grant execute on function public.admit_ticket(uuid, uuid, text, date) to service_role;
