-- Safe native product removal and legacy generated-shell cleanup.
-- Genuine one-day/two-day sellable products have shell_parent_package_id IS NULL
-- and are never included in the shell cleanup.

create or replace function public.package_has_business_history(p_package_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.orders where package_id = p_package_id)
    or exists (select 1 from public.order_line_items where package_id = p_package_id)
    or exists (select 1 from public.deal_line_items where package_id = p_package_id)
    or exists (select 1 from public.booking_approval_requests where package_id = p_package_id)
    or exists (select 1 from public.order_cost_consumptions where package_id = p_package_id)
    or exists (select 1 from public.order_supplier_fulfilments where package_id = p_package_id)
    or exists (select 1 from public.salesforce_offline_sale_applications where package_id = p_package_id)
    or exists (select 1 from public.inventory_ledger_entries where package_id = p_package_id)
    or exists (select 1 from public.inventory_reservations where package_id = p_package_id)
    or exists (select 1 from public.inventory_holds where package_id = p_package_id)
    or exists (select 1 from public.sourcing_shortages where package_id = p_package_id)
    or exists (select 1 from public.package_cost_layers where package_id = p_package_id)
    or exists (select 1 from public.cutover_package_snapshots where package_id = p_package_id)
    or exists (select 1 from public.channel_listings where package_id = p_package_id)
    or exists (select 1 from public.crm_leads where package_id = p_package_id);
$$;

revoke all on function public.package_has_business_history(text) from public;

create or replace function public.admin_remove_inventory_product(p_package_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package public.packages%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into v_package
  from public.packages
  where id = nullif(btrim(p_package_id), '')
  for update;
  if not found then raise exception 'package_not_found'; end if;

  if public.package_has_business_history(v_package.id)
    or exists (
      select 1 from public.packages child
      where child.shell_parent_package_id = v_package.id
    )
  then
    update public.packages
    set is_hidden = true
    where id = v_package.id;
    return jsonb_build_object(
      'result', 'archived',
      'package_id', v_package.id,
      'message', 'Product has business history and was archived instead of deleted.'
    );
  end if;

  delete from public.packages where id = v_package.id;
  return jsonb_build_object(
    'result', 'deleted',
    'package_id', v_package.id,
    'message', 'Unused product permanently deleted.'
  );
end;
$$;

revoke all on function public.admin_remove_inventory_product(text) from public;
grant execute on function public.admin_remove_inventory_product(text) to authenticated;

create or replace function public.admin_cleanup_legacy_shell_packages()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shell record;
  v_deleted int := 0;
  v_preserved int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  for v_shell in
    select id
    from public.packages
    where shell_parent_package_id is not null
    order by id
    for update
  loop
    if public.package_has_business_history(v_shell.id) then
      update public.packages set is_hidden = true where id = v_shell.id;
      v_preserved := v_preserved + 1;
    else
      delete from public.packages where id = v_shell.id;
      v_deleted := v_deleted + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'deleted', v_deleted,
    'preserved_for_history', v_preserved
  );
end;
$$;

revoke all on function public.admin_cleanup_legacy_shell_packages() from public;
grant execute on function public.admin_cleanup_legacy_shell_packages() to authenticated;

