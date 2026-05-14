-- Hold expiry (auto-release), place_order consumes agent holds for checkout, agent RLS on holds

-- ---------------------------------------------------------------------------
-- inventory_holds.expires_at
-- ---------------------------------------------------------------------------
alter table public.inventory_holds add column if not exists expires_at timestamptz;

update public.inventory_holds
set expires_at = coalesce(expires_at, created_at + interval '24 hours')
where expires_at is null;

alter table public.inventory_holds
  alter column expires_at set default (timezone('utc', now()) + interval '24 hours');

alter table public.inventory_holds
  alter column expires_at set not null;

create index if not exists inventory_holds_expires_active_idx
  on public.inventory_holds (expires_at)
  where released_at is null;

-- ---------------------------------------------------------------------------
-- Agents can read their own unreleased holds (portal catalog / checkout)
-- ---------------------------------------------------------------------------
drop policy if exists "inventory_holds_select_own_active" on public.inventory_holds;
create policy "inventory_holds_select_own_active"
  on public.inventory_holds for select
  using (
    agent_profile_id = (select auth.uid())
    and released_at is null
  );

-- ---------------------------------------------------------------------------
-- admin_create_hold: optional hold duration in hours (default 24)
-- ---------------------------------------------------------------------------
drop function if exists public.admin_create_hold(text, uuid, int, text);

create or replace function public.admin_create_hold(
  p_package_id text,
  p_agent_profile_id uuid,
  p_quantity int,
  p_note text default null,
  p_hold_hours int default 24
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
  v_hours int;
  v_expires timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid quantity';
  end if;

  v_hours := coalesce(p_hold_hours, 24);
  if v_hours < 1 or v_hours > 720 then
    raise exception 'hold duration must be between 1 and 720 hours';
  end if;
  v_expires := timezone('utc', now()) + (v_hours * interval '1 hour');

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

  insert into public.inventory_holds (package_id, agent_profile_id, quantity, note, expires_at)
  values (
    p_package_id,
    p_agent_profile_id,
    p_quantity,
    case when p_note is null or btrim(p_note) = '' then null else btrim(p_note) end,
    v_expires
  )
  returning id into v_hold_id;

  update public.package_inventory
  set qty_held = v_qty_held + p_quantity
  where package_id = p_package_id;

  return v_hold_id;
end;
$$;

grant execute on function public.admin_create_hold(text, uuid, int, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Release expired holds (no is_admin; for service_role / cron only)
-- ---------------------------------------------------------------------------
create or replace function public.release_expired_inventory_holds()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_qty int;
  v_pkg text;
  v_count int := 0;
begin
  for v_row in
    select id, quantity, package_id
    from public.inventory_holds
    where released_at is null
      and expires_at <= timezone('utc', now())
    order by id
    for update
  loop
    v_qty := v_row.quantity;
    v_pkg := v_row.package_id;

    update public.package_inventory
    set qty_held = qty_held - v_qty
    where package_id = v_pkg;

    update public.inventory_holds
    set released_at = timezone('utc', now())
    where id = v_row.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.release_expired_inventory_holds() from public;
grant execute on function public.release_expired_inventory_holds() to anon;
grant execute on function public.release_expired_inventory_holds() to authenticated;
grant execute on function public.release_expired_inventory_holds() to service_role;

-- ---------------------------------------------------------------------------
-- place_order: effective sellable includes agent's active holds; consume holds on checkout
-- ---------------------------------------------------------------------------
drop function if exists public.place_order(
  text,
  int,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
);

create or replace function public.place_order(
  p_package_id text,
  p_guests int,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_client_nationality text,
  p_dietary text,
  p_special text,
  p_po text,
  p_ship_line1 text,
  p_ship_line2 text,
  p_ship_city text,
  p_ship_postcode text,
  p_ship_country text,
  p_bill_line1 text,
  p_bill_line2 text,
  p_bill_city text,
  p_bill_postcode text,
  p_bill_country text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_approved boolean;
  v_pkg record;
  v_qty_available int;
  v_qty_held int;
  v_my_hold_units int;
  v_sellable int;
  v_unit numeric;
  v_total numeric;
  v_currency text;
  v_order_id uuid;
  v_order_ref text;
  v_invoice_id uuid;
  v_invoice_ref text;
  v_circuit text;
  v_pkg_name text;
  v_hold record;
  v_remaining int;
  v_take int;
  v_expired int;
begin
  v_expired := public.release_expired_inventory_holds();

  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select
    (p.approval_status = 'approved')
  into v_approved
  from public.profiles p
  where p.id = v_uid;
  if not found then
    raise exception 'profile_not_found';
  end if;
  if not coalesce(v_approved, false) then
    raise exception 'not_approved';
  end if;

  if p_guests is null or p_guests <= 0 then
    raise exception 'invalid_guests';
  end if;

  select
    pk.id,
    pk.is_enquiry,
    pk.trade_price,
    pk.currency,
    pk.circuit,
    pk.name
  into v_pkg
  from public.packages pk
  where pk.id = p_package_id
  for update;

  if not found then
    raise exception 'package_not_found';
  end if;
  if v_pkg.is_enquiry then
    raise exception 'package_enquiry_only';
  end if;
  if v_pkg.trade_price is null then
    raise exception 'package_price_missing';
  end if;

  v_unit := v_pkg.trade_price::numeric;
  v_currency := coalesce(nullif(btrim(v_pkg.currency), ''), 'USD');
  v_circuit := v_pkg.circuit;
  v_pkg_name := v_pkg.name;
  v_total := round(v_unit * p_guests, 2);

  select pi.qty_available, pi.qty_held
  into v_qty_available, v_qty_held
  from public.package_inventory pi
  where pi.package_id = p_package_id
  for update;

  if not found then
    raise exception 'inventory_missing';
  end if;

  select coalesce(sum(h.quantity), 0)::int
  into v_my_hold_units
  from public.inventory_holds h
  where h.package_id = p_package_id
    and h.agent_profile_id = v_uid
    and h.released_at is null
    and h.expires_at > timezone('utc', now());

  v_sellable := (v_qty_available - v_qty_held) + v_my_hold_units;
  if v_sellable < p_guests then
    raise exception 'insufficient_stock';
  end if;

  v_order_ref := 'ZK-' || to_char(timezone('utc', now()), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_invoice_ref := 'INV-' || to_char(timezone('utc', now()), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    reference,
    agent_profile_id,
    package_id,
    status,
    guests,
    unit_price,
    total_amount,
    currency,
    client_name,
    client_email,
    client_phone,
    client_nationality,
    dietary_requirements,
    special_requests,
    po_number,
    shipping_address_line1,
    shipping_address_line2,
    shipping_city,
    shipping_postcode,
    shipping_country,
    billing_address_line1,
    billing_address_line2,
    billing_city,
    billing_postcode,
    billing_country
  )
  values (
    v_order_ref,
    v_uid,
    p_package_id,
    'pending',
    p_guests,
    v_unit,
    v_total,
    v_currency,
    btrim(p_client_name),
    btrim(lower(p_client_email)),
    btrim(p_client_phone),
    coalesce(btrim(p_client_nationality), ''),
    nullif(btrim(p_dietary), ''),
    nullif(btrim(p_special), ''),
    nullif(btrim(p_po), ''),
    coalesce(btrim(p_ship_line1), ''),
    coalesce(btrim(p_ship_line2), ''),
    coalesce(btrim(p_ship_city), ''),
    coalesce(btrim(p_ship_postcode), ''),
    coalesce(btrim(p_ship_country), ''),
    coalesce(btrim(p_bill_line1), ''),
    coalesce(btrim(p_bill_line2), ''),
    coalesce(btrim(p_bill_city), ''),
    coalesce(btrim(p_bill_postcode), ''),
    coalesce(btrim(p_bill_country), '')
  )
  returning id into v_order_id;

  -- Consume this agent's active holds (FIFO) against guest count
  v_remaining := p_guests;
  for v_hold in
    select id, quantity
    from public.inventory_holds
    where package_id = p_package_id
      and agent_profile_id = v_uid
      and released_at is null
      and expires_at > timezone('utc', now())
    order by created_at asc, id asc
    for update
  loop
    exit when v_remaining <= 0;
    if v_hold.quantity <= v_remaining then
      update public.package_inventory
      set qty_held = qty_held - v_hold.quantity
      where package_id = p_package_id;

      update public.inventory_holds
      set released_at = timezone('utc', now())
      where id = v_hold.id;

      v_remaining := v_remaining - v_hold.quantity;
    else
      v_take := v_remaining;
      update public.package_inventory
      set qty_held = qty_held - v_take
      where package_id = p_package_id;

      update public.inventory_holds
      set quantity = quantity - v_take
      where id = v_hold.id;

      v_remaining := 0;
    end if;
  end loop;

  update public.package_inventory
  set qty_available = qty_available - p_guests
  where package_id = p_package_id;

  insert into public.invoices (order_id, reference, amount, currency, status, issued_at, due_date)
  values (
    v_order_id,
    v_invoice_ref,
    v_total,
    v_currency,
    'pending',
    timezone('utc', now()),
    (timezone('utc', now()))::date + 30
  )
  returning id into v_invoice_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_reference', v_order_ref,
    'invoice_id', v_invoice_id,
    'invoice_reference', v_invoice_ref,
    'package_name', v_pkg_name,
    'circuit', v_circuit,
    'total_amount', v_total,
    'currency', v_currency,
    'guests', p_guests
  );
end;
$$;

grant execute on function public.place_order(
  text,
  int,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;
