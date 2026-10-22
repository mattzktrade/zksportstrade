-- ADGP public checkout: map site slug+day to CRM packages, hold stock during
-- Stripe Checkout, then commit a prepaid website order + paid deal.
-- Does not change place_order, place_wix_order, or marketing-lead ingest.

create table if not exists public.adgp_package_map (
  slug text not null,
  day text not null,
  package_id text not null references public.packages (id) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  constraint adgp_package_map_slug_day_unique unique (slug, day),
  constraint adgp_package_map_slug_nonempty check (btrim(slug) <> ''),
  constraint adgp_package_map_day_nonempty check (btrim(day) <> '')
);

create index if not exists adgp_package_map_package_id_idx
  on public.adgp_package_map (package_id)
  where enabled;

alter table public.adgp_package_map enable row level security;

drop policy if exists "adgp_package_map_staff_select" on public.adgp_package_map;
create policy "adgp_package_map_staff_select"
  on public.adgp_package_map for select
  using (public.is_cms_staff());

create table if not exists public.website_checkout_holds (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.packages (id) on delete restrict,
  slug text not null,
  day text not null,
  guests int not null check (guests > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  currency text not null default 'USD',
  inventory_hold_id uuid references public.inventory_holds (id) on delete set null,
  stripe_session_id text,
  expires_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'converted', 'released', 'expired')),
  order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists website_checkout_holds_stripe_session_uidx
  on public.website_checkout_holds (stripe_session_id)
  where stripe_session_id is not null and btrim(stripe_session_id) <> '';

create index if not exists website_checkout_holds_active_idx
  on public.website_checkout_holds (status, expires_at)
  where status = 'active';

alter table public.website_checkout_holds enable row level security;

drop policy if exists "website_checkout_holds_staff_select" on public.website_checkout_holds;
create policy "website_checkout_holds_staff_select"
  on public.website_checkout_holds for select
  using (public.is_cms_staff());

alter table public.orders drop constraint if exists orders_channel_check;
alter table public.orders
  add constraint orders_channel_check
  check (channel in ('trade_portal', 'wix', 'partner_api', 'admin', 'native_deal', 'website'));

insert into public.adgp_package_map (slug, day, package_id, enabled)
select v.slug, v.day, v.package_id, true
from (
  values
    ('skybridge-terrace', '3-day weekend', 'abudhabi-skybridge-terrace-3days-2026'),
    ('skybridge-terrace', 'Friday', 'abudhabi-skybridge-terrace-friday-2026'),
    ('skybridge-terrace', 'Saturday', 'abudhabi-skybridge-terrace-saturday-2026'),
    ('skybridge-terrace', 'Sunday', 'abudhabi-skybridge-terrace-sunday-2026'),
    ('marsa-box', '3-day weekend', 'abudhabi-marsa-box-3days-2026'),
    ('marsa-box', 'Friday', 'abudhabi-marsa-box-friday-2026'),
    ('marsa-box', 'Saturday', 'abudhabi-marsa-box-saturday-2026'),
    ('marsa-box', 'Sunday', 'abudhabi-marsa-box-sunday-2026'),
    ('velocity-terrace', '3-day weekend', 'abudhabi-2026-3-days-velocity-terrace'),
    ('velocity-terrace', 'Friday', 'abudhabi-2026-friday-velocity-terrace'),
    ('velocity-terrace', 'Saturday', 'abudhabi-2026-saturday-velocity-terrace'),
    ('velocity-terrace', 'Sunday', 'abudhabi-2026-sunday-velocity-terrace'),
    ('club-58', '3-day weekend', 'abudhabi-club-58-2026'),
    ('marina-views-brunch', '3-day weekend', 'abudhabi-marina-views-brunch-2026'),
    ('south-club', '3-day weekend', 'abudhabi-2026-south-club'),
    ('south-grandstand', '3-day weekend', 'abudhabi-south-grandstand-2026'),
    ('north-grandstand', '3-day weekend', 'abudhabi-north-grandstand-2026'),
    ('west-grandstand', '3-day weekend', 'abudhabi-2026-west-grandstand')
) as v(slug, day, package_id)
where exists (select 1 from public.packages p where p.id = v.package_id)
on conflict (slug, day) do nothing;

create or replace function public.reconcile_holds_for_package(p_package_id text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_group text;
begin
  if p_package_id is null then
    return;
  end if;
  select inventory_group_id into v_group
  from public.packages
  where id = p_package_id;
  if v_group is null then
    perform public.reconcile_package_holds(p_package_id);
  else
    perform public.reconcile_linked_inventory_holds(v_group);
  end if;
end;
$$;

create or replace function public.place_website_checkout_hold(
  p_package_id text,
  p_slug text,
  p_day text,
  p_guests int,
  p_unit_price numeric,
  p_currency text,
  p_agent_profile_id uuid,
  p_hold_minutes int default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg record;
  v_sellable int;
  v_hold_id uuid;
  v_inventory_hold_id uuid;
  v_expires timestamptz;
  v_low_stock_threshold int := 5;
  v_minutes int := greatest(5, least(coalesce(p_hold_minutes, 30), 60));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_guests is null or p_guests <= 0 then
    raise exception 'invalid_guests';
  end if;
  if p_unit_price is null or p_unit_price <= 0 then
    raise exception 'package_price_missing';
  end if;
  if p_agent_profile_id is null then
    raise exception 'agent_profile_id_required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_agent_profile_id and p.approval_status = 'approved'
  ) then
    raise exception 'agent_not_approved';
  end if;
  if not exists (
    select 1
    from public.adgp_package_map m
    where m.package_id = p_package_id
      and m.slug = btrim(p_slug)
      and m.day = btrim(p_day)
      and m.enabled
  ) then
    raise exception 'package_not_mapped';
  end if;

  select pk.id, pk.is_enquiry, pk.trade_price, pk.name, pk.event_date, pk.currency
  into v_pkg
  from public.packages pk
  where pk.id = p_package_id
  for update;

  if not found then
    raise exception 'package_not_found';
  end if;
  if v_pkg.event_date < (current_timestamp at time zone 'Europe/London')::date then
    raise exception 'event_has_ended';
  end if;
  if v_pkg.is_enquiry then
    raise exception 'package_enquiry_only';
  end if;

  perform public.lock_package_inventory(p_package_id);
  if not exists (select 1 from public.package_inventory where package_id = p_package_id) then
    raise exception 'inventory_missing';
  end if;

  v_sellable := public.linked_inventory_sellable(p_package_id, p_agent_profile_id);
  if v_sellable < p_guests then
    raise exception 'insufficient_stock';
  end if;
  if v_sellable <= v_low_stock_threshold and (v_sellable - p_guests) = 1 then
    raise exception 'leaves_one_remaining';
  end if;

  v_expires := timezone('utc', now()) + make_interval(mins => v_minutes);

  insert into public.inventory_holds (
    package_id,
    agent_profile_id,
    quantity,
    note,
    expires_at
  )
  values (
    p_package_id,
    p_agent_profile_id,
    p_guests,
    'ADGP website checkout hold',
    v_expires
  )
  returning id into v_inventory_hold_id;

  perform public.reconcile_holds_for_package(p_package_id);

  insert into public.website_checkout_holds (
    package_id,
    slug,
    day,
    guests,
    unit_price,
    currency,
    inventory_hold_id,
    expires_at,
    status
  )
  values (
    p_package_id,
    btrim(p_slug),
    btrim(p_day),
    p_guests,
    round(p_unit_price::numeric, 2),
    coalesce(nullif(btrim(p_currency), ''), nullif(btrim(v_pkg.currency), ''), 'USD'),
    v_inventory_hold_id,
    v_expires,
    'active'
  )
  returning id into v_hold_id;

  return jsonb_build_object(
    'hold_id', v_hold_id,
    'inventory_hold_id', v_inventory_hold_id,
    'expires_at', v_expires,
    'package_id', p_package_id,
    'package_name', v_pkg.name,
    'guests', p_guests,
    'unit_price', round(p_unit_price::numeric, 2),
    'currency', coalesce(nullif(btrim(p_currency), ''), nullif(btrim(v_pkg.currency), ''), 'USD')
  );
end;
$$;

revoke all on function public.place_website_checkout_hold(text, text, text, int, numeric, text, uuid, int) from public;
grant execute on function public.place_website_checkout_hold(text, text, text, int, numeric, text, uuid, int) to service_role;

create or replace function public.release_website_checkout_hold(p_hold_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold public.website_checkout_holds%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_hold_id is null then
    raise exception 'hold_id_required';
  end if;

  select * into v_hold
  from public.website_checkout_holds
  where id = p_hold_id
  for update;

  if not found then
    raise exception 'hold_not_found';
  end if;
  if v_hold.status = 'converted' then
    return jsonb_build_object('ok', true, 'status', v_hold.status, 'duplicate', true);
  end if;
  if v_hold.status in ('released', 'expired') then
    return jsonb_build_object('ok', true, 'status', v_hold.status, 'duplicate', true);
  end if;

  if v_hold.inventory_hold_id is not null then
    update public.inventory_holds
    set released_at = timezone('utc', now())
    where id = v_hold.inventory_hold_id
      and released_at is null;
    perform public.reconcile_holds_for_package(v_hold.package_id);
  end if;

  update public.website_checkout_holds
  set status = case
        when expires_at <= timezone('utc', now()) then 'expired'
        else 'released'
      end,
      updated_at = timezone('utc', now())
  where id = v_hold.id;

  return jsonb_build_object('ok', true, 'status', 'released', 'duplicate', false);
end;
$$;

revoke all on function public.release_website_checkout_hold(uuid) from public;
grant execute on function public.release_website_checkout_hold(uuid) to service_role;

create or replace function public.place_website_order(
  p_external_order_id text,
  p_hold_id uuid,
  p_package_id text,
  p_guests int,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_agent_profile_id uuid,
  p_owner_profile_id uuid,
  p_unit_price numeric,
  p_currency text,
  p_client_nationality text default '',
  p_bill_line1 text default '',
  p_bill_line2 text default null,
  p_bill_city text default '',
  p_bill_postcode text default '',
  p_bill_country text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg record;
  v_hold public.website_checkout_holds%rowtype;
  v_sellable int;
  v_unit numeric;
  v_total numeric;
  v_currency text;
  v_order_id uuid;
  v_order_ref text;
  v_invoice_id uuid;
  v_deal_id uuid;
  v_deal_ref text;
  v_account_id uuid;
  v_contact_id uuid;
  v_account_name text;
  v_email text;
  v_phone text;
  v_name text;
  v_ext text := nullif(btrim(p_external_order_id), '');
  v_paid_at timestamptz := timezone('utc', now());
  v_low_stock_threshold int := 5;
  v_is_primary boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if v_ext is null then
    raise exception 'external_order_id_required';
  end if;
  if p_owner_profile_id is null then
    raise exception 'owner_profile_required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id
      and p.role in ('admin', 'finance', 'sales')
  ) then
    raise exception 'owner_profile_invalid';
  end if;
  if p_agent_profile_id is null then
    raise exception 'agent_profile_id_required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_agent_profile_id and p.approval_status = 'approved'
  ) then
    raise exception 'agent_not_approved';
  end if;
  if p_guests is null or p_guests <= 0 then
    raise exception 'invalid_guests';
  end if;

  select o.id, o.reference, o.deal_id
  into v_order_id, v_order_ref, v_deal_id
  from public.orders o
  where o.external_order_id = v_ext
  limit 1;

  if v_order_id is not null then
    select reference into v_deal_ref from public.deals where id = v_deal_id;
    return jsonb_build_object(
      'order_id', v_order_id,
      'order_reference', v_order_ref,
      'deal_id', v_deal_id,
      'deal_reference', v_deal_ref,
      'duplicate', true
    );
  end if;

  if p_hold_id is not null then
    select * into v_hold
    from public.website_checkout_holds
    where id = p_hold_id
    for update;
    if not found then
      raise exception 'hold_not_found';
    end if;
    if v_hold.status = 'converted' and v_hold.order_id is not null then
      select o.id, o.reference, o.deal_id
      into v_order_id, v_order_ref, v_deal_id
      from public.orders o
      where o.id = v_hold.order_id;
      select reference into v_deal_ref from public.deals where id = v_deal_id;
      return jsonb_build_object(
        'order_id', v_order_id,
        'order_reference', v_order_ref,
        'deal_id', v_deal_id,
        'deal_reference', v_deal_ref,
        'duplicate', true
      );
    end if;
    if v_hold.package_id is distinct from p_package_id then
      raise exception 'hold_package_mismatch';
    end if;
    if v_hold.guests is distinct from p_guests then
      raise exception 'hold_guests_mismatch';
    end if;
    if round(v_hold.unit_price, 2) is distinct from round(p_unit_price::numeric, 2) then
      raise exception 'hold_price_mismatch';
    end if;
    if v_hold.status in ('released', 'expired') then
      v_hold.id := null;
    elsif v_hold.expires_at <= timezone('utc', now()) then
      if v_hold.inventory_hold_id is not null then
        update public.inventory_holds
        set released_at = timezone('utc', now())
        where id = v_hold.inventory_hold_id
          and released_at is null;
        perform public.reconcile_holds_for_package(v_hold.package_id);
      end if;
      update public.website_checkout_holds
      set status = 'expired', updated_at = timezone('utc', now())
      where id = v_hold.id;
      v_hold.id := null;
    end if;
  end if;

  select
    pk.id,
    pk.is_enquiry,
    pk.trade_price,
    pk.currency,
    pk.circuit,
    pk.name,
    pk.event_date,
    pk.race_id
  into v_pkg
  from public.packages pk
  where pk.id = p_package_id
  for update;

  if not found then
    raise exception 'package_not_found';
  end if;
  if v_pkg.event_date < (current_timestamp at time zone 'Europe/London')::date then
    raise exception 'event_has_ended';
  end if;
  if v_pkg.is_enquiry then
    raise exception 'package_enquiry_only';
  end if;
  if p_unit_price is null or p_unit_price <= 0 then
    raise exception 'package_price_missing';
  end if;

  v_unit := round(p_unit_price::numeric, 2);
  v_currency := coalesce(nullif(btrim(p_currency), ''), nullif(btrim(v_pkg.currency), ''), 'USD');
  v_total := round(v_unit * p_guests, 2);
  v_name := nullif(btrim(p_client_name), '');
  v_email := nullif(btrim(lower(p_client_email)), '');
  v_phone := nullif(btrim(p_client_phone), '');
  if v_name is null then
    raise exception 'client_name_required';
  end if;
  if v_email is null then
    raise exception 'client_email_required';
  end if;

  perform public.lock_package_inventory(p_package_id);
  if not exists (select 1 from public.package_inventory where package_id = p_package_id) then
    raise exception 'inventory_missing';
  end if;

  v_sellable := public.linked_inventory_sellable(p_package_id, p_agent_profile_id);
  if v_sellable < p_guests then
    raise exception 'insufficient_stock';
  end if;
  if v_sellable <= v_low_stock_threshold and (v_sellable - p_guests) = 1 then
    raise exception 'leaves_one_remaining';
  end if;

  v_order_ref := 'ZK-' || to_char(timezone('utc', now()), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    reference,
    agent_profile_id,
    package_id,
    status,
    channel,
    external_order_id,
    guests,
    unit_price,
    total_amount,
    currency,
    client_name,
    client_email,
    client_phone,
    client_nationality,
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
    p_agent_profile_id,
    p_package_id,
    'confirmed',
    'website',
    v_ext,
    p_guests,
    v_unit,
    v_total,
    v_currency,
    v_name,
    v_email,
    coalesce(v_phone, '—'),
    coalesce(btrim(p_client_nationality), ''),
    coalesce(btrim(p_bill_line1), ''),
    coalesce(btrim(p_bill_line2), ''),
    coalesce(btrim(p_bill_city), ''),
    coalesce(btrim(p_bill_postcode), ''),
    coalesce(btrim(p_bill_country), ''),
    coalesce(btrim(p_bill_line1), ''),
    coalesce(btrim(p_bill_line2), ''),
    coalesce(btrim(p_bill_city), ''),
    coalesce(btrim(p_bill_postcode), ''),
    coalesce(btrim(p_bill_country), '')
  )
  returning id into v_order_id;

  perform public.adjust_linked_inventory_available(p_package_id, -p_guests);
  perform public.allocate_order_cost_layers(v_order_id, p_package_id, p_guests, v_currency);

  if v_hold.inventory_hold_id is not null then
    update public.inventory_holds
    set released_at = timezone('utc', now())
    where id = v_hold.inventory_hold_id
      and released_at is null;
    perform public.reconcile_holds_for_package(p_package_id);
  end if;

  insert into public.invoices (
    order_id, reference, amount, currency, status, issued_at, due_date, paid_at
  )
  values (
    v_order_id,
    v_order_ref,
    v_total,
    v_currency,
    'paid',
    v_paid_at,
    (v_paid_at at time zone 'utc')::date,
    v_paid_at
  )
  returning id into v_invoice_id;

  select c.id, c.account_id
  into v_contact_id, v_account_id
  from public.crm_contacts c
  where c.active = true
    and c.email is not null
    and lower(c.email) = v_email
  order by c.created_at
  limit 1;

  if v_account_id is null then
    select id into v_account_id
    from public.crm_accounts
    where active = true
      and email is not null
      and lower(email) = v_email
    order by created_at
    limit 1;
  end if;

  if v_account_id is null then
    v_account_name := v_name;
    if exists (
      select 1 from public.crm_accounts where lower(btrim(name)) = lower(v_account_name)
    ) then
      v_account_name := left(v_name || ' (' || v_email || ')', 180);
    end if;
    insert into public.crm_accounts (
      name,
      account_type,
      account_types,
      email,
      phone,
      source,
      lifecycle,
      lead_stage,
      active
    )
    values (
      v_account_name,
      'direct_client',
      array['direct_client']::text[],
      v_email,
      v_phone,
      'website',
      'client',
      'talking',
      true
    )
    returning id into v_account_id;
  else
    update public.crm_accounts
    set lifecycle = 'client',
        email = coalesce(email, v_email),
        phone = coalesce(phone, v_phone),
        updated_at = timezone('utc', now())
    where id = v_account_id;
  end if;

  if v_contact_id is null then
    v_is_primary := not exists (
      select 1 from public.crm_contacts
      where account_id = v_account_id and active = true and is_primary
    );
    insert into public.crm_contacts (
      account_id,
      full_name,
      email,
      phone,
      is_primary,
      active
    )
    values (
      v_account_id,
      v_name,
      v_email,
      v_phone,
      v_is_primary,
      true
    )
    returning id into v_contact_id;
  else
    update public.crm_contacts
    set phone = coalesce(phone, v_phone),
        full_name = coalesce(nullif(btrim(full_name), ''), v_name)
    where id = v_contact_id;
  end if;

  insert into public.deals (
    reference,
    account_id,
    primary_contact_id,
    owner_profile_id,
    race_id,
    source,
    stage,
    currency,
    total_amount,
    notes,
    next_action,
    order_id,
    closed_at,
    created_at,
    updated_at
  )
  values (
    'DL0000',
    v_account_id,
    v_contact_id,
    p_owner_profile_id,
    v_pkg.race_id,
    'website',
    'paid_confirmed',
    v_currency,
    v_total,
    concat_ws(
      E'\n',
      'Paid website checkout from the Abu Dhabi GP site.',
      'Stripe session: ' || v_ext,
      'Package: ' || v_pkg.name,
      'Guests: ' || p_guests::text
    ),
    'Hand over to fulfilment',
    v_order_id,
    v_paid_at,
    v_paid_at,
    v_paid_at
  )
  returning id, reference into v_deal_id, v_deal_ref;

  insert into public.deal_line_items (
    deal_id,
    package_id,
    quantity,
    unit_sale_price,
    currency,
    sourcing_mode,
    reservation_status,
    sort_order
  )
  values (
    v_deal_id,
    p_package_id,
    p_guests,
    v_unit,
    v_currency,
    'owned',
    'none',
    0
  );

  update public.orders
  set deal_id = v_deal_id,
      crm_account_id = v_account_id,
      crm_contact_id = v_contact_id
  where id = v_order_id;

  insert into public.deal_activities (deal_id, actor_profile_id, action, summary, metadata)
  values (
    v_deal_id,
    p_owner_profile_id,
    'website_checkout_paid',
    'Paid website checkout from the Abu Dhabi GP website.',
    jsonb_build_object(
      'order_id', v_order_id,
      'order_reference', v_order_ref,
      'channel', 'website',
      'stripe_session_id', v_ext
    )
  );

  if p_hold_id is not null then
    update public.website_checkout_holds
    set status = 'converted',
        order_id = v_order_id,
        stripe_session_id = coalesce(stripe_session_id, v_ext),
        updated_at = timezone('utc', now())
    where id = p_hold_id;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_reference', v_order_ref,
    'deal_id', v_deal_id,
    'deal_reference', v_deal_ref,
    'package_name', v_pkg.name,
    'circuit', v_pkg.circuit,
    'total_amount', v_total,
    'currency', v_currency,
    'guests', p_guests,
    'duplicate', false
  );
end;
$$;

revoke all on function public.place_website_order(text, uuid, text, int, text, text, text, uuid, uuid, numeric, text, text, text, text, text, text, text) from public;
grant execute on function public.place_website_order(text, uuid, text, int, text, text, text, uuid, uuid, numeric, text, text, text, text, text, text, text) to service_role;
