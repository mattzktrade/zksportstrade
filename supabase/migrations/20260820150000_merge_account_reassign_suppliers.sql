-- When CRM companies are merged, purchase orders / stock / deals must follow
-- the surviving company. Previously the duplicate supplier was only unlinked,
-- so the PO list still showed names like "Staff and Services" and "Staff& Services".

create or replace function public.crm_supplier_name_key(p_name text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(p_name, ''))), '&', ' and ', 'g'),
        '\yand\y', ' ', 'g'
      ),
      '[^a-z0-9]+',
      '',
      'g'
    ),
    ''
  );
$$;

comment on function public.crm_supplier_name_key(text) is
  'Normalized supplier/company name for matching duplicates (treats & and "and" as the same).';

create or replace function public.admin_reassign_supplier_records(
  p_from uuid,
  p_to uuid,
  p_to_name text,
  p_from_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to_name text;
  v_from_key text;
begin
  if p_to is null then
    raise exception 'supplier_required';
  end if;
  if p_from is not null and p_from = p_to then
    return;
  end if;

  v_to_name := nullif(btrim(coalesce(p_to_name, '')), '');
  if v_to_name is null then
    select nullif(btrim(name), '') into v_to_name from public.suppliers where id = p_to;
  end if;
  if v_to_name is null then
    select nullif(btrim(a.name), '') into v_to_name
    from public.suppliers s
    join public.crm_accounts a on a.id = s.crm_account_id
    where s.id = p_to;
  end if;
  if v_to_name is null then
    raise exception 'supplier_name_required';
  end if;

  v_from_key := public.crm_supplier_name_key(coalesce(p_from_name, ''));
  if v_from_key is null and p_from is not null then
    select public.crm_supplier_name_key(name) into v_from_key
    from public.suppliers
    where id = p_from;
  end if;

  update public.purchase_orders
  set supplier_id = p_to,
      supplier = v_to_name,
      updated_at = timezone('utc', now())
  where p_from is not null
    and supplier_id = p_from;

  -- Catch leftover name matches that still point at some other unlinked supplier.
  if v_from_key is not null then
    update public.purchase_orders po
    set supplier_id = p_to,
        supplier = v_to_name,
        updated_at = timezone('utc', now())
    where public.crm_supplier_name_key(po.supplier) = v_from_key
      and po.supplier_id is distinct from p_to
      and (
        po.supplier_id is null
        or exists (
          select 1 from public.suppliers s
          where s.id = po.supplier_id
            and s.crm_account_id is null
        )
      );

    update public.package_cost_layers
    set supplier_id = p_to,
        source = v_to_name,
        updated_at = timezone('utc', now())
    where supplier_id is null
      and public.crm_supplier_name_key(source) = v_from_key;
  end if;

  if p_from is not null then
    update public.package_cost_layers
    set supplier_id = p_to,
        source = case
          when v_from_key is not null and public.crm_supplier_name_key(source) = v_from_key then v_to_name
          else source
        end,
        updated_at = timezone('utc', now())
    where supplier_id = p_from;

    update public.deal_line_items
    set supplier_id = p_to,
        updated_at = timezone('utc', now())
    where supplier_id = p_from;

    update public.sourcing_shortages
    set supplier_id = p_to
    where supplier_id = p_from;

    update public.inventory_ledger_entries
    set supplier_id = p_to
    where supplier_id = p_from;

    delete from public.order_supplier_fulfilments src
    using public.order_supplier_fulfilments tgt
    where src.supplier_id = p_from
      and tgt.supplier_id = p_to
      and src.order_id = tgt.order_id
      and coalesce(src.order_line_item_id::text, src.package_id)
        = coalesce(tgt.order_line_item_id::text, tgt.package_id);

    update public.order_supplier_fulfilments
    set supplier_id = p_to,
        updated_at = timezone('utc', now())
    where supplier_id = p_from;

    insert into public.supplier_event_coverage (supplier_id, race_id)
    select p_to, race_id
    from public.supplier_event_coverage
    where supplier_id = p_from
    on conflict (supplier_id, race_id) do nothing;
    delete from public.supplier_event_coverage where supplier_id = p_from;

    update public.suppliers tgt
    set code = coalesce(nullif(btrim(tgt.code), ''), src.code),
        contact_name = coalesce(nullif(btrim(tgt.contact_name), ''), src.contact_name),
        contact_email = coalesce(nullif(btrim(tgt.contact_email), ''), src.contact_email),
        contact_phone = coalesce(nullif(btrim(tgt.contact_phone), ''), src.contact_phone),
        notes = case
          when nullif(btrim(tgt.notes), '') is null then src.notes
          when nullif(btrim(src.notes), '') is null then tgt.notes
          when tgt.notes = src.notes then tgt.notes
          else tgt.notes || E'\n\n' || src.notes
        end,
        active = true,
        updated_at = timezone('utc', now())
    from public.suppliers src
    where tgt.id = p_to
      and src.id = p_from;

    update public.suppliers
    set crm_account_id = null,
        active = false,
        updated_at = timezone('utc', now())
    where id = p_from;

    begin
      delete from public.suppliers where id = p_from;
    exception
      when foreign_key_violation then
        null;
    end;
  end if;

  update public.purchase_orders
  set supplier = v_to_name,
      updated_at = timezone('utc', now())
  where supplier_id = p_to
    and supplier is distinct from v_to_name;
end;
$$;

revoke all on function public.admin_reassign_supplier_records(uuid, uuid, text, text) from public;

create or replace function public.admin_merge_crm_accounts(
  p_source_id uuid,
  p_target_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.crm_accounts%rowtype;
  v_target public.crm_accounts%rowtype;
  v_target_has_primary boolean;
  v_source_supplier uuid;
  v_target_supplier uuid;
begin
  if not public.has_cms_permission('accounts.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_source_id is null or p_target_id is null then raise exception 'account_required'; end if;
  if p_source_id = p_target_id then raise exception 'same_record'; end if;

  select * into v_source from public.crm_accounts where id = p_source_id for update;
  if not found then raise exception 'account_not_found'; end if;
  select * into v_target from public.crm_accounts where id = p_target_id for update;
  if not found then raise exception 'account_not_found'; end if;

  select exists (
    select 1 from public.crm_contacts
    where account_id = p_target_id and is_primary
  ) into v_target_has_primary;
  if v_target_has_primary then
    update public.crm_contacts
    set is_primary = false, updated_at = timezone('utc', now())
    where account_id = p_source_id and is_primary;
  end if;
  update public.crm_contacts
  set account_id = p_target_id, updated_at = timezone('utc', now())
  where account_id = p_source_id;

  update public.deals
  set account_id = p_target_id, updated_at = timezone('utc', now())
  where account_id = p_source_id;
  update public.crm_leads
  set account_id = p_target_id, updated_at = timezone('utc', now())
  where account_id = p_source_id;
  update public.orders
  set crm_account_id = p_target_id
  where crm_account_id = p_source_id;

  insert into public.crm_account_event_interests (account_id, race_id)
  select p_target_id, race_id
  from public.crm_account_event_interests
  where account_id = p_source_id
  on conflict (account_id, race_id) do nothing;
  delete from public.crm_account_event_interests where account_id = p_source_id;

  if v_target.salesforce_account_id is null or btrim(v_target.salesforce_account_id) = '' then
    update public.crm_accounts
    set salesforce_account_id = null
    where id = p_source_id;
  end if;

  select id into v_source_supplier from public.suppliers where crm_account_id = p_source_id limit 1;
  select id into v_target_supplier from public.suppliers where crm_account_id = p_target_id limit 1;

  if v_target_supplier is null and v_source_supplier is not null then
    update public.suppliers
    set crm_account_id = p_target_id,
        name = v_target.name,
        active = true,
        updated_at = timezone('utc', now())
    where id = v_source_supplier;
    v_target_supplier := v_source_supplier;
    v_source_supplier := null;
  elsif v_target_supplier is null then
    insert into public.suppliers (name, crm_account_id, created_by)
    values (v_target.name, p_target_id, auth.uid())
    returning id into v_target_supplier;
  end if;

  if v_source_supplier is not null and v_source_supplier is distinct from v_target_supplier then
    perform public.admin_reassign_supplier_records(
      v_source_supplier,
      v_target_supplier,
      v_target.name,
      v_source.name
    );
  else
    perform public.admin_reassign_supplier_records(
      null,
      v_target_supplier,
      v_target.name,
      v_source.name
    );
  end if;

  update public.crm_accounts
  set email = coalesce(nullif(btrim(email), ''), v_source.email),
      phone = coalesce(nullif(btrim(phone), ''), v_source.phone),
      notes = case
        when nullif(btrim(notes), '') is null then v_source.notes
        when nullif(btrim(v_source.notes), '') is null then notes
        when notes = v_source.notes then notes
        else notes || E'\n\n' || v_source.notes
      end,
      billing_address_line1 = coalesce(nullif(btrim(billing_address_line1), ''), v_source.billing_address_line1),
      billing_address_line2 = coalesce(nullif(btrim(billing_address_line2), ''), v_source.billing_address_line2),
      billing_city = coalesce(nullif(btrim(billing_city), ''), v_source.billing_city),
      billing_postcode = coalesce(nullif(btrim(billing_postcode), ''), v_source.billing_postcode),
      billing_country = coalesce(nullif(btrim(billing_country), ''), v_source.billing_country),
      portal_profile_id = coalesce(portal_profile_id, v_source.portal_profile_id),
      salesforce_account_id = coalesce(nullif(btrim(salesforce_account_id), ''), v_source.salesforce_account_id),
      owner_profile_id = coalesce(owner_profile_id, v_source.owner_profile_id),
      account_types = (
        select coalesce(array_agg(distinct kind), '{}'::text[])
        from unnest(coalesce(account_types, '{}'::text[]) || coalesce(v_source.account_types, '{}'::text[])) as kind
      ),
      account_type = case
        when account_type = 'agent_company' or v_source.account_type = 'agent_company' then 'agent_company'
        when account_type = 'direct_client' or v_source.account_type = 'direct_client' then 'direct_client'
        else account_type
      end,
      updated_at = timezone('utc', now())
  where id = p_target_id;

  delete from public.crm_accounts where id = p_source_id;
  return p_target_id;
end;
$$;

-- Repair POs that were left on duplicate/unlinked suppliers after earlier merges.
do $$
declare
  r record;
  v_targets uuid[];
  v_names text[];
begin
  for r in
    select s.id, s.name
    from public.suppliers s
    where s.crm_account_id is null
  loop
    select array_agg(s2.id), array_agg(coalesce(a.name, s2.name))
    into v_targets, v_names
    from public.suppliers s2
    left join public.crm_accounts a on a.id = s2.crm_account_id
    where s2.crm_account_id is not null
      and s2.id <> r.id
      and (
        public.crm_supplier_name_key(s2.name) = public.crm_supplier_name_key(r.name)
        or public.crm_supplier_name_key(a.name) = public.crm_supplier_name_key(r.name)
      );

    if v_targets is not null and array_length(v_targets, 1) = 1 then
      perform public.admin_reassign_supplier_records(r.id, v_targets[1], v_names[1], r.name);
    elsif (v_targets is null or array_length(v_targets, 1) is null) then
      select array_agg(a.id)
      into v_targets
      from public.crm_accounts a
      where public.crm_supplier_name_key(a.name) = public.crm_supplier_name_key(r.name);
      if v_targets is not null and array_length(v_targets, 1) = 1 then
        update public.suppliers
        set crm_account_id = v_targets[1],
            name = (select name from public.crm_accounts where id = v_targets[1]),
            active = true,
            updated_at = timezone('utc', now())
        where id = r.id
          and not exists (
            select 1 from public.suppliers other
            where other.crm_account_id = v_targets[1]
              and other.id <> r.id
          );
        update public.purchase_orders
        set supplier = (select name from public.crm_accounts where id = v_targets[1]),
            updated_at = timezone('utc', now())
        where supplier_id = r.id;
      end if;
    end if;
  end loop;

  update public.purchase_orders po
  set supplier = a.name,
      updated_at = timezone('utc', now())
  from public.suppliers s
  join public.crm_accounts a on a.id = s.crm_account_id
  where po.supplier_id = s.id
    and po.supplier is distinct from a.name;
end;
$$;
