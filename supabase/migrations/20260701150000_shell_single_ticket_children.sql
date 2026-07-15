-- Hidden "shell" packages that represent Salesforce Single Ticket children of a 3-day Package.
--
-- Portal 3-day packages need three Single Ticket children in Salesforce (one per race day)
-- so opportunity lines break out each day for reporting. Shells are created hidden with no
-- value; when a real single-day product (e.g. "Sunday Paddock Club") is created later, it
-- links to the same underlying Salesforce Single Ticket.

alter table public.packages
  add column if not exists shell_parent_package_id text
    references public.packages (id) on delete cascade;

comment on column public.packages.shell_parent_package_id is
  'When set, this package is a hidden shell that represents a Salesforce Single Ticket child of the referenced parent (e.g. a 3-day Package). Shells carry no value and are excluded from portal listings.';

create index if not exists packages_shell_parent_package_id_idx
  on public.packages (shell_parent_package_id)
  where shell_parent_package_id is not null;

-- Shells must not participate in inventory-group cascades (they mirror their parent's stock
-- via the SF package-item link, not via the linked-inventory reconciliation).
alter table public.packages
  drop constraint if exists packages_shell_no_inventory_group;

alter table public.packages
  add constraint packages_shell_no_inventory_group
  check (shell_parent_package_id is null or inventory_group_id is null);
