-- Give every supplier a CRM account (and contact) so they appear under Accounts.
-- Existing companies with the same name are reused instead of duplicated.

create or replace function public.admin_ensure_account_for_supplier(
  p_supplier_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup public.suppliers%rowtype;
  v_account_id uuid;
  v_contact_name text;
begin
  if not public.is_admin() and not public.is_cms_staff() then
    raise exception 'forbidden';
  end if;
  if p_supplier_id is null then
    raise exception 'supplier_required';
  end if;

  select * into v_sup
  from public.suppliers
  where id = p_supplier_id
  for update;
  if not found then raise exception 'supplier_not_found'; end if;

  v_account_id := v_sup.crm_account_id;
  if v_account_id is null then
    select id into v_account_id
    from public.crm_accounts
    where lower(btrim(name)) = lower(btrim(v_sup.name))
    limit 1;
  end if;

  if v_account_id is null then
    insert into public.crm_accounts (
      name, account_type, account_types, email, phone, notes, source, created_by
    ) values (
      v_sup.name,
      'supplier_related',
      array['supplier']::text[],
      nullif(btrim(v_sup.contact_email), ''),
      nullif(btrim(v_sup.contact_phone), ''),
      v_sup.notes,
      'manual',
      coalesce(auth.uid(), v_sup.created_by)
    )
    returning id into v_account_id;
  else
    update public.crm_accounts
    set account_types = (
          select array_agg(distinct kind)
          from unnest(coalesce(account_types, '{}'::text[]) || array['supplier']::text[]) as kind
        ),
        account_type = case
          when account_type in ('agent_company', 'direct_client') then account_type
          else 'supplier_related'
        end,
        email = coalesce(nullif(btrim(email), ''), nullif(btrim(v_sup.contact_email), '')),
        phone = coalesce(nullif(btrim(phone), ''), nullif(btrim(v_sup.contact_phone), '')),
        notes = coalesce(nullif(btrim(notes), ''), v_sup.notes),
        updated_at = timezone('utc', now())
    where id = v_account_id;
  end if;

  if v_sup.crm_account_id is distinct from v_account_id then
    update public.suppliers
    set crm_account_id = v_account_id,
        updated_at = timezone('utc', now())
    where id = p_supplier_id;
  end if;

  v_contact_name := nullif(btrim(v_sup.contact_name), '');
  if v_contact_name is not null
     and not exists (
       select 1 from public.crm_contacts
       where account_id = v_account_id
     )
  then
    insert into public.crm_contacts (
      account_id, full_name, email, phone, is_primary, created_by
    ) values (
      v_account_id,
      v_contact_name,
      nullif(btrim(v_sup.contact_email), ''),
      nullif(btrim(v_sup.contact_phone), ''),
      true,
      coalesce(auth.uid(), v_sup.created_by)
    );
  end if;

  return v_account_id;
end;
$$;

revoke all on function public.admin_ensure_account_for_supplier(uuid) from public;
grant execute on function public.admin_ensure_account_for_supplier(uuid) to authenticated;

create or replace function public.admin_ensure_supplier(
  p_name text,
  p_code text default null,
  p_contact_name text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_name := nullif(btrim(p_name), '');
  if v_name is null then
    raise exception 'supplier_name_required';
  end if;

  select id into v_id
  from public.suppliers
  where lower(btrim(name)) = lower(v_name)
  limit 1;

  if v_id is not null then
    update public.suppliers
    set code = coalesce(nullif(btrim(p_code), ''), code),
        contact_name = coalesce(nullif(btrim(p_contact_name), ''), contact_name),
        contact_email = coalesce(nullif(btrim(p_contact_email), ''), contact_email),
        contact_phone = coalesce(nullif(btrim(p_contact_phone), ''), contact_phone),
        notes = coalesce(nullif(btrim(p_notes), ''), notes),
        active = true,
        updated_at = timezone('utc', now())
    where id = v_id;
  else
    insert into public.suppliers (
      name, code, contact_name, contact_email, contact_phone, notes, created_by
    ) values (
      v_name,
      nullif(btrim(p_code), ''),
      nullif(btrim(p_contact_name), ''),
      nullif(btrim(p_contact_email), ''),
      nullif(btrim(p_contact_phone), ''),
      nullif(btrim(p_notes), ''),
      auth.uid()
    )
    returning id into v_id;
  end if;

  perform public.admin_ensure_account_for_supplier(v_id);
  return v_id;
end;
$$;

-- Backfill existing suppliers that were created before the CRM link existed.
insert into public.crm_accounts (
  name, account_type, account_types, email, phone, notes, source, created_by
)
select
  supplier.name,
  'supplier_related',
  array['supplier']::text[],
  nullif(btrim(supplier.contact_email), ''),
  nullif(btrim(supplier.contact_phone), ''),
  supplier.notes,
  'manual',
  supplier.created_by
from public.suppliers supplier
where supplier.crm_account_id is null
  and not exists (
    select 1
    from public.crm_accounts account
    where lower(btrim(account.name)) = lower(btrim(supplier.name))
  );

update public.suppliers supplier
set crm_account_id = account.id,
    updated_at = timezone('utc', now())
from public.crm_accounts account
where supplier.crm_account_id is null
  and lower(btrim(account.name)) = lower(btrim(supplier.name));

update public.crm_accounts account
set account_types = (
      select array_agg(distinct kind)
      from unnest(coalesce(account.account_types, '{}'::text[]) || array['supplier']::text[]) as kind
    ),
    account_type = case
      when account.account_type in ('agent_company', 'direct_client') then account.account_type
      else 'supplier_related'
    end,
    email = coalesce(nullif(btrim(account.email), ''), supplier.contact_email),
    phone = coalesce(nullif(btrim(account.phone), ''), supplier.contact_phone),
    notes = coalesce(nullif(btrim(account.notes), ''), supplier.notes),
    updated_at = timezone('utc', now())
from public.suppliers supplier
where supplier.crm_account_id = account.id
  and (
    not ('supplier' = any (coalesce(account.account_types, '{}'::text[])))
    or nullif(btrim(account.email), '') is null
    or nullif(btrim(account.phone), '') is null
  );

insert into public.crm_contacts (
  account_id, full_name, email, phone, is_primary, created_by
)
select
  supplier.crm_account_id,
  btrim(supplier.contact_name),
  nullif(btrim(supplier.contact_email), ''),
  nullif(btrim(supplier.contact_phone), ''),
  true,
  supplier.created_by
from public.suppliers supplier
where supplier.crm_account_id is not null
  and nullif(btrim(supplier.contact_name), '') is not null
  and not exists (
    select 1
    from public.crm_contacts contact
    where contact.account_id = supplier.crm_account_id
  );
