-- Delete and merge CRM companies and contacts, reassigning history onto the surviving record.

create or replace function public.admin_delete_crm_contact(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.crm_contacts%rowtype;
  v_next uuid;
begin
  if not public.has_cms_permission('accounts.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_contact_id is null then raise exception 'contact_required'; end if;

  select * into v_contact
  from public.crm_contacts
  where id = p_contact_id
  for update;
  if not found then raise exception 'contact_not_found'; end if;

  delete from public.crm_contacts where id = p_contact_id;

  if v_contact.is_primary then
    select id into v_next
    from public.crm_contacts
    where account_id = v_contact.account_id and active
    order by created_at, id
    limit 1;
    if v_next is not null then
      update public.crm_contacts
      set is_primary = true, updated_at = timezone('utc', now())
      where id = v_next;
    end if;
  end if;
end;
$$;

create or replace function public.admin_delete_crm_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_cms_permission('accounts.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_account_id is null then raise exception 'account_required'; end if;
  if not exists (select 1 from public.crm_accounts where id = p_account_id) then
    raise exception 'account_not_found';
  end if;

  delete from public.crm_leads where account_id = p_account_id;
  update public.suppliers
  set crm_account_id = null, updated_at = timezone('utc', now())
  where crm_account_id = p_account_id;
  delete from public.crm_accounts where id = p_account_id;
end;
$$;

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
  if v_source_supplier is not null and v_target_supplier is null then
    update public.suppliers
    set crm_account_id = p_target_id, updated_at = timezone('utc', now())
    where id = v_source_supplier;
  elsif v_source_supplier is not null then
    update public.suppliers
    set crm_account_id = null, updated_at = timezone('utc', now())
    where id = v_source_supplier;
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

create or replace function public.admin_merge_crm_contacts(
  p_source_id uuid,
  p_target_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.crm_contacts%rowtype;
  v_target public.crm_contacts%rowtype;
  v_next uuid;
begin
  if not public.has_cms_permission('accounts.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_source_id is null or p_target_id is null then raise exception 'contact_required'; end if;
  if p_source_id = p_target_id then raise exception 'same_record'; end if;

  select * into v_source from public.crm_contacts where id = p_source_id for update;
  if not found then raise exception 'contact_not_found'; end if;
  select * into v_target from public.crm_contacts where id = p_target_id for update;
  if not found then raise exception 'contact_not_found'; end if;

  if v_source.account_id is distinct from v_target.account_id then
    update public.deals
    set account_id = v_target.account_id,
        primary_contact_id = p_target_id,
        updated_at = timezone('utc', now())
    where primary_contact_id = p_source_id;
    update public.crm_leads
    set account_id = v_target.account_id,
        contact_id = p_target_id,
        updated_at = timezone('utc', now())
    where contact_id = p_source_id;
  else
    update public.deals
    set primary_contact_id = p_target_id, updated_at = timezone('utc', now())
    where primary_contact_id = p_source_id;
    update public.crm_leads
    set contact_id = p_target_id, updated_at = timezone('utc', now())
    where contact_id = p_source_id;
  end if;

  update public.orders
  set crm_contact_id = p_target_id
  where crm_contact_id = p_source_id;

  if v_target.salesforce_contact_id is null or btrim(v_target.salesforce_contact_id) = '' then
    update public.crm_contacts
    set salesforce_contact_id = null
    where id = p_source_id;
  end if;

  update public.crm_contacts
  set email = coalesce(nullif(btrim(email), ''), v_source.email),
      phone = coalesce(nullif(btrim(phone), ''), v_source.phone),
      job_title = coalesce(nullif(btrim(job_title), ''), v_source.job_title),
      notes = case
        when nullif(btrim(notes), '') is null then v_source.notes
        when nullif(btrim(v_source.notes), '') is null then notes
        when notes = v_source.notes then notes
        else notes || E'\n\n' || v_source.notes
      end,
      is_primary = case
        when v_source.account_id = v_target.account_id then is_primary or v_source.is_primary
        else is_primary
      end,
      portal_profile_id = coalesce(portal_profile_id, v_source.portal_profile_id),
      salesforce_contact_id = coalesce(nullif(btrim(salesforce_contact_id), ''), v_source.salesforce_contact_id),
      updated_at = timezone('utc', now())
  where id = p_target_id;

  if v_source.is_primary and v_source.account_id = v_target.account_id then
    update public.crm_contacts
    set is_primary = false, updated_at = timezone('utc', now())
    where account_id = v_target.account_id and id <> p_target_id and is_primary;
    update public.crm_contacts
    set is_primary = true, updated_at = timezone('utc', now())
    where id = p_target_id;
  end if;

  delete from public.crm_contacts where id = p_source_id;

  if v_source.is_primary and v_source.account_id is distinct from v_target.account_id then
    select id into v_next
    from public.crm_contacts
    where account_id = v_source.account_id and active
    order by created_at, id
    limit 1;
    if v_next is not null then
      update public.crm_contacts
      set is_primary = true, updated_at = timezone('utc', now())
      where id = v_next;
    end if;
  end if;

  return p_target_id;
end;
$$;

revoke all on function public.admin_delete_crm_contact(uuid) from public;
revoke all on function public.admin_delete_crm_account(uuid) from public;
revoke all on function public.admin_merge_crm_accounts(uuid, uuid) from public;
revoke all on function public.admin_merge_crm_contacts(uuid, uuid) from public;
grant execute on function public.admin_delete_crm_contact(uuid) to authenticated;
grant execute on function public.admin_delete_crm_account(uuid) to authenticated;
grant execute on function public.admin_merge_crm_accounts(uuid, uuid) to authenticated;
grant execute on function public.admin_merge_crm_contacts(uuid, uuid) to authenticated;
