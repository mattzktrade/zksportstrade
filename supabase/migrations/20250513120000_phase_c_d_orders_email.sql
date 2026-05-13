-- Phase C + D (email only): persisted orders, invoices, atomic checkout + stock

-- ---------------------------------------------------------------------------
-- Orders (agent bookings)
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  agent_profile_id uuid not null references public.profiles (id) on delete restrict,
  package_id text not null references public.packages (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  guests int not null check (guests > 0),
  unit_price numeric not null check (unit_price >= 0),
  total_amount numeric not null check (total_amount >= 0),
  currency text not null default 'USD',
  client_name text not null,
  client_email text not null,
  client_phone text not null,
  client_company text not null default '',
  dietary_requirements text,
  special_requests text,
  po_number text,
  created_at timestamptz not null default now(),
  constraint orders_reference_unique unique (reference)
);

create index if not exists orders_agent_profile_id_idx on public.orders (agent_profile_id);
create index if not exists orders_package_id_idx on public.orders (package_id);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- ---------------------------------------------------------------------------
-- Invoices (portal snapshot; finance updates status manually for now)
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  reference text not null,
  amount numeric not null check (amount >= 0),
  currency text not null default 'USD',
  status text not null default 'pending' check (status in ('paid', 'pending', 'overdue')),
  issued_at timestamptz not null default now(),
  due_date date,
  created_at timestamptz not null default now(),
  constraint invoices_order_id_unique unique (order_id),
  constraint invoices_reference_unique unique (reference)
);

create index if not exists invoices_order_id_idx on public.invoices (order_id);

-- ---------------------------------------------------------------------------
-- RPC: place order + decrement inventory (sellable = qty_available - qty_held)
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_package_id text,
  p_guests int,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_client_company text,
  p_dietary text,
  p_special text,
  p_po text
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
begin
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

  v_sellable := v_qty_available - v_qty_held;
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
    client_company,
    dietary_requirements,
    special_requests,
    po_number
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
    coalesce(btrim(p_client_company), ''),
    nullif(btrim(p_dietary), ''),
    nullif(btrim(p_special), ''),
    nullif(btrim(p_po), '')
  )
  returning id into v_order_id;

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
  text
) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.invoices enable row level security;

drop policy if exists "orders_select_own_or_admin" on public.orders;
create policy "orders_select_own_or_admin"
  on public.orders for select
  using (agent_profile_id = auth.uid() or public.is_admin());

drop policy if exists "invoices_select_via_order_or_admin" on public.invoices;
create policy "invoices_select_via_order_or_admin"
  on public.invoices for select
  using (
    public.is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = invoices.order_id
        and o.agent_profile_id = auth.uid()
    )
  );

-- No direct client inserts/updates; mutations via place_order RPC only
