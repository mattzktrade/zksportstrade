-- Phase B: admin catalog mutations, inventory holds, approval note

-- ---------------------------------------------------------------------------
-- Profiles: optional note when approving / rejecting
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists approval_note text;

-- ---------------------------------------------------------------------------
-- Inventory holds (auditable per agent; ties to qty_held on package_inventory)
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_holds (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.packages (id) on delete cascade,
  agent_profile_id uuid not null references public.profiles (id) on delete restrict,
  quantity int not null check (quantity > 0),
  note text,
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create index if not exists inventory_holds_package_id_idx on public.inventory_holds (package_id);
create index if not exists inventory_holds_agent_profile_id_idx on public.inventory_holds (agent_profile_id);
create index if not exists inventory_holds_active_idx on public.inventory_holds (package_id) where released_at is null;

alter table public.inventory_holds enable row level security;

drop policy if exists "inventory_holds_select_admin" on public.inventory_holds;
create policy "inventory_holds_select_admin"
  on public.inventory_holds for select
  using (public.is_admin());

-- Mutations go through SECURITY DEFINER RPCs below (no direct insert/update from clients)

-- ---------------------------------------------------------------------------
-- Admin write access: catalog
-- ---------------------------------------------------------------------------
drop policy if exists "races_insert_admin" on public.races;
drop policy if exists "races_update_admin" on public.races;
drop policy if exists "races_delete_admin" on public.races;

create policy "races_insert_admin"
  on public.races for insert
  with check (public.is_admin());

create policy "races_update_admin"
  on public.races for update
  using (public.is_admin());

create policy "races_delete_admin"
  on public.races for delete
  using (public.is_admin());

drop policy if exists "packages_insert_admin" on public.packages;
drop policy if exists "packages_update_admin" on public.packages;
drop policy if exists "packages_delete_admin" on public.packages;

create policy "packages_insert_admin"
  on public.packages for insert
  with check (public.is_admin());

create policy "packages_update_admin"
  on public.packages for update
  using (public.is_admin());

create policy "packages_delete_admin"
  on public.packages for delete
  using (public.is_admin());

drop policy if exists "package_inventory_insert_admin" on public.package_inventory;
drop policy if exists "package_inventory_update_admin" on public.package_inventory;
drop policy if exists "package_inventory_delete_admin" on public.package_inventory;

create policy "package_inventory_insert_admin"
  on public.package_inventory for insert
  with check (public.is_admin());

create policy "package_inventory_update_admin"
  on public.package_inventory for update
  using (public.is_admin());

create policy "package_inventory_delete_admin"
  on public.package_inventory for delete
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- RPC: create / release hold (atomic + is_admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_hold(
  p_package_id text,
  p_agent_profile_id uuid,
  p_quantity int,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold_id uuid;
  v_qty_available int;
  v_qty_held int;
  v_agent_role text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid quantity';
  end if;

  select role into v_agent_role
  from public.profiles
  where id = p_agent_profile_id;
  if not found then
    raise exception 'profile not found';
  end if;
  if v_agent_role is distinct from 'agent' then
    raise exception 'holds can only be assigned to agent profiles';
  end if;

  select qty_available, qty_held into v_qty_available, v_qty_held
  from public.package_inventory
  where package_id = p_package_id
  for update;
  if not found then
    raise exception 'inventory row missing for package';
  end if;
  if v_qty_held + p_quantity > v_qty_available then
    raise exception 'insufficient free capacity';
  end if;

  insert into public.inventory_holds (package_id, agent_profile_id, quantity, note)
  values (
    p_package_id,
    p_agent_profile_id,
    p_quantity,
    case when p_note is null or btrim(p_note) = '' then null else btrim(p_note) end
  )
  returning id into v_hold_id;

  update public.package_inventory
  set qty_held = v_qty_held + p_quantity
  where package_id = p_package_id;

  return v_hold_id;
end;
$$;

create or replace function public.admin_release_hold(p_hold_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty int;
  v_pkg text;
  v_released timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select quantity, package_id, released_at into v_qty, v_pkg, v_released
  from public.inventory_holds
  where id = p_hold_id
  for update;
  if not found then
    raise exception 'hold not found';
  end if;
  if v_released is not null then
    raise exception 'hold already released';
  end if;

  update public.package_inventory
  set qty_held = qty_held - v_qty
  where package_id = v_pkg;

  update public.inventory_holds
  set released_at = now()
  where id = p_hold_id;
end;
$$;

grant execute on function public.admin_create_hold(text, uuid, int, text) to authenticated;
grant execute on function public.admin_release_hold(uuid) to authenticated;
