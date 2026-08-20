-- Phase 2D: native sales, finance, guest-detail, supplier and delivery workspace.

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
            'cms.access', 'finance.view', 'finance.manage', 'orders.view',
            'deals.view', 'inventory.view', 'operations.view'
          )
        )
        or (
          p.role = 'sales'
          and p_permission in (
            'cms.access', 'deals.view', 'deals.manage', 'accounts.manage',
            'inventory.view', 'inventory.hold', 'orders.view',
            'operations.view', 'operations.manage'
          )
        )
      )
  );
$$;

grant execute on function public.has_cms_permission(text) to authenticated, anon;

alter table public.invoices
  add column if not exists xero_amount_due numeric,
  add column if not exists xero_amount_paid numeric,
  add column if not exists xero_total numeric,
  add column if not exists paid_at timestamptz;

update public.invoices
set paid_at = coalesce(xero_synced_at, issued_at, created_at)
where status in ('paid', 'delivered') and paid_at is null;

drop policy if exists "suppliers_cms_select" on public.suppliers;
create policy "suppliers_cms_select"
  on public.suppliers for select
  using (public.has_cms_permission('operations.view') or public.is_admin());

create table if not exists public.order_operations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  fulfilment_status text not null default 'awaiting_payment',
  guest_details_status text not null default 'not_requested',
  communication_status text not null default 'not_started',
  supplier_status text not null default 'unassigned',
  delivery_status text not null default 'not_ready',
  owner_profile_id uuid references public.profiles(id) on delete set null,
  guest_details_due_at timestamptz,
  supplier_due_at timestamptz,
  delivery_due_at timestamptz,
  internal_notes text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint order_operations_fulfilment_status_check check (
    fulfilment_status in (
      'awaiting_payment', 'confirmed', 'in_progress', 'ready',
      'delivered', 'cancelled', 'issue'
    )
  ),
  constraint order_operations_guest_details_status_check check (
    guest_details_status in (
      'not_requested', 'requested', 'partial', 'complete', 'not_required'
    )
  ),
  constraint order_operations_communication_status_check check (
    communication_status in (
      'not_started', 'booking_confirmation_sent', 'guest_request_sent',
      'received', 'final_information_sent'
    )
  ),
  constraint order_operations_supplier_status_check check (
    supplier_status in (
      'unassigned', 'pending', 'confirmed', 'tickets_received',
      'issue', 'not_required'
    )
  ),
  constraint order_operations_delivery_status_check check (
    delivery_status in ('not_ready', 'ready', 'sent', 'confirmed', 'not_required')
  )
);

create index if not exists order_operations_work_queue_idx
  on public.order_operations (
    fulfilment_status, guest_details_status, supplier_status, delivery_status
  );
create index if not exists order_operations_owner_idx
  on public.order_operations (owner_profile_id, updated_at desc);

alter table public.order_operations enable row level security;
create policy "order_operations_cms_select"
  on public.order_operations for select
  using (public.has_cms_permission('operations.view'));

create table if not exists public.order_guests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  nationality text,
  date_of_birth date,
  dietary_requirements text,
  special_requests text,
  is_lead_guest boolean not null default false,
  details_complete boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists order_guests_order_idx
  on public.order_guests (order_id, sort_order, created_at);
alter table public.order_guests enable row level security;
create policy "order_guests_cms_select"
  on public.order_guests for select
  using (public.has_cms_permission('operations.view'));

create table if not exists public.order_supplier_fulfilments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_line_item_id uuid references public.order_line_items(id) on delete set null,
  package_id text not null references public.packages(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete set null,
  quantity int not null check (quantity > 0),
  status text not null default 'pending',
  supplier_reference text,
  expected_at timestamptz,
  confirmed_at timestamptz,
  tickets_received_at timestamptz,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint order_supplier_fulfilments_status_check check (
    status in ('pending', 'ordered', 'confirmed', 'tickets_received', 'cancelled', 'issue')
  )
);

create index if not exists order_supplier_fulfilments_order_idx
  on public.order_supplier_fulfilments (order_id, status);
create unique index if not exists order_supplier_fulfilments_line_supplier_unique_idx
  on public.order_supplier_fulfilments (
    order_id, coalesce(order_line_item_id::text, package_id), coalesce(supplier_id::text, '')
  );
alter table public.order_supplier_fulfilments enable row level security;
create policy "order_supplier_fulfilments_cms_select"
  on public.order_supplier_fulfilments for select
  using (public.has_cms_permission('operations.view'));

insert into public.order_supplier_fulfilments (
  order_id, order_line_item_id, package_id, supplier_id, quantity, status, notes
)
select
  occ.order_id,
  oli.id,
  occ.package_id,
  pcl.supplier_id,
  sum(occ.quantity)::int,
  'confirmed',
  'Backfilled from committed cost-layer allocation'
from public.order_cost_consumptions occ
left join public.package_cost_layers pcl on pcl.id = occ.cost_layer_id
left join public.order_line_items oli
  on oli.order_id = occ.order_id and oli.package_id = occ.package_id
where occ.cost_layer_id is not null
group by occ.order_id, oli.id, occ.package_id, pcl.supplier_id
on conflict do nothing;

create table if not exists public.order_operation_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint order_operation_events_summary_nonempty check (btrim(summary) <> '')
);

create index if not exists order_operation_events_order_idx
  on public.order_operation_events (order_id, created_at desc);
alter table public.order_operation_events enable row level security;
create policy "order_operation_events_cms_select"
  on public.order_operation_events for select
  using (public.has_cms_permission('operations.view'));

insert into public.order_operations (
  order_id, fulfilment_status, guest_details_status, communication_status,
  supplier_status, delivery_status
)
select
  o.id,
  case
    when o.status = 'cancelled' then 'cancelled'
    when i.status = 'delivered' then 'delivered'
    when i.status = 'paid' then 'confirmed'
    else 'awaiting_payment'
  end,
  case
    when o.status = 'cancelled' then 'not_required'
    when coalesce(nullif(btrim(o.client_name), ''), '') <> '' then 'partial'
    else 'not_requested'
  end,
  'not_started',
  case
    when o.status = 'cancelled' then 'not_required'
    when exists (
      select 1 from public.order_cost_consumptions occ
      where occ.order_id = o.id and occ.cost_layer_id is not null
    ) then 'confirmed'
    else 'unassigned'
  end,
  case when o.status = 'cancelled' then 'not_required' else 'not_ready' end
from public.orders o
left join public.invoices i on i.order_id = o.id
on conflict (order_id) do nothing;

create or replace function public.seed_order_operations()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.order_operations (order_id)
  values (new.id)
  on conflict (order_id) do nothing;
  return new;
end;
$$;

drop trigger if exists orders_seed_operations_trg on public.orders;
create trigger orders_seed_operations_trg
after insert on public.orders
for each row execute function public.seed_order_operations();

create or replace function public.sync_paid_invoice_to_operations()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_operations (order_id, fulfilment_status)
    values (
      new.order_id,
      case
        when new.status = 'delivered' then 'delivered'
        when new.status = 'paid' then 'confirmed'
        when new.status = 'cancelled' then 'cancelled'
        else 'awaiting_payment'
      end
    )
    on conflict (order_id) do update
      set fulfilment_status = case
            when excluded.fulfilment_status in ('confirmed', 'delivered', 'cancelled')
              then excluded.fulfilment_status
            else public.order_operations.fulfilment_status
          end,
          updated_at = timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_sync_order_operations_trg on public.invoices;
create trigger invoices_sync_order_operations_trg
after update of status on public.invoices
for each row execute function public.sync_paid_invoice_to_operations();

create or replace function public.admin_update_order_operations(
  p_order_id uuid,
  p_fulfilment_status text default null,
  p_guest_details_status text default null,
  p_communication_status text default null,
  p_supplier_status text default null,
  p_delivery_status text default null,
  p_owner_profile_id uuid default null,
  p_guest_details_due_at timestamptz default null,
  p_supplier_due_at timestamptz default null,
  p_delivery_due_at timestamptz default null,
  p_internal_notes text default null
)
returns public.order_operations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.order_operations%rowtype;
begin
  if not public.has_cms_permission('operations.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order_not_found';
  end if;

  insert into public.order_operations (order_id)
  values (p_order_id)
  on conflict (order_id) do nothing;

  update public.order_operations
  set fulfilment_status = coalesce(p_fulfilment_status, fulfilment_status),
      guest_details_status = coalesce(p_guest_details_status, guest_details_status),
      communication_status = coalesce(p_communication_status, communication_status),
      supplier_status = coalesce(p_supplier_status, supplier_status),
      delivery_status = coalesce(p_delivery_status, delivery_status),
      owner_profile_id = coalesce(p_owner_profile_id, owner_profile_id),
      guest_details_due_at = coalesce(p_guest_details_due_at, guest_details_due_at),
      supplier_due_at = coalesce(p_supplier_due_at, supplier_due_at),
      delivery_due_at = coalesce(p_delivery_due_at, delivery_due_at),
      internal_notes = case
        when p_internal_notes is null then internal_notes
        else nullif(btrim(p_internal_notes), '')
      end,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where order_id = p_order_id
  returning * into v_row;

  insert into public.order_operation_events (
    order_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_order_id, 'workflow_updated', auth.uid(), 'Updated operations workflow',
    jsonb_build_object(
      'fulfilment_status', v_row.fulfilment_status,
      'guest_details_status', v_row.guest_details_status,
      'communication_status', v_row.communication_status,
      'supplier_status', v_row.supplier_status,
      'delivery_status', v_row.delivery_status
    )
  );
  return v_row;
end;
$$;

revoke all on function public.admin_update_order_operations(
  uuid, text, text, text, text, text, uuid, timestamptz, timestamptz, timestamptz, text
) from public;
grant execute on function public.admin_update_order_operations(
  uuid, text, text, text, text, text, uuid, timestamptz, timestamptz, timestamptz, text
) to authenticated;

create or replace function public.admin_save_order_guest(
  p_order_id uuid,
  p_guest_id uuid default null,
  p_full_name text default null,
  p_email text default null,
  p_phone text default null,
  p_nationality text default null,
  p_date_of_birth date default null,
  p_dietary_requirements text default null,
  p_special_requests text default null,
  p_is_lead_guest boolean default false,
  p_details_complete boolean default false,
  p_sort_order int default 0
)
returns public.order_guests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.order_guests%rowtype;
  v_expected int;
  v_complete int;
  v_total int;
begin
  if not public.has_cms_permission('operations.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select guests into v_expected from public.orders where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;

  if p_guest_id is null then
    insert into public.order_guests (
      order_id, full_name, email, phone, nationality, date_of_birth,
      dietary_requirements, special_requests, is_lead_guest,
      details_complete, sort_order
    ) values (
      p_order_id, nullif(btrim(p_full_name), ''), nullif(lower(btrim(p_email)), ''),
      nullif(btrim(p_phone), ''), nullif(btrim(p_nationality), ''), p_date_of_birth,
      nullif(btrim(p_dietary_requirements), ''), nullif(btrim(p_special_requests), ''),
      coalesce(p_is_lead_guest, false), coalesce(p_details_complete, false),
      greatest(0, coalesce(p_sort_order, 0))
    )
    returning * into v_guest;
  else
    update public.order_guests
    set full_name = nullif(btrim(p_full_name), ''),
        email = nullif(lower(btrim(p_email)), ''),
        phone = nullif(btrim(p_phone), ''),
        nationality = nullif(btrim(p_nationality), ''),
        date_of_birth = p_date_of_birth,
        dietary_requirements = nullif(btrim(p_dietary_requirements), ''),
        special_requests = nullif(btrim(p_special_requests), ''),
        is_lead_guest = coalesce(p_is_lead_guest, false),
        details_complete = coalesce(p_details_complete, false),
        sort_order = greatest(0, coalesce(p_sort_order, 0)),
        updated_at = timezone('utc', now())
    where id = p_guest_id and order_id = p_order_id
    returning * into v_guest;
    if v_guest.id is null then raise exception 'guest_not_found'; end if;
  end if;

  select count(*), count(*) filter (where details_complete)
  into v_total, v_complete
  from public.order_guests
  where order_id = p_order_id;
  update public.order_operations
  set guest_details_status = case
        when v_expected > 0 and v_total >= v_expected and v_complete >= v_expected then 'complete'
        when v_total > 0 then 'partial'
        else 'not_requested'
      end,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where order_id = p_order_id;
  insert into public.order_operation_events (
    order_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_order_id, 'guest_saved', auth.uid(), 'Saved guest details',
    jsonb_build_object('guest_id', v_guest.id, 'details_complete', v_guest.details_complete)
  );
  return v_guest;
end;
$$;

revoke all on function public.admin_save_order_guest(
  uuid, uuid, text, text, text, text, date, text, text, boolean, boolean, int
) from public;
grant execute on function public.admin_save_order_guest(
  uuid, uuid, text, text, text, text, date, text, text, boolean, boolean, int
) to authenticated;

create or replace function public.admin_delete_order_guest(p_order_id uuid, p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_cms_permission('operations.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  delete from public.order_guests where id = p_guest_id and order_id = p_order_id;
  update public.order_operations
  set guest_details_status = case
        when exists (select 1 from public.order_guests where order_id = p_order_id)
          then 'partial'
        else 'not_requested'
      end,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where order_id = p_order_id;
  insert into public.order_operation_events (
    order_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_order_id, 'guest_deleted', auth.uid(), 'Removed guest details',
    jsonb_build_object('guest_id', p_guest_id)
  );
end;
$$;

revoke all on function public.admin_delete_order_guest(uuid, uuid) from public;
grant execute on function public.admin_delete_order_guest(uuid, uuid) to authenticated;

