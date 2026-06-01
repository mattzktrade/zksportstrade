-- Paddock Club (and other flagged packages): agent submits a request; admin approves before order/inventory.

alter table public.packages
  add column if not exists requires_booking_approval boolean not null default false;

comment on column public.packages.requires_booking_approval is
  'When true, portal checkout creates a booking approval request instead of an immediate order.';

update public.packages
set requires_booking_approval = true
where name ilike '%paddock club%'
  and requires_booking_approval is distinct from true;

-- ---------------------------------------------------------------------------
-- Booking approval requests (pending until admin approves → place_order)
-- ---------------------------------------------------------------------------
create table if not exists public.booking_approval_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  agent_profile_id uuid not null references public.profiles (id) on delete restrict,
  package_id text not null references public.packages (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  guests int not null check (guests > 0),
  unit_price numeric not null check (unit_price >= 0),
  total_amount numeric not null check (total_amount >= 0),
  currency text not null default 'USD',
  client_name text not null,
  client_email text not null,
  client_phone text not null,
  client_nationality text not null default '',
  client_company text not null default '',
  dietary_requirements text,
  special_requests text,
  po_number text,
  shipping_address_line1 text not null default '',
  shipping_address_line2 text not null default '',
  shipping_city text not null default '',
  shipping_postcode text not null default '',
  shipping_country text not null default '',
  billing_address_line1 text not null default '',
  billing_address_line2 text not null default '',
  billing_city text not null default '',
  billing_postcode text not null default '',
  billing_country text not null default '',
  paddock_disclaimer_accepted_at timestamptz not null,
  order_id uuid references public.orders (id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  rejection_note text,
  created_at timestamptz not null default now(),
  constraint booking_approval_requests_reference_unique unique (reference)
);

create index if not exists booking_approval_requests_agent_idx
  on public.booking_approval_requests (agent_profile_id);
create index if not exists booking_approval_requests_status_idx
  on public.booking_approval_requests (status) where status = 'pending';
create index if not exists booking_approval_requests_created_idx
  on public.booking_approval_requests (created_at desc);

alter table public.booking_approval_requests enable row level security;

drop policy if exists "booking_approval_requests_select_own_or_admin" on public.booking_approval_requests;
create policy "booking_approval_requests_select_own_or_admin"
  on public.booking_approval_requests for select
  using (agent_profile_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- submit_booking_approval_request
-- ---------------------------------------------------------------------------
create or replace function public.submit_booking_approval_request(
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
  v_sellable int;
  v_unit numeric;
  v_total numeric;
  v_currency text;
  v_request_id uuid;
  v_ref text;
  v_company text;
  v_today_london date := (current_timestamp at time zone 'Europe/London')::date;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select (p.approval_status = 'approved'), coalesce(nullif(btrim(p.company_name), ''), '')
  into v_approved, v_company
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
    pk.name,
    pk.event_date,
    pk.requires_booking_approval
  into v_pkg
  from public.packages pk
  where pk.id = p_package_id;

  if not found then
    raise exception 'package_not_found';
  end if;
  if not coalesce(v_pkg.requires_booking_approval, false) then
    raise exception 'booking_approval_not_required';
  end if;
  if v_pkg.event_date < v_today_london then
    raise exception 'event_has_ended';
  end if;
  if v_pkg.is_enquiry then
    raise exception 'package_enquiry_only';
  end if;
  if v_pkg.trade_price is null then
    raise exception 'package_price_missing';
  end if;

  if exists (
    select 1
    from public.booking_approval_requests r
    where r.agent_profile_id = v_uid
      and r.package_id = p_package_id
      and r.status = 'pending'
  ) then
    raise exception 'pending_request_exists';
  end if;

  perform public.lock_package_inventory(p_package_id);

  v_sellable := public.linked_inventory_sellable(p_package_id, v_uid);
  if v_sellable < p_guests then
    raise exception 'insufficient_stock';
  end if;

  v_unit := v_pkg.trade_price::numeric;
  v_currency := coalesce(nullif(btrim(v_pkg.currency), ''), 'USD');
  v_total := round(v_unit * p_guests, 2);
  v_ref := 'REQ-' || to_char(timezone('utc', now()), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.booking_approval_requests (
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
    client_company,
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
    billing_country,
    paddock_disclaimer_accepted_at
  )
  values (
    v_ref,
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
    v_company,
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
    coalesce(btrim(p_bill_country), ''),
    timezone('utc', now())
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'request_id', v_request_id,
    'request_reference', v_ref,
    'package_name', v_pkg.name,
    'circuit', v_pkg.circuit,
    'total_amount', v_total,
    'currency', v_currency,
    'guests', p_guests
  );
end;
$$;

revoke all on function public.submit_booking_approval_request(
  text, int, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text
) from public;
grant execute on function public.submit_booking_approval_request(
  text, int, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_approve_booking_request → place_order for the agent
-- ---------------------------------------------------------------------------
create or replace function public.admin_approve_booking_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select *
  into v_req
  from public.booking_approval_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  v_result := public.place_order(
    v_req.package_id,
    v_req.guests,
    v_req.client_name,
    v_req.client_email,
    v_req.client_phone,
    v_req.client_nationality,
    coalesce(v_req.dietary_requirements, ''),
    coalesce(v_req.special_requests, ''),
    coalesce(v_req.po_number, ''),
    v_req.shipping_address_line1,
    v_req.shipping_address_line2,
    v_req.shipping_city,
    v_req.shipping_postcode,
    v_req.shipping_country,
    v_req.billing_address_line1,
    v_req.billing_address_line2,
    v_req.billing_city,
    v_req.billing_postcode,
    v_req.billing_country,
    v_req.agent_profile_id
  );

  update public.booking_approval_requests
  set status = 'approved',
      order_id = (v_result->>'order_id')::uuid,
      reviewed_at = timezone('utc', now()),
      reviewed_by = auth.uid()
  where id = p_request_id;

  return v_result || jsonb_build_object('request_id', p_request_id, 'request_reference', v_req.reference);
end;
$$;

revoke all on function public.admin_approve_booking_request(uuid) from public;
grant execute on function public.admin_approve_booking_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_reject_booking_request
-- ---------------------------------------------------------------------------
create or replace function public.admin_reject_booking_request(
  p_request_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select status into v_status
  from public.booking_approval_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found';
  end if;
  if v_status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  update public.booking_approval_requests
  set status = 'rejected',
      rejection_note = case
        when p_note is null or btrim(p_note) = '' then null
        else btrim(p_note)
      end,
      reviewed_at = timezone('utc', now()),
      reviewed_by = auth.uid()
  where id = p_request_id;
end;
$$;

revoke all on function public.admin_reject_booking_request(uuid, text) from public;
grant execute on function public.admin_reject_booking_request(uuid, text) to authenticated;
