-- Internal admin proof required before marking tickets delivered.

insert into storage.buckets (id, name, public)
values ('order-delivery-proofs', 'order-delivery-proofs', false)
on conflict (id) do nothing;

create table if not exists public.order_delivery_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  note text,
  file_bucket text not null default 'order-delivery-proofs',
  file_path text,
  file_name text,
  file_content_type text,
  file_size int,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_delivery_proofs_note_or_file_check
    check (nullif(btrim(coalesce(note, '')), '') is not null or file_path is not null)
);

create index if not exists order_delivery_proofs_order_idx
  on public.order_delivery_proofs (order_id, created_at desc);

create index if not exists order_delivery_proofs_invoice_idx
  on public.order_delivery_proofs (invoice_id, created_at desc);

alter table public.order_delivery_proofs enable row level security;

drop policy if exists "order_delivery_proofs_select_admin" on public.order_delivery_proofs;
create policy "order_delivery_proofs_select_admin"
  on public.order_delivery_proofs for select
  using (public.is_admin());

drop policy if exists "order_delivery_proofs_insert_admin" on public.order_delivery_proofs;
create policy "order_delivery_proofs_insert_admin"
  on public.order_delivery_proofs for insert
  with check (public.is_admin());

comment on table public.order_delivery_proofs is
  'Internal admin delivery evidence for orders marked delivered. Not shown to agents.';
