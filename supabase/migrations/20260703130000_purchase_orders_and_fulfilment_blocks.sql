-- Purchase Orders + Fulfilment Blocks
--
-- Adds tracking of the actual purchase order + supplier + fulfilment block
-- behind each stock (cost) layer, so:
--   * we can attach contracts / invoices to a purchase and share them with
--     Salesforce for audit,
--   * Salesforce can show live per-supplier / per-block stock via a child
--     Stock_Source__c object, and
--   * ops can keep guests grouped in one physical block when fulfilling orders.
--
-- Both new relations on package_cost_layers are OPTIONAL — legacy cost layers
-- keep working unchanged. When no PO is linked, the layer still carries the
-- free-text `source` field (already in use).

-- ---------------------------------------------------------------------------
-- purchase_orders — the actual purchase we made (one PO can cover many
-- packages).
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null,
  supplier text not null,
  issued_at date,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists purchase_orders_po_number_idx
  on public.purchase_orders (lower(btrim(po_number)));

create index if not exists purchase_orders_supplier_idx
  on public.purchase_orders (lower(supplier));

create index if not exists purchase_orders_created_at_idx
  on public.purchase_orders (created_at desc);

alter table public.purchase_orders enable row level security;

drop policy if exists "purchase_orders_admin_all" on public.purchase_orders;
create policy "purchase_orders_admin_all"
  on public.purchase_orders for all
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.purchase_orders is
  'Stock purchases (contracts / POs). A single PO can cover multiple packages. Cost layers reference the PO and inherit its supplier / documents.';

-- ---------------------------------------------------------------------------
-- purchase_order_documents — attached invoices / signed contracts.
-- Storage bucket is private; downloads go via signed URLs from server actions.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('purchase-order-documents', 'purchase-order-documents', false)
on conflict (id) do nothing;

create table if not exists public.purchase_order_documents (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  file_bucket text not null default 'purchase-order-documents',
  file_path text not null,
  file_name text not null,
  file_content_type text,
  file_size int,
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index if not exists purchase_order_documents_po_idx
  on public.purchase_order_documents (purchase_order_id, uploaded_at desc);

alter table public.purchase_order_documents enable row level security;

drop policy if exists "purchase_order_documents_admin_all" on public.purchase_order_documents;
create policy "purchase_order_documents_admin_all"
  on public.purchase_order_documents for all
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.purchase_order_documents is
  'Attachments (signed contracts, invoices) for a purchase order. Storage: private bucket "purchase-order-documents"; downloads go through server actions.';

-- ---------------------------------------------------------------------------
-- fulfilment_blocks — a physical / logical "block" of seats or a suite that
-- ops needs to keep together when fulfilling an order (e.g. "Paddock Suite A").
-- Blocks are per-package and completely optional.
-- ---------------------------------------------------------------------------
create table if not exists public.fulfilment_blocks (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.packages (id) on delete cascade,
  name text not null,
  location_note text,
  salesforce_block_ref text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fulfilment_blocks_package_name_idx
  on public.fulfilment_blocks (package_id, lower(btrim(name)));

create index if not exists fulfilment_blocks_package_idx
  on public.fulfilment_blocks (package_id, created_at desc);

alter table public.fulfilment_blocks enable row level security;

drop policy if exists "fulfilment_blocks_admin_all" on public.fulfilment_blocks;
create policy "fulfilment_blocks_admin_all"
  on public.fulfilment_blocks for all
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.fulfilment_blocks is
  'Optional physical / logical fulfilment groupings for a package (e.g. Paddock Suite A). Ops uses these to keep multi-guest orders together.';

-- ---------------------------------------------------------------------------
-- Link cost layers to a PO and (optionally) a block.
-- Both are nullable so existing layers stay untouched.
-- ---------------------------------------------------------------------------
alter table public.package_cost_layers
  add column if not exists purchase_order_id uuid references public.purchase_orders (id) on delete set null;

alter table public.package_cost_layers
  add column if not exists fulfilment_block_id uuid references public.fulfilment_blocks (id) on delete set null;

create index if not exists package_cost_layers_purchase_order_idx
  on public.package_cost_layers (purchase_order_id)
  where purchase_order_id is not null;

create index if not exists package_cost_layers_fulfilment_block_idx
  on public.package_cost_layers (fulfilment_block_id)
  where fulfilment_block_id is not null;

-- ---------------------------------------------------------------------------
-- Consumption snapshots: record which fulfilment block an order was
-- allocated from at the time of allocation (survives later block renames /
-- deletes and lets ops look up "who is in Suite A?").
-- ---------------------------------------------------------------------------
alter table public.order_cost_consumptions
  add column if not exists fulfilment_block_snapshot text;

comment on column public.order_cost_consumptions.fulfilment_block_snapshot is
  'Snapshot of the fulfilment block name at allocation time. NULL when the layer was not assigned to a block.';
