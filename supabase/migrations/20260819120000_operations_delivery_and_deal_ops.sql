-- Allow a simple ticket handoff status on operations rows, and persist
-- guest/delivery status for imported deals that do not yet have a native order.

alter table public.order_operations
  drop constraint if exists order_operations_delivery_status_check;

alter table public.order_operations
  add constraint order_operations_delivery_status_check check (
    delivery_status in ('not_ready', 'ready', 'delivered', 'sent', 'confirmed', 'not_required')
  );

update public.order_operations
set delivery_status = 'delivered', updated_at = timezone('utc', now())
where delivery_status in ('sent', 'confirmed');

create table if not exists public.deal_operations (
  deal_id uuid primary key references public.deals (id) on delete cascade,
  fulfilment_status text not null default 'confirmed',
  guest_details_status text not null default 'not_requested',
  communication_status text not null default 'not_started',
  supplier_status text not null default 'unassigned',
  delivery_status text not null default 'not_ready',
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint deal_operations_fulfilment_status_check check (
    fulfilment_status in (
      'awaiting_payment', 'confirmed', 'in_progress', 'ready',
      'delivered', 'cancelled', 'issue'
    )
  ),
  constraint deal_operations_guest_details_status_check check (
    guest_details_status in (
      'not_requested', 'requested', 'partial', 'complete', 'not_required'
    )
  ),
  constraint deal_operations_communication_status_check check (
    communication_status in (
      'not_started', 'booking_confirmation_sent', 'guest_request_sent',
      'received', 'final_information_sent'
    )
  ),
  constraint deal_operations_supplier_status_check check (
    supplier_status in (
      'unassigned', 'pending', 'confirmed', 'tickets_received',
      'issue', 'not_required'
    )
  ),
  constraint deal_operations_delivery_status_check check (
    delivery_status in ('not_ready', 'ready', 'delivered', 'sent', 'confirmed', 'not_required')
  )
);

create index if not exists deal_operations_work_queue_idx
  on public.deal_operations (guest_details_status, delivery_status);

alter table public.deal_operations enable row level security;

drop policy if exists "deal_operations_cms_select" on public.deal_operations;
create policy "deal_operations_cms_select"
  on public.deal_operations for select
  using (public.has_cms_permission('operations.view'));
