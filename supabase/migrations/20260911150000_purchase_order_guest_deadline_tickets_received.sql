-- Guest-details deadline and tickets-received date on purchase orders.
-- Deadline: when guest names and headshot photos must be sent to the supplier.
-- Tickets received: when the supplier delivered the tickets, if applicable.

alter table public.purchase_orders
  add column if not exists guest_details_deadline date;

alter table public.purchase_orders
  add column if not exists tickets_received_at date;

comment on column public.purchase_orders.guest_details_deadline is
  'Date guest names and headshot photos must be sent to the supplier.';

comment on column public.purchase_orders.tickets_received_at is
  'Date the supplier delivered the tickets, when applicable.';
