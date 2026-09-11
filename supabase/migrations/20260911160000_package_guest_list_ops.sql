-- Product guest list: per-guest ticket/table/tour fields, plus booking delivery
-- and supplier-name-sheet tracking for operations.

alter table public.order_guests
  add column if not exists table_number text,
  add column if not exists ticket_number text,
  add column if not exists paddock_tour text,
  add column if not exists ticket_status text not null default 'pending';

alter table public.deal_guests
  add column if not exists table_number text,
  add column if not exists ticket_number text,
  add column if not exists paddock_tour text,
  add column if not exists ticket_status text not null default 'pending';

alter table public.order_guests
  drop constraint if exists order_guests_ticket_status_check;
alter table public.order_guests
  add constraint order_guests_ticket_status_check
  check (ticket_status in ('pending', 'issued', 'posted'));

alter table public.deal_guests
  drop constraint if exists deal_guests_ticket_status_check;
alter table public.deal_guests
  add constraint deal_guests_ticket_status_check
  check (ticket_status in ('pending', 'issued', 'posted'));

comment on column public.order_guests.ticket_status is
  'Whether this guest has been issued their ticket: pending, issued, or posted.';
comment on column public.deal_guests.ticket_status is
  'Whether this guest has been issued their ticket: pending, issued, or posted.';
comment on column public.order_guests.paddock_tour is
  'Manually assigned paddock tour time or slot label. Not auto-assigned.';
comment on column public.deal_guests.paddock_tour is
  'Manually assigned paddock tour time or slot label. Not auto-assigned.';

alter table public.order_operations
  add column if not exists delivery_method text,
  add column if not exists collection_point text,
  add column if not exists collection_time text,
  add column if not exists contact_on_site text,
  add column if not exists supplier_details_sent_at timestamptz;

alter table public.deal_operations
  add column if not exists internal_notes text,
  add column if not exists delivery_method text,
  add column if not exists collection_point text,
  add column if not exists collection_time text,
  add column if not exists contact_on_site text,
  add column if not exists supplier_details_sent_at timestamptz;

comment on column public.order_operations.supplier_details_sent_at is
  'When guest names and headshots were sent to the supplier.';
comment on column public.deal_operations.supplier_details_sent_at is
  'When guest names and headshots were sent to the supplier.';
