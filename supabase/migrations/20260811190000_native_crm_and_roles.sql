-- Phase 1C permissions + Phase 2A native CRM foundation.
-- Additive only: no deletes of existing profiles, packages, or Salesforce data.

-- ---------------------------------------------------------------------------
-- Internal CMS roles: admin, finance, sales (+ existing agent)
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('agent', 'admin', 'finance', 'sales'));

create or replace function public.is_cms_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'finance', 'sales')
  );
$$;

grant execute on function public.is_cms_staff() to authenticated, anon;

create or replace function public.has_cms_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (
          p.role = 'finance'
          and p_permission in (
            'cms.access',
            'finance.view',
            'finance.manage',
            'orders.view',
            'deals.view',
            'inventory.view'
          )
        )
        or (
          p.role = 'sales'
          and p_permission in (
            'cms.access',
            'deals.view',
            'deals.manage',
            'accounts.manage',
            'inventory.view',
            'inventory.hold',
            'orders.view'
          )
        )
      )
  );
$$;

grant execute on function public.has_cms_permission(text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Accounts / contacts
-- ---------------------------------------------------------------------------
create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_type text not null default 'agent_company',
  email text,
  phone text,
  billing_address_line1 text,
  billing_address_line2 text,
  billing_city text,
  billing_postcode text,
  billing_country text,
  notes text,
  portal_profile_id uuid references public.profiles (id) on delete set null,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_accounts_name_nonempty check (btrim(name) <> ''),
  constraint crm_accounts_type_check check (
    account_type in ('agent_company', 'direct_client', 'supplier_related', 'other')
  )
);

create unique index if not exists crm_accounts_name_unique_idx
  on public.crm_accounts (lower(btrim(name)));

create index if not exists crm_accounts_owner_idx
  on public.crm_accounts (owner_profile_id, active);

alter table public.crm_accounts enable row level security;

drop policy if exists "crm_accounts_staff_all" on public.crm_accounts;
create policy "crm_accounts_staff_all"
  on public.crm_accounts for all
  using (public.is_cms_staff())
  with check (public.is_cms_staff());

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts (id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  job_title text,
  is_primary boolean not null default false,
  portal_profile_id uuid references public.profiles (id) on delete set null,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_contacts_name_nonempty check (btrim(full_name) <> '')
);

create index if not exists crm_contacts_account_idx
  on public.crm_contacts (account_id, is_primary desc, active);

create index if not exists crm_contacts_email_idx
  on public.crm_contacts (lower(btrim(email)))
  where email is not null;

alter table public.crm_contacts enable row level security;

drop policy if exists "crm_contacts_staff_all" on public.crm_contacts;
create policy "crm_contacts_staff_all"
  on public.crm_contacts for all
  using (public.is_cms_staff())
  with check (public.is_cms_staff());

-- ---------------------------------------------------------------------------
-- Deals + line items
-- ---------------------------------------------------------------------------
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  account_id uuid references public.crm_accounts (id) on delete set null,
  primary_contact_id uuid references public.crm_contacts (id) on delete set null,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  race_id text references public.races (id) on delete set null,
  source text not null default 'offline',
  stage text not null default 'draft',
  currency text not null default 'USD',
  expected_close_date date,
  next_action text,
  next_action_due_at timestamptz,
  loss_reason text,
  hold_expires_at timestamptz,
  do_not_expire boolean not null default false,
  total_amount numeric not null default 0,
  order_id uuid references public.orders (id) on delete set null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  closed_at timestamptz,
  constraint deals_reference_unique unique (reference),
  constraint deals_source_check check (
    source in ('offline', 'portal', 'website', 'referral', 'other')
  ),
  constraint deals_stage_check check (
    stage in (
      'draft',
      'sourcing',
      'proposal',
      'booking_form_sent',
      'awaiting_client_signature',
      'awaiting_zk_signature',
      'signed',
      'awaiting_invoice',
      'awaiting_payment',
      'paid_confirmed',
      'in_fulfilment',
      'fulfilled',
      'closed_lost',
      'cancelled'
    )
  ),
  constraint deals_total_nonneg check (total_amount >= 0)
);

create index if not exists deals_stage_idx on public.deals (stage, updated_at desc);
create index if not exists deals_owner_idx on public.deals (owner_profile_id, stage);
create index if not exists deals_account_idx on public.deals (account_id, updated_at desc);
create index if not exists deals_race_idx on public.deals (race_id) where race_id is not null;

alter table public.deals enable row level security;

drop policy if exists "deals_staff_all" on public.deals;
create policy "deals_staff_all"
  on public.deals for all
  using (public.is_cms_staff())
  with check (public.is_cms_staff());

create table if not exists public.deal_line_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  package_id text not null references public.packages (id) on delete restrict,
  quantity int not null,
  unit_sale_price numeric not null,
  currency text not null default 'USD',
  supplier_id uuid references public.suppliers (id) on delete set null,
  expected_unit_cost numeric,
  discount_reason text,
  reservation_id uuid references public.inventory_reservations (id) on delete set null,
  reservation_status text not null default 'none',
  sort_order int not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint deal_line_items_qty_pos check (quantity > 0),
  constraint deal_line_items_price_nonneg check (unit_sale_price >= 0),
  constraint deal_line_items_reservation_status_check check (
    reservation_status in ('none', 'active', 'released', 'converted', 'expired', 'cancelled')
  )
);

create index if not exists deal_line_items_deal_idx
  on public.deal_line_items (deal_id, sort_order);

create index if not exists deal_line_items_package_idx
  on public.deal_line_items (package_id);

alter table public.deal_line_items enable row level security;

drop policy if exists "deal_line_items_staff_all" on public.deal_line_items;
create policy "deal_line_items_staff_all"
  on public.deal_line_items for all
  using (public.is_cms_staff())
  with check (public.is_cms_staff());

create table if not exists public.deal_activities (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  action text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint deal_activities_action_nonempty check (btrim(action) <> ''),
  constraint deal_activities_summary_nonempty check (btrim(summary) <> '')
);

create index if not exists deal_activities_deal_idx
  on public.deal_activities (deal_id, created_at desc);

alter table public.deal_activities enable row level security;

drop policy if exists "deal_activities_staff_all" on public.deal_activities;
create policy "deal_activities_staff_all"
  on public.deal_activities for all
  using (public.is_cms_staff())
  with check (public.is_cms_staff());

-- Link prior reservation/shortage deal_id columns now that deals exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_reservations_deal_fk'
  ) then
    alter table public.inventory_reservations
      add constraint inventory_reservations_deal_fk
      foreign key (deal_id) references public.deals (id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sourcing_shortages_deal_fk'
  ) then
    alter table public.sourcing_shortages
      add constraint sourcing_shortages_deal_fk
      foreign key (deal_id) references public.deals (id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Ensure/create account by company name
-- ---------------------------------------------------------------------------
create or replace function public.admin_ensure_crm_account(
  p_name text,
  p_account_type text default 'agent_company',
  p_email text default null,
  p_phone text default null,
  p_portal_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_id uuid;
begin
  if not public.has_cms_permission('accounts.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_name := nullif(btrim(p_name), '');
  if v_name is null then
    raise exception 'account_name_required';
  end if;

  select id into v_id
  from public.crm_accounts
  where lower(btrim(name)) = lower(v_name)
  limit 1;

  if v_id is not null then
    update public.crm_accounts
    set email = coalesce(nullif(btrim(p_email), ''), email),
        phone = coalesce(nullif(btrim(p_phone), ''), phone),
        portal_profile_id = coalesce(p_portal_profile_id, portal_profile_id),
        account_type = coalesce(nullif(btrim(p_account_type), ''), account_type),
        updated_at = timezone('utc', now())
    where id = v_id;
    return v_id;
  end if;

  insert into public.crm_accounts (
    name, account_type, email, phone, portal_profile_id, owner_profile_id, created_by
  ) values (
    v_name,
    coalesce(nullif(btrim(p_account_type), ''), 'agent_company'),
    nullif(btrim(p_email), ''),
    nullif(btrim(p_phone), ''),
    p_portal_profile_id,
    auth.uid(),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_ensure_crm_account(text, text, text, text, uuid) from public;
grant execute on function public.admin_ensure_crm_account(text, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Create deal + line item + optional reservation (booking-form hold starts later)
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_deal_with_line(
  p_account_name text,
  p_contact_name text default null,
  p_contact_email text default null,
  p_package_id text default null,
  p_quantity int default 1,
  p_unit_sale_price numeric default null,
  p_source text default 'offline',
  p_stage text default 'draft',
  p_notes text default null,
  p_reserve boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_contact_id uuid;
  v_deal_id uuid;
  v_line_id uuid;
  v_package record;
  v_qty int;
  v_price numeric;
  v_ref text;
  v_reservation_id uuid;
  v_available int;
  v_held int;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_account_id := public.admin_ensure_crm_account(p_account_name, 'agent_company', p_contact_email, null, null);

  if nullif(btrim(p_contact_name), '') is not null then
    insert into public.crm_contacts (
      account_id, full_name, email, is_primary, created_by
    ) values (
      v_account_id,
      btrim(p_contact_name),
      nullif(btrim(p_contact_email), ''),
      true,
      auth.uid()
    )
    returning id into v_contact_id;
  end if;

  if p_package_id is not null then
    select p.id, p.race_id, p.trade_price, p.currency, p.inventory_pool_id, p.name
    into v_package
    from public.packages p
    where p.id = btrim(p_package_id)
      and p.shell_parent_package_id is null;

    if v_package.id is null then
      raise exception 'package_not_found';
    end if;
  end if;

  v_qty := greatest(1, coalesce(p_quantity, 1));
  v_price := coalesce(p_unit_sale_price, v_package.trade_price, 0);
  if v_price < 0 then
    raise exception 'invalid_price';
  end if;

  v_ref := 'D-' || to_char(timezone('utc', now()), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

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
    created_by
  ) values (
    v_ref,
    v_account_id,
    v_contact_id,
    auth.uid(),
    v_package.race_id,
    coalesce(nullif(btrim(p_source), ''), 'offline'),
    coalesce(nullif(btrim(p_stage), ''), 'draft'),
    coalesce(v_package.currency, 'USD'),
    case when v_package.id is null then 0 else v_price * v_qty end,
    nullif(btrim(p_notes), ''),
    auth.uid()
  )
  returning id into v_deal_id;

  if v_package.id is not null then
    insert into public.deal_line_items (
      deal_id, package_id, quantity, unit_sale_price, currency, reservation_status
    ) values (
      v_deal_id, v_package.id, v_qty, v_price, coalesce(v_package.currency, 'USD'), 'none'
    )
    returning id into v_line_id;

    if coalesce(p_reserve, false) then
      select coalesce(qty_available, 0), coalesce(qty_held, 0)
      into v_available, v_held
      from public.package_inventory
      where package_id = v_package.id
      for update;

      if not found then
        raise exception 'inventory_missing';
      end if;

      if (v_available - v_held) < v_qty then
        raise exception 'insufficient_stock';
      end if;

      update public.package_inventory
      set qty_held = v_held + v_qty
      where package_id = v_package.id;

      insert into public.inventory_reservations (
        package_id,
        pool_id,
        kind,
        quantity,
        status,
        deal_id,
        expires_at,
        created_by,
        note
      ) values (
        v_package.id,
        v_package.inventory_pool_id,
        'deal_reservation',
        v_qty,
        'active',
        v_deal_id,
        timezone('utc', now()) + interval '7 days',
        auth.uid(),
        'Reserved with deal creation'
      )
      returning id into v_reservation_id;

      update public.deal_line_items
      set reservation_id = v_reservation_id,
          reservation_status = 'active',
          updated_at = timezone('utc', now())
      where id = v_line_id;

      update public.deals
      set hold_expires_at = timezone('utc', now()) + interval '7 days',
          stage = case when stage = 'draft' then 'proposal' else stage end,
          updated_at = timezone('utc', now())
      where id = v_deal_id;

      perform public.admin_append_inventory_ledger(
        v_package.id,
        'reservation',
        -v_qty,
        'Deal reservation created',
        null,
        v_package.inventory_pool_id,
        'inventory_reservations',
        v_reservation_id::text,
        null,
        null,
        null,
        v_reservation_id,
        v_deal_id,
        jsonb_build_object('deal_reference', v_ref)
      );
    end if;
  end if;

  insert into public.deal_activities (deal_id, actor_profile_id, action, summary, metadata)
  values (
    v_deal_id,
    auth.uid(),
    'deal_created',
    'Deal created',
    jsonb_build_object(
      'reference', v_ref,
      'package_id', v_package.id,
      'quantity', v_qty,
      'reserved', coalesce(p_reserve, false)
    )
  );

  return v_deal_id;
end;
$$;

revoke all on function public.admin_create_deal_with_line(
  text, text, text, text, int, numeric, text, text, text, boolean
) from public;
grant execute on function public.admin_create_deal_with_line(
  text, text, text, text, int, numeric, text, text, text, boolean
) to authenticated;

-- Allow sales staff to append reservation ledger rows while keeping other
-- inventory mutations admin-gated in their existing RPCs.
create or replace function public.admin_append_inventory_ledger(
  p_package_id text,
  p_entry_type text,
  p_quantity_delta int,
  p_reason text,
  p_quantity_absolute int default null,
  p_pool_id uuid default null,
  p_source_table text default null,
  p_source_id text default null,
  p_cost_layer_id uuid default null,
  p_purchase_order_id uuid default null,
  p_supplier_id uuid default null,
  p_reservation_id uuid default null,
  p_deal_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_pkg text;
begin
  if not public.is_admin() then
    if not (
      public.has_cms_permission('deals.manage')
      and p_entry_type in ('reservation', 'reservation_release')
    ) then
      raise exception 'forbidden';
    end if;
  end if;

  v_pkg := nullif(btrim(p_package_id), '');
  if v_pkg is null then
    raise exception 'package_id_required';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'reason_required';
  end if;
  if p_entry_type is null or btrim(p_entry_type) = '' then
    raise exception 'entry_type_required';
  end if;

  if p_source_table is not null and p_source_id is not null then
    select id into v_id
    from public.inventory_ledger_entries
    where source_table = p_source_table
      and source_id = p_source_id
      and entry_type = p_entry_type
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.inventory_ledger_entries (
    package_id,
    pool_id,
    entry_type,
    quantity_delta,
    quantity_absolute,
    reason,
    created_by,
    source_table,
    source_id,
    cost_layer_id,
    purchase_order_id,
    supplier_id,
    reservation_id,
    deal_id,
    metadata
  ) values (
    v_pkg,
    p_pool_id,
    p_entry_type,
    coalesce(p_quantity_delta, 0),
    p_quantity_absolute,
    btrim(p_reason),
    auth.uid(),
    nullif(btrim(p_source_table), ''),
    nullif(btrim(p_source_id), ''),
    p_cost_layer_id,
    p_purchase_order_id,
    p_supplier_id,
    p_reservation_id,
    p_deal_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Backfill CRM accounts from approved agent profiles (non-destructive).
insert into public.crm_accounts (
  name, account_type, email, phone, portal_profile_id, owner_profile_id, created_at, updated_at
)
select distinct on (lower(btrim(coalesce(nullif(p.company_name, ''), p.full_name, p.email))))
  coalesce(nullif(btrim(p.company_name), ''), nullif(btrim(p.full_name), ''), p.email) as name,
  'agent_company',
  p.email,
  p.mobile,
  p.id,
  null,
  timezone('utc', now()),
  timezone('utc', now())
from public.profiles p
where p.role = 'agent'
  and p.approval_status = 'approved'
  and coalesce(nullif(btrim(p.company_name), ''), nullif(btrim(p.full_name), ''), p.email) is not null
  and not exists (
    select 1
    from public.crm_accounts a
    where lower(btrim(a.name)) = lower(btrim(coalesce(nullif(p.company_name, ''), p.full_name, p.email)))
  )
order by lower(btrim(coalesce(nullif(p.company_name, ''), p.full_name, p.email))), p.created_at;

comment on table public.deals is
  'Native CRM deals replacing Salesforce opportunities for offline/native sales.';
comment on table public.crm_accounts is
  'Native CRM accounts (agent companies / clients).';

-- Staff read access for reservation/shortage rows tied to deals.
drop policy if exists "inventory_reservations_staff_select" on public.inventory_reservations;
create policy "inventory_reservations_staff_select"
  on public.inventory_reservations for select
  using (public.is_cms_staff());

drop policy if exists "sourcing_shortages_staff_select" on public.sourcing_shortages;
create policy "sourcing_shortages_staff_select"
  on public.sourcing_shortages for select
  using (public.is_cms_staff());

drop policy if exists "inventory_ledger_entries_staff_select" on public.inventory_ledger_entries;
create policy "inventory_ledger_entries_staff_select"
  on public.inventory_ledger_entries for select
  using (public.is_cms_staff());

-- Ensure finance/sales can read catalog and inventory without being trade agents.
drop policy if exists "races_select_cms_staff" on public.races;
create policy "races_select_cms_staff"
  on public.races for select
  using (public.is_cms_staff());

drop policy if exists "packages_select_cms_staff" on public.packages;
create policy "packages_select_cms_staff"
  on public.packages for select
  using (public.is_cms_staff());

drop policy if exists "package_inventory_select_cms_staff" on public.package_inventory;
create policy "package_inventory_select_cms_staff"
  on public.package_inventory for select
  using (public.is_cms_staff());

drop policy if exists "suppliers_select_cms_staff" on public.suppliers;
create policy "suppliers_select_cms_staff"
  on public.suppliers for select
  using (public.is_cms_staff());
