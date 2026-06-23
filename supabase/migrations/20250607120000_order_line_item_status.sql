-- Track the Salesforce Opportunity line item independently of the Opportunity itself.
-- A chained DLRS rollup on Product2 can reject the line-item insert even though the
-- Opportunity was created successfully. We keep the Opportunity and flag the line item
-- so it can be retried (idempotently) once the Salesforce rollup is fixed.

alter table public.orders
  add column if not exists salesforce_line_item_status text;

alter table public.orders
  drop constraint if exists orders_salesforce_line_item_status_check;

alter table public.orders
  add constraint orders_salesforce_line_item_status_check
  check (
    salesforce_line_item_status is null
    or salesforce_line_item_status in ('pending', 'synced', 'failed', 'skipped')
  );

create index if not exists orders_salesforce_line_item_status_idx
  on public.orders (salesforce_line_item_status);
