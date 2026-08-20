-- Ensure a supplier row for an explicitly chosen CRM company.
-- Do not match or attach accounts by name unless the admin picked that company.

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
    return v_id;
  end if;

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

  return v_id;
end;
$$;

create or replace function public.admin_ensure_supplier_for_account(
  p_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_id uuid;
  v_existing_account uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_account_id is null then
    raise exception 'account_required';
  end if;

  select nullif(btrim(name), '') into v_name
  from public.crm_accounts
  where id = p_account_id;

  if v_name is null then
    raise exception 'account_not_found';
  end if;

  select id into v_id
  from public.suppliers
  where crm_account_id = p_account_id
  limit 1;

  if v_id is not null then
    update public.suppliers
    set active = true,
        updated_at = timezone('utc', now())
    where id = v_id;
    return v_id;
  end if;

  select id, crm_account_id into v_id, v_existing_account
  from public.suppliers
  where lower(btrim(name)) = lower(v_name)
  limit 1;

  if v_id is not null then
    if v_existing_account is not null and v_existing_account <> p_account_id then
      raise exception 'supplier_name_linked_to_other_account';
    end if;
    update public.suppliers
    set crm_account_id = p_account_id,
        active = true,
        updated_at = timezone('utc', now())
    where id = v_id;
    return v_id;
  end if;

  insert into public.suppliers (name, crm_account_id, created_by)
  values (v_name, p_account_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_ensure_supplier_for_account(uuid) from public;
grant execute on function public.admin_ensure_supplier_for_account(uuid) to authenticated;
