-- Per-package Salesforce Product2 Family (Package vs Single Ticket).

alter table public.packages
  add column if not exists salesforce_product_family text;

comment on column public.packages.salesforce_product_family is
  'Salesforce Product2.Family for this package (e.g. Package, Single Ticket). Falls back to SALESFORCE_PRODUCT_FAMILY env when null.';
