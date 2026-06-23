-- Track offline (non-portal) Closed Won opportunity line items applied to portal inventory.
-- Portal orders are skipped via orders.salesforce_opportunity_id; this prevents double application.

create table if not exists public.salesforce_offline_sale_applications (
  id uuid primary key default gen_random_uuid(),
  salesforce_opportunity_id text not null,
  salesforce_line_item_id text not null,
  salesforce_product2_id text not null,
  package_id text not null references public.packages(id) on delete cascade,
  quantity int not null check (quantity > 0),
  applied_at timestamptz not null default timezone('utc', now()),
  unique (salesforce_opportunity_id, salesforce_line_item_id)
);

create index if not exists salesforce_offline_sale_applications_opp_idx
  on public.salesforce_offline_sale_applications (salesforce_opportunity_id);

alter table public.salesforce_offline_sale_applications enable row level security;

revoke all on table public.salesforce_offline_sale_applications from public;
grant all on table public.salesforce_offline_sale_applications to service_role;

grant execute on function public.adjust_linked_inventory_available(text, int) to service_role;
grant execute on function public.reconcile_linked_multi_day_inventory(text) to service_role;
