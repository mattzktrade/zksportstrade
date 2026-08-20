-- Store end-client / fulfilment details on the deal before an order exists.
alter table public.deals
  add column if not exists fulfilment_details jsonb;

comment on column public.deals.fulfilment_details is
  'End-client fulfilment details (name, contact, dietary, addresses) used before an order is created.';
