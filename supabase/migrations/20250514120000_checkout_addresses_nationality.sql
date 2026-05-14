-- Checkout: nationality (renamed from client company), shipping/billing on orders + profile defaults; place_order RPC

-- ---------------------------------------------------------------------------
-- Profiles: saved default addresses for checkout
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists shipping_address_line1 text not null default '';
alter table public.profiles add column if not exists shipping_address_line2 text not null default '';
alter table public.profiles add column if not exists shipping_city text not null default '';
alter table public.profiles add column if not exists shipping_postcode text not null default '';
alter table public.profiles add column if not exists shipping_country text not null default '';

alter table public.profiles add column if not exists billing_address_line1 text not null default '';
alter table public.profiles add column if not exists billing_address_line2 text not null default '';
alter table public.profiles add column if not exists billing_city text not null default '';
alter table public.profiles add column if not exists billing_postcode text not null default '';
alter table public.profiles add column if not exists billing_country text not null default '';

-- ---------------------------------------------------------------------------
-- Orders: rename client_company -> client_nationality; add address snapshot
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'client_company'
  ) then
    alter table public.orders rename column client_company to client_nationality;
  end if;
end $$;

alter table public.orders add column if not exists shipping_address_line1 text not null default '';
alter table public.orders add column if not exists shipping_address_line2 text not null default '';
alter table public.orders add column if not exists shipping_city text not null default '';
alter table public.orders add column if not exists shipping_postcode text not null default '';
alter table public.orders add column if not exists shipping_country text not null default '';

alter table public.orders add column if not exists billing_address_line1 text not null default '';
alter table public.orders add column if not exists billing_address_line2 text not null default '';
alter table public.orders add column if not exists billing_city text not null default '';
alter table public.orders add column if not exists billing_postcode text not null default '';
alter table public.orders add column if not exists billing_country text not null default '';

-- ---------------------------------------------------------------------------
-- place_order: extended signature (drop old 9-arg overload)
-- ---------------------------------------------------------------------------
drop function if exists public.place_order(text, int, text, text, text, text, text, text, text);

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
