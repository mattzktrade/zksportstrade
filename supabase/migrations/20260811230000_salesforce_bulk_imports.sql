-- Phase 3 preparation: staged, idempotent Salesforce CRM imports.
-- Applying historical won sales never mutates inventory automatically.

create table if not exists public.crm_import_batches (
  id uuid primary key default gen_random_uuid(),
  import_type text not null,
  source_system text not null default 'salesforce',
  file_name text not null,
  status text not null default 'validated',
  total_rows int not null default 0,
  valid_rows int not null default 0,
  error_rows int not null default 0,
  applied_rows int not null default 0,
  skipped_rows int not null default 0,
  failed_rows int not null default 0,
  headers jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  applied_at timestamptz,
  constraint crm_import_batches_type_check check (
    import_type in ('contacts', 'opportunities')
  ),
  constraint crm_import_batches_status_check check (
    status in ('validated', 'applying', 'applied', 'applied_with_errors', 'failed')
  )
);

create table if not exists public.crm_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.crm_import_batches (id) on delete cascade,
  row_number int not null,
  source_external_id text,
  raw_data jsonb not null,
  normalized_data jsonb not null,
  validation_errors text[] not null default '{}',
  validation_warnings text[] not null default '{}',
  status text not null default 'valid',
  target_table text,
  target_id uuid,
  apply_error text,
  created_at timestamptz not null default timezone('utc', now()),
  applied_at timestamptz,
  constraint crm_import_rows_batch_row_unique unique (batch_id, row_number),
  constraint crm_import_rows_status_check check (
    status in ('valid', 'error', 'applied', 'skipped', 'failed')
  )
);

create index if not exists crm_import_batches_created_idx
  on public.crm_import_batches (created_at desc);
create index if not exists crm_import_rows_batch_status_idx
  on public.crm_import_rows (batch_id, status, row_number);

alter table public.crm_import_batches enable row level security;
alter table public.crm_import_rows enable row level security;

create policy "crm_import_batches_admin_all"
  on public.crm_import_batches for all
  using (public.is_admin())
  with check (public.is_admin());
create policy "crm_import_rows_admin_all"
  on public.crm_import_rows for all
  using (public.is_admin())
  with check (public.is_admin());

alter table public.crm_accounts
  add column if not exists salesforce_account_id text,
  add column if not exists source_import_batch_id uuid references public.crm_import_batches (id) on delete set null;
alter table public.crm_contacts
  add column if not exists salesforce_contact_id text,
  add column if not exists source_import_batch_id uuid references public.crm_import_batches (id) on delete set null;
alter table public.deals
  add column if not exists salesforce_opportunity_id text,
  add column if not exists source_import_batch_id uuid references public.crm_import_batches (id) on delete set null,
  add column if not exists external_created_at timestamptz,
  add column if not exists external_updated_at timestamptz,
  add column if not exists stock_reconciliation_status text not null default 'not_required';
alter table public.deal_line_items
  add column if not exists salesforce_line_item_id text;

alter table public.deals
  drop constraint if exists deals_stock_reconciliation_status_check;
alter table public.deals
  add constraint deals_stock_reconciliation_status_check check (
    stock_reconciliation_status in ('not_required', 'pending', 'reconciled', 'ignored')
  );

create unique index if not exists crm_accounts_salesforce_id_unique_idx
  on public.crm_accounts (salesforce_account_id)
  where salesforce_account_id is not null and btrim(salesforce_account_id) <> '';
create unique index if not exists crm_contacts_salesforce_id_unique_idx
  on public.crm_contacts (salesforce_contact_id)
  where salesforce_contact_id is not null and btrim(salesforce_contact_id) <> '';
create unique index if not exists deals_salesforce_opportunity_id_unique_idx
  on public.deals (salesforce_opportunity_id)
  where salesforce_opportunity_id is not null and btrim(salesforce_opportunity_id) <> '';
create unique index if not exists deal_line_items_salesforce_id_unique_idx
  on public.deal_line_items (salesforce_line_item_id)
  where salesforce_line_item_id is not null and btrim(salesforce_line_item_id) <> '';

create or replace function public.admin_apply_crm_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.crm_import_batches%rowtype;
  v_row public.crm_import_rows%rowtype;
  n jsonb;
  v_account_id uuid;
  v_contact_id uuid;
  v_deal_id uuid;
  v_line_id uuid;
  v_package_id text;
  v_account_name text;
  v_contact_name text;
  v_sf_account_id text;
  v_sf_contact_id text;
  v_sf_opportunity_id text;
  v_sf_line_item_id text;
  v_email text;
  v_stage text;
  v_is_won boolean;
  v_quantity int;
  v_amount numeric;
  v_unit_price numeric;
  v_currency text;
  v_owner_id uuid;
  v_supplier_id uuid;
  v_expected_unit_cost numeric;
  v_created boolean;
  v_applied int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_reconciled int := 0;
  v_pending_reconciliation int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select * into v_batch
  from public.crm_import_batches
  where id = p_batch_id
  for update;
  if not found then raise exception 'import_batch_not_found'; end if;

  if v_batch.status = 'applied' then
    return jsonb_build_object(
      'applied', v_batch.applied_rows,
      'skipped', v_batch.skipped_rows,
      'failed', v_batch.failed_rows,
      'already_applied', true
    );
  end if;

  update public.crm_import_batches
  set status = 'applying'
  where id = p_batch_id;

  for v_row in
    select *
    from public.crm_import_rows
    where batch_id = p_batch_id
      and status in ('valid', 'failed')
    order by row_number
  loop
    begin
      n := v_row.normalized_data;
      v_account_id := null;
      v_contact_id := null;
      v_deal_id := null;
      v_line_id := null;
      v_package_id := null;
      v_owner_id := null;
      v_supplier_id := null;
      v_expected_unit_cost := null;
      v_created := false;
      v_account_name := nullif(btrim(n->>'accountName'), '');
      v_contact_name := nullif(btrim(n->>'contactName'), '');
      v_sf_account_id := nullif(btrim(n->>'salesforceAccountId'), '');
      v_sf_contact_id := nullif(btrim(n->>'salesforceContactId'), '');
      v_email := nullif(lower(btrim(n->>'email')), '');

      if v_sf_account_id is not null then
        select id into v_account_id
        from public.crm_accounts
        where salesforce_account_id = v_sf_account_id;
      end if;
      if v_account_id is null and v_account_name is not null then
        select id into v_account_id
        from public.crm_accounts
        where lower(btrim(name)) = lower(v_account_name)
        limit 1;
      end if;

      if v_account_id is null then
        if v_account_name is null then
          v_account_name := coalesce(v_contact_name, v_email, 'Imported Salesforce client');
        end if;
        insert into public.crm_accounts (
          name, account_type, email, phone, salesforce_account_id,
          source_import_batch_id, owner_profile_id, created_by
        ) values (
          v_account_name,
          coalesce(nullif(n->>'accountType', ''), 'agent_company'),
          v_email,
          nullif(btrim(n->>'phone'), ''),
          v_sf_account_id,
          p_batch_id,
          auth.uid(),
          auth.uid()
        )
        returning id into v_account_id;
      else
        if v_sf_account_id is not null and exists (
          select 1 from public.crm_accounts a
          where a.id = v_account_id
            and a.salesforce_account_id is not null
            and a.salesforce_account_id <> v_sf_account_id
        ) then
          raise exception 'account_salesforce_id_conflict';
        end if;
        update public.crm_accounts
        set salesforce_account_id = coalesce(salesforce_account_id, v_sf_account_id),
            email = coalesce(v_email, email),
            phone = coalesce(nullif(btrim(n->>'phone'), ''), phone),
            source_import_batch_id = coalesce(source_import_batch_id, p_batch_id),
            updated_at = timezone('utc', now())
        where id = v_account_id;
      end if;

      if v_sf_contact_id is not null then
        select id into v_contact_id
        from public.crm_contacts
        where salesforce_contact_id = v_sf_contact_id;
      end if;
      if v_contact_id is null and v_email is not null then
        select id into v_contact_id
        from public.crm_contacts
        where account_id = v_account_id
          and lower(btrim(email)) = v_email
        order by active desc, updated_at desc
        limit 1;
      end if;
      if v_contact_id is null and v_contact_name is not null then
        select id into v_contact_id
        from public.crm_contacts
        where account_id = v_account_id
          and lower(btrim(full_name)) = lower(v_contact_name)
        order by active desc, updated_at desc
        limit 1;
      end if;

      if v_contact_id is null and (v_contact_name is not null or v_email is not null) then
        insert into public.crm_contacts (
          account_id, full_name, email, phone, job_title, is_primary, active,
          salesforce_contact_id, source_import_batch_id, created_by
        ) values (
          v_account_id,
          coalesce(v_contact_name, v_email),
          v_email,
          nullif(btrim(n->>'phone'), ''),
          nullif(btrim(n->>'jobTitle'), ''),
          not exists (
            select 1 from public.crm_contacts c
            where c.account_id = v_account_id and c.active = true
          ),
          true,
          v_sf_contact_id,
          p_batch_id,
          auth.uid()
        )
        returning id into v_contact_id;
      elsif v_contact_id is not null then
        if v_sf_contact_id is not null and exists (
          select 1 from public.crm_contacts c
          where c.id = v_contact_id
            and c.salesforce_contact_id is not null
            and c.salesforce_contact_id <> v_sf_contact_id
        ) then
          raise exception 'contact_salesforce_id_conflict';
        end if;
        update public.crm_contacts
        set account_id = v_account_id,
            full_name = coalesce(v_contact_name, full_name),
            email = coalesce(v_email, email),
            phone = coalesce(nullif(btrim(n->>'phone'), ''), phone),
            job_title = coalesce(nullif(btrim(n->>'jobTitle'), ''), job_title),
            salesforce_contact_id = coalesce(salesforce_contact_id, v_sf_contact_id),
            source_import_batch_id = coalesce(source_import_batch_id, p_batch_id),
            active = true,
            updated_at = timezone('utc', now())
        where id = v_contact_id;
      end if;

      if v_batch.import_type = 'contacts' then
        update public.crm_import_rows
        set status = case when v_contact_id is null then 'skipped' else 'applied' end,
            target_table = case when v_contact_id is null then 'crm_accounts' else 'crm_contacts' end,
            target_id = coalesce(v_contact_id, v_account_id),
            apply_error = null,
            applied_at = timezone('utc', now())
        where id = v_row.id;
        if v_contact_id is null then v_skipped := v_skipped + 1;
        else v_applied := v_applied + 1;
        end if;
        continue;
      end if;

      v_sf_opportunity_id := nullif(btrim(n->>'salesforceOpportunityId'), '');
      if v_sf_opportunity_id is null then raise exception 'opportunity_id_required'; end if;
      v_sf_line_item_id := nullif(btrim(n->>'salesforceLineItemId'), '');
      v_stage := coalesce(nullif(n->>'nativeStage', ''), 'draft');
      v_is_won := coalesce((n->>'isWon')::boolean, false);
      v_amount := coalesce(nullif(n->>'amount', '')::numeric, 0);
      v_currency := coalesce(nullif(btrim(n->>'currency'), ''), 'USD');
      v_quantity := greatest(1, coalesce(nullif(n->>'quantity', '')::int, 1));

      select id into v_owner_id
      from public.profiles
      where role in ('admin', 'sales')
        and (
          (nullif(lower(btrim(n->>'ownerEmail')), '') is not null and lower(email) = lower(btrim(n->>'ownerEmail')))
          or (nullif(lower(btrim(n->>'ownerName')), '') is not null and lower(btrim(full_name)) = lower(btrim(n->>'ownerName')))
        )
      order by case when lower(email) = lower(btrim(n->>'ownerEmail')) then 0 else 1 end
      limit 1;

      select id into v_deal_id
      from public.deals
      where salesforce_opportunity_id = v_sf_opportunity_id;

      if v_deal_id is null then
        insert into public.deals (
          reference, account_id, primary_contact_id, owner_profile_id, source, stage,
          currency, total_amount, expected_close_date, loss_reason, notes, created_by,
          salesforce_opportunity_id, source_import_batch_id, external_created_at,
          external_updated_at, stock_reconciliation_status, closed_at
        ) values (
          'SF-' || v_sf_opportunity_id,
          v_account_id,
          v_contact_id,
          coalesce(v_owner_id, auth.uid()),
          coalesce(nullif(n->>'source', ''), 'other'),
          v_stage,
          v_currency,
          v_amount,
          nullif(n->>'closeDate', '')::date,
          nullif(n->>'lossReason', ''),
          nullif(n->>'description', ''),
          auth.uid(),
          v_sf_opportunity_id,
          p_batch_id,
          nullif(n->>'createdAt', '')::timestamptz,
          nullif(n->>'updatedAt', '')::timestamptz,
          case when v_is_won then 'pending' else 'not_required' end,
          case when v_stage in ('paid_confirmed', 'fulfilled', 'closed_lost', 'cancelled')
            then coalesce(nullif(n->>'closeDate', '')::timestamptz, timezone('utc', now()))
            else null end
        )
        returning id into v_deal_id;
        v_created := true;
      else
        update public.deals
        set account_id = coalesce(v_account_id, account_id),
            primary_contact_id = coalesce(v_contact_id, primary_contact_id),
            owner_profile_id = coalesce(v_owner_id, owner_profile_id),
            stage = v_stage,
            currency = v_currency,
            total_amount = v_amount,
            expected_close_date = coalesce(nullif(n->>'closeDate', '')::date, expected_close_date),
            loss_reason = coalesce(nullif(n->>'lossReason', ''), loss_reason),
            notes = coalesce(nullif(n->>'description', ''), notes),
            source_import_batch_id = p_batch_id,
            external_created_at = coalesce(nullif(n->>'createdAt', '')::timestamptz, external_created_at),
            external_updated_at = coalesce(nullif(n->>'updatedAt', '')::timestamptz, external_updated_at),
            stock_reconciliation_status = case
              when v_is_won and stock_reconciliation_status = 'not_required' then 'pending'
              else stock_reconciliation_status end,
            updated_at = timezone('utc', now())
        where id = v_deal_id;
      end if;

      if nullif(btrim(n->>'packageId'), '') is not null then
        select id into v_package_id from public.packages
        where id = btrim(n->>'packageId') and shell_parent_package_id is null;
      end if;
      if v_package_id is null and nullif(btrim(n->>'salesforceProductId'), '') is not null then
        select id into v_package_id from public.packages
        where salesforce_product_id = btrim(n->>'salesforceProductId')
          and shell_parent_package_id is null
        limit 1;
      end if;
      if v_package_id is null and nullif(btrim(n->>'productCode'), '') is not null then
        select id into v_package_id from public.packages
        where lower(btrim(product_code)) = lower(btrim(n->>'productCode'))
          and shell_parent_package_id is null
        limit 1;
      end if;

      if v_package_id is not null then
        if nullif(btrim(n->>'supplierName'), '') is not null then
          select id into v_supplier_id
          from public.suppliers
          where lower(btrim(name)) = lower(btrim(n->>'supplierName'))
          limit 1;
        end if;
        v_expected_unit_cost := nullif(n->>'expectedUnitCost', '')::numeric;
        if v_sf_line_item_id is null then
          v_sf_line_item_id := v_sf_opportunity_id || ':' ||
            coalesce(nullif(btrim(n->>'salesforceProductId'), ''), v_package_id);
        end if;
        v_unit_price := coalesce(
          nullif(n->>'unitPrice', '')::numeric,
          case when v_quantity > 0 and v_amount > 0 then v_amount / v_quantity else null end,
          (select trade_price from public.packages where id = v_package_id),
          0
        );
        select id into v_line_id
        from public.deal_line_items
        where salesforce_line_item_id = v_sf_line_item_id;
        if v_line_id is null then
          insert into public.deal_line_items (
            deal_id, package_id, quantity, unit_sale_price, currency,
            supplier_id, expected_unit_cost, reservation_status, salesforce_line_item_id
          ) values (
            v_deal_id, v_package_id, v_quantity, v_unit_price, v_currency,
            v_supplier_id, v_expected_unit_cost, 'none', v_sf_line_item_id
          )
          returning id into v_line_id;
        else
          update public.deal_line_items
          set deal_id = v_deal_id,
              package_id = v_package_id,
              quantity = v_quantity,
              unit_sale_price = v_unit_price,
              currency = v_currency,
              supplier_id = coalesce(v_supplier_id, supplier_id),
              expected_unit_cost = coalesce(v_expected_unit_cost, expected_unit_cost),
              updated_at = timezone('utc', now())
          where id = v_line_id;
        end if;
      end if;

      if v_created then
        insert into public.deal_activities (
          deal_id, actor_profile_id, action, summary, metadata
        ) values (
          v_deal_id,
          auth.uid(),
          'salesforce_imported',
          'Deal imported from Salesforce',
          jsonb_build_object(
            'salesforce_opportunity_id', v_sf_opportunity_id,
            'import_batch_id', p_batch_id,
            'stock_changed', false
          )
        );
      end if;

      update public.crm_import_rows
      set status = 'applied',
          target_table = 'deals',
          target_id = v_deal_id,
          apply_error = null,
          validation_warnings = validation_warnings || case
            when v_package_id is null and nullif(n->>'salesforceProductId', '') is not null
              then array['Product could not be mapped; deal imported without this line item.']
            else '{}'::text[] end || case
            when nullif(n->>'supplierName', '') is not null and v_supplier_id is null
              then array['Supplier could not be matched; supplier link was left blank.']
            else '{}'::text[] end,
          applied_at = timezone('utc', now())
      where id = v_row.id;
      v_applied := v_applied + 1;
    exception when others then
      update public.crm_import_rows
      set status = 'failed',
          apply_error = sqlerrm,
          applied_at = timezone('utc', now())
      where id = v_row.id;
      v_failed := v_failed + 1;
    end;
  end loop;

  -- Existing portal orders and legacy offline-sale applications already affected
  -- stock. Link/mark them so imported won deals can never be applied a second time.
  update public.deals d
  set order_id = o.id,
      stock_reconciliation_status = 'reconciled',
      updated_at = timezone('utc', now())
  from public.orders o
  where d.source_import_batch_id = p_batch_id
    and d.salesforce_opportunity_id is not null
    and o.salesforce_opportunity_id = d.salesforce_opportunity_id;

  update public.deals d
  set stock_reconciliation_status = 'reconciled',
      updated_at = timezone('utc', now())
  where d.source_import_batch_id = p_batch_id
    and d.stock_reconciliation_status = 'pending'
    and exists (
      select 1
      from public.deal_line_items li
      where li.deal_id = d.id
        and li.salesforce_line_item_id is not null
    )
    and not exists (
      select 1
      from public.deal_line_items li
      where li.deal_id = d.id
        and li.salesforce_line_item_id is not null
        and not exists (
          select 1
          from public.salesforce_offline_sale_applications app
          where app.salesforce_opportunity_id = d.salesforce_opportunity_id
            and app.salesforce_line_item_id = li.salesforce_line_item_id
        )
    );

  select
    count(*) filter (where status = 'applied')::int,
    count(*) filter (where status = 'skipped')::int,
    count(*) filter (where status = 'failed')::int
  into v_applied, v_skipped, v_failed
  from public.crm_import_rows
  where batch_id = p_batch_id;

  select
    count(*) filter (where stock_reconciliation_status = 'reconciled')::int,
    count(*) filter (where stock_reconciliation_status = 'pending')::int
  into v_reconciled, v_pending_reconciliation
  from public.deals
  where source_import_batch_id = p_batch_id;

  update public.crm_import_batches
  set status = case when v_failed > 0 then 'applied_with_errors' else 'applied' end,
      applied_rows = v_applied,
      skipped_rows = v_skipped,
      failed_rows = v_failed,
      applied_at = timezone('utc', now()),
      summary = summary || jsonb_build_object(
        'stock_changed', false,
        'won_sales_require_reconciliation', v_pending_reconciliation > 0,
        'won_sales_already_reconciled', v_reconciled,
        'won_sales_pending_reconciliation', v_pending_reconciliation
      )
  where id = p_batch_id;

  return jsonb_build_object(
    'applied', v_applied,
    'skipped', v_skipped,
    'failed', v_failed,
    'reconciled', v_reconciled,
    'pending_reconciliation', v_pending_reconciliation,
    'stock_changed', false
  );
exception when others then
  update public.crm_import_batches
  set status = 'failed',
      summary = summary || jsonb_build_object('fatal_error', sqlerrm)
  where id = p_batch_id;
  raise;
end;
$$;

revoke all on function public.admin_apply_crm_import_batch(uuid) from public;
grant execute on function public.admin_apply_crm_import_batch(uuid) to authenticated;

comment on table public.crm_import_batches is
  'Audited staged imports. Upload/validation and apply are separate explicit steps.';
comment on column public.deals.stock_reconciliation_status is
  'Historical won imports remain pending until stock is reconciled; import never mutates stock.';

