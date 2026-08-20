-- Saved company event interests and supplier event coverage.
-- History from deals / purchases stays inferred separately.

create table if not exists public.crm_account_event_interests (
  account_id uuid not null references public.crm_accounts (id) on delete cascade,
  race_id text not null references public.races (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (account_id, race_id)
);

create index if not exists crm_account_event_interests_race_idx
  on public.crm_account_event_interests (race_id);

alter table public.crm_account_event_interests enable row level security;

drop policy if exists "crm_account_event_interests_select" on public.crm_account_event_interests;
create policy "crm_account_event_interests_select"
  on public.crm_account_event_interests for select
  using (public.is_cms_staff());

drop policy if exists "crm_account_event_interests_write" on public.crm_account_event_interests;
create policy "crm_account_event_interests_insert"
  on public.crm_account_event_interests for insert
  with check (public.has_cms_permission('accounts.manage'));
create policy "crm_account_event_interests_update"
  on public.crm_account_event_interests for update
  using (public.has_cms_permission('accounts.manage'))
  with check (public.has_cms_permission('accounts.manage'));
create policy "crm_account_event_interests_delete"
  on public.crm_account_event_interests for delete
  using (public.has_cms_permission('accounts.manage'));

create table if not exists public.supplier_event_coverage (
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  race_id text not null references public.races (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (supplier_id, race_id)
);

create index if not exists supplier_event_coverage_race_idx
  on public.supplier_event_coverage (race_id);

alter table public.supplier_event_coverage enable row level security;

drop policy if exists "supplier_event_coverage_select" on public.supplier_event_coverage;
create policy "supplier_event_coverage_select"
  on public.supplier_event_coverage for select
  using (public.is_cms_staff());

create policy "supplier_event_coverage_insert"
  on public.supplier_event_coverage for insert
  with check (
    public.has_cms_permission('accounts.manage')
    or public.has_cms_permission('inventory.manage')
    or public.is_admin()
  );
create policy "supplier_event_coverage_update"
  on public.supplier_event_coverage for update
  using (
    public.has_cms_permission('accounts.manage')
    or public.has_cms_permission('inventory.manage')
    or public.is_admin()
  )
  with check (
    public.has_cms_permission('accounts.manage')
    or public.has_cms_permission('inventory.manage')
    or public.is_admin()
  );
create policy "supplier_event_coverage_delete"
  on public.supplier_event_coverage for delete
  using (
    public.has_cms_permission('accounts.manage')
    or public.has_cms_permission('inventory.manage')
    or public.is_admin()
  );

drop policy if exists "suppliers_staff_update" on public.suppliers;
create policy "suppliers_staff_update"
  on public.suppliers for update
  using (
    public.has_cms_permission('accounts.manage')
    or public.has_cms_permission('inventory.manage')
    or public.is_admin()
  )
  with check (
    public.has_cms_permission('accounts.manage')
    or public.has_cms_permission('inventory.manage')
    or public.is_admin()
  );
