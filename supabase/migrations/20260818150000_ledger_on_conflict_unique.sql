-- inventory_ledger_entries uniqueness was a partial index
-- (WHERE source_table IS NOT NULL AND source_id IS NOT NULL).
-- ON CONFLICT (source_table, source_id, entry_type) cannot infer that,
-- so converting a signed deal to an order failed with:
--   there is no unique or exclusion constraint matching the ON CONFLICT specification
-- A full unique index on the same columns is equivalent for non-null values
-- (PostgreSQL unique indexes still allow multiple NULLs) and is inferable.

drop index if exists public.inventory_ledger_entries_source_unique_idx;

create unique index inventory_ledger_entries_source_unique_idx
  on public.inventory_ledger_entries (source_table, source_id, entry_type);
