-- Remember which purchase-stock supplier a deal line is using,
-- and allow skipping one happy-path stage (including Paid → Fulfilled).

alter table public.deal_line_items
  add column if not exists fulfilment_cost_layer_id uuid
    references public.package_cost_layers(id) on delete set null;

create index if not exists deal_line_items_fulfilment_layer_idx
  on public.deal_line_items (fulfilment_cost_layer_id)
  where fulfilment_cost_layer_id is not null;

create or replace function public.admin_update_deal_workflow(
  p_deal_id uuid,
  p_stage text,
  p_owner_profile_id uuid default null,
  p_next_action text default null,
  p_next_action_due_at timestamptz default null,
  p_expected_close_date date default null,
  p_loss_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_transition_allowed boolean := false;
  v_path text[] := array[
    'draft',
    'sourcing',
    'proposal',
    'booking_form_sent',
    'awaiting_client_signature',
    'awaiting_zk_signature',
    'signed',
    'awaiting_invoice',
    'awaiting_payment',
    'paid_confirmed',
    'in_fulfilment',
    'fulfilled'
  ];
  v_from int;
  v_to int;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_deal
  from public.deals
  where id = p_deal_id
  for update;
  if not found then raise exception 'deal_not_found'; end if;
  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id and p.role in ('admin', 'sales')
  ) then
    raise exception 'owner_not_found';
  end if;
  if p_stage = 'closed_lost' and nullif(btrim(p_loss_reason), '') is null then
    raise exception 'loss_reason_required';
  end if;

  v_from := array_position(v_path, v_deal.stage);
  v_to := array_position(v_path, p_stage);
  v_transition_allowed :=
    p_stage = v_deal.stage
    or (p_stage in ('closed_lost', 'cancelled') and v_deal.stage not in ('fulfilled', 'closed_lost', 'cancelled'))
    or (v_deal.stage in ('closed_lost', 'cancelled') and p_stage = 'draft')
    or (v_deal.stage = 'sourcing' and p_stage = 'draft')
    or (v_from is not null and v_to is not null and v_to > v_from and v_to <= v_from + 2);

  if not v_transition_allowed then
    raise exception 'invalid_stage_transition:%->%', v_deal.stage, p_stage;
  end if;

  if p_stage in ('closed_lost', 'cancelled') and p_stage <> v_deal.stage then
    perform public.admin_release_deal_reservations(
      p_deal_id,
      'cancelled',
      case when p_stage = 'closed_lost'
        then 'Reservation released because deal was lost'
        else 'Reservation released because deal was cancelled'
      end
    );
  end if;

  update public.deals
  set stage = p_stage,
      owner_profile_id = p_owner_profile_id,
      next_action = nullif(btrim(p_next_action), ''),
      next_action_due_at = p_next_action_due_at,
      expected_close_date = p_expected_close_date,
      loss_reason = case
        when p_stage = 'closed_lost' then nullif(btrim(p_loss_reason), '')
        when p_stage not in ('closed_lost', 'cancelled') then null
        else loss_reason end,
      closed_at = case
        when p_stage in ('paid_confirmed', 'fulfilled', 'closed_lost', 'cancelled')
          then coalesce(closed_at, timezone('utc', now()))
        when p_stage = 'draft' then null
        else closed_at end,
      updated_at = timezone('utc', now())
  where id = p_deal_id;

  insert into public.deal_activities (
    deal_id, actor_profile_id, action, summary, metadata
  ) values (
    p_deal_id,
    auth.uid(),
    case when p_stage = v_deal.stage then 'workflow_updated' else 'stage_changed' end,
    case when p_stage = v_deal.stage
      then 'Deal workflow details updated'
      else 'Deal stage changed from ' || v_deal.stage || ' to ' || p_stage
    end,
    jsonb_build_object(
      'previous_stage', v_deal.stage,
      'stage', p_stage,
      'owner_profile_id', p_owner_profile_id,
      'next_action', nullif(btrim(p_next_action), ''),
      'next_action_due_at', p_next_action_due_at,
      'expected_close_date', p_expected_close_date,
      'loss_reason', nullif(btrim(p_loss_reason), '')
    )
  );
end;
$$;
