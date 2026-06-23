-- PandaDoc sales flow, supplier allocation snapshots, and Salesforce package item links.

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('awaiting_signature', 'awaiting_invoice', 'awaiting_payment', 'paid', 'delivered'));

create table if not exists public.order_documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'pandadoc',
  document_id text,
  document_status text not null default 'pending',
  signing_url text,
  agent_signed_at timestamptz,
  completed_at timestamptz,
  pdf_attached_to_salesforce_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint order_documents_provider_check check (provider in ('pandadoc')),
  constraint order_documents_status_check check (
    document_status in ('pending', 'creating', 'sent', 'viewed', 'agent_signed', 'completed', 'failed', 'cancelled')
  ),
  constraint order_documents_order_provider_unique unique (order_id, provider),
  constraint order_documents_document_id_unique unique (document_id)
);

create index if not exists order_documents_order_idx on public.order_documents(order_id);
create index if not exists order_documents_document_idx on public.order_documents(document_id);
create index if not exists order_documents_status_idx on public.order_documents(document_status, created_at);

alter table public.order_documents enable row level security;

drop policy if exists "order_documents_admin_select" on public.order_documents;
create policy "order_documents_admin_select"
  on public.order_documents for select
  using (public.is_admin());

drop policy if exists "order_documents_agent_select" on public.order_documents;
create policy "order_documents_agent_select"
  on public.order_documents for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_documents.order_id
        and o.agent_profile_id = auth.uid()
    )
  );

drop policy if exists "order_documents_admin_insert" on public.order_documents;
create policy "order_documents_admin_insert"
  on public.order_documents for insert
  with check (public.is_admin());

drop policy if exists "order_documents_admin_update" on public.order_documents;
create policy "order_documents_admin_update"
  on public.order_documents for update
  using (public.is_admin())
  with check (public.is_admin());

alter table public.order_cost_consumptions
  add column if not exists supplier_source_snapshot text;

comment on column public.order_cost_consumptions.supplier_source_snapshot is
  'Immutable supplier/source copied from the cost layer at allocation time for admin operations reporting.';

update public.order_cost_consumptions occ
set supplier_source_snapshot = pcl.source
from public.package_cost_layers pcl
where occ.cost_layer_id = pcl.id
  and occ.supplier_source_snapshot is null
  and pcl.source is not null;

create or replace function public.set_order_cost_consumption_supplier_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.supplier_source_snapshot is null and new.cost_layer_id is not null then
    select source
    into new.supplier_source_snapshot
    from public.package_cost_layers
    where id = new.cost_layer_id;
  end if;
  return new;
end;
$$;

drop trigger if exists order_cost_consumptions_supplier_snapshot_trg on public.order_cost_consumptions;
create trigger order_cost_consumptions_supplier_snapshot_trg
before insert on public.order_cost_consumptions
for each row execute function public.set_order_cost_consumption_supplier_snapshot();

create table if not exists public.package_items (
  id uuid primary key default gen_random_uuid(),
  parent_package_id text not null references public.packages(id) on delete cascade,
  child_package_id text not null references public.packages(id) on delete cascade,
  quantity_per_parent int not null default 1 check (quantity_per_parent > 0),
  sort_order int not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint package_items_not_self check (parent_package_id <> child_package_id),
  constraint package_items_unique unique (parent_package_id, child_package_id)
);

create index if not exists package_items_parent_idx on public.package_items(parent_package_id, sort_order);
create index if not exists package_items_child_idx on public.package_items(child_package_id);

alter table public.package_items enable row level security;

drop policy if exists "package_items_admin_all" on public.package_items;
create policy "package_items_admin_all"
  on public.package_items for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "package_items_approved_select_visible" on public.package_items;
create policy "package_items_approved_select_visible"
  on public.package_items for select
  using (
    auth.uid() is not null
    and exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid()
        and pr.approval_status = 'approved'
    )
    and exists (
      select 1 from public.packages p
      where p.id = package_items.parent_package_id
        and not coalesce(p.is_hidden, false)
    )
  );
