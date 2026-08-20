-- Historical imported deals may reference products hidden from current storefront sale.
-- Keep those products editable while continuing to exclude generated shell packages.

create or replace function public.admin_update_deal_commercials(
  p_deal_id uuid,
  p_account_id uuid,
  p_contact_id uuid,
  p_source text,
  p_notes text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_package_id text;
  v_package_race_id text;
  v_race_id text;
  v_quantity int;
  v_unit_price numeric;
  v_expected_cost numeric;
  v_total numeric := 0;
  v_keep_ids uuid[] := '{}'::uuid[];
  v_seen_packages text[] := '{}'::text[];
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'deal_not_found'; end if;
  if v_deal.order_id is not null then raise exception 'deal_with_order_is_locked'; end if;
  if exists (
    select 1 from public.booking_forms form
    where form.deal_id = p_deal_id
      and form.status in ('sent', 'viewed', 'awaiting_zk_signature', 'zk_signed', 'completed')
  ) then
    raise exception 'booking_form_snapshot_locks_deal_lines';
  end if;
  if exists (
    select 1 from public.inventory_reservations reservation
    where reservation.deal_id = p_deal_id and reservation.status = 'active'
  ) then
    raise exception 'active_reservations_must_be_released';
  end if;
  if not exists (select 1 from public.crm_accounts where id = p_account_id and active) then
    raise exception 'account_not_found';
  end if;
  if p_contact_id is not null and not exists (
    select 1 from public.crm_contacts
    where id = p_contact_id and account_id = p_account_id and active
  ) then
    raise exception 'contact_must_belong_to_account';
  end if;
  if p_source not in ('offline', 'portal', 'website', 'referral', 'other') then
    raise exception 'invalid_deal_source';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'deal_line_required';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_id := nullif(v_line->>'id', '')::uuid;
    v_package_id := nullif(btrim(v_line->>'packageId'), '');
    v_quantity := nullif(v_line->>'quantity', '')::int;
    v_unit_price := nullif(v_line->>'unitPrice', '')::numeric;
    v_expected_cost := nullif(v_line->>'expectedUnitCost', '')::numeric;
    if v_package_id is null or v_quantity is null or v_quantity <= 0
      or v_unit_price is null or v_unit_price < 0
      or (v_expected_cost is not null and v_expected_cost < 0)
    then
      raise exception 'invalid_deal_line';
    end if;
    if v_package_id = any(v_seen_packages) then raise exception 'duplicate_deal_package'; end if;
    v_seen_packages := array_append(v_seen_packages, v_package_id);

    select race_id into v_package_race_id
    from public.packages
    where id = v_package_id
      and shell_parent_package_id is null;
    if not found then raise exception 'package_not_found:%', v_package_id; end if;
    if v_race_id is null then
      v_race_id := v_package_race_id;
    elsif v_race_id is distinct from v_package_race_id then
      raise exception 'deal_lines_must_share_one_event';
    end if;

    if v_line_id is null then
      insert into public.deal_line_items (
        deal_id, package_id, quantity, unit_sale_price, currency,
        expected_unit_cost, reservation_status, sort_order
      ) values (
        p_deal_id, v_package_id, v_quantity, v_unit_price, v_deal.currency,
        v_expected_cost, 'none', array_length(v_seen_packages, 1) - 1
      )
      returning id into v_line_id;
    else
      update public.deal_line_items
      set package_id = v_package_id,
          quantity = v_quantity,
          unit_sale_price = v_unit_price,
          currency = v_deal.currency,
          expected_unit_cost = v_expected_cost,
          sort_order = array_length(v_seen_packages, 1) - 1,
          updated_at = timezone('utc', now())
      where id = v_line_id and deal_id = p_deal_id;
      if not found then raise exception 'deal_line_not_found'; end if;
    end if;
    v_keep_ids := array_append(v_keep_ids, v_line_id);
    v_total := v_total + (v_quantity * v_unit_price);
  end loop;

  delete from public.deal_line_items
  where deal_id = p_deal_id and not (id = any(v_keep_ids));

  update public.deals
  set account_id = p_account_id,
      primary_contact_id = p_contact_id,
      race_id = v_race_id,
      source = p_source,
      notes = nullif(btrim(p_notes), ''),
      total_amount = v_total,
      stock_reconciliation_status = case
        when stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled') then 'pending'
        else stock_reconciliation_status
      end,
      updated_at = timezone('utc', now())
  where id = p_deal_id;

  insert into public.deal_activities (
    deal_id, actor_profile_id, action, summary, metadata
  ) values (
    p_deal_id, auth.uid(), 'commercial_details_updated',
    'Updated deal client, products and pricing',
    jsonb_build_object(
      'line_count', jsonb_array_length(p_lines),
      'total_amount', v_total,
      'source', p_source
    )
  );

  return jsonb_build_object(
    'deal_id', p_deal_id,
    'line_count', jsonb_array_length(p_lines),
    'total_amount', v_total
  );
end;
$$;

revoke all on function public.admin_update_deal_commercials(
  uuid, uuid, uuid, text, text, jsonb
) from public;
grant execute on function public.admin_update_deal_commercials(
  uuid, uuid, uuid, text, text, jsonb
) to authenticated;

