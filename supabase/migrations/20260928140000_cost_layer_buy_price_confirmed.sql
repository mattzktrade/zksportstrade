-- A zero unit cost is otherwise treated as "buy price not recorded" and left
-- out of profit and loss. Staff can tick that the zero is the real buy price.

alter table public.package_cost_layers
  add column if not exists unit_cost_confirmed boolean not null default false;

comment on column public.package_cost_layers.unit_cost_confirmed is
  'True when a zero unit cost is the real buy price. Unconfirmed zeros stay out of profit and loss.';

create index if not exists package_cost_layers_awaiting_buy_price_idx
  on public.package_cost_layers (purchase_order_id)
  where purchase_order_id is not null
    and unit_cost = 0
    and unit_cost_confirmed = false;

create or replace function public.admin_set_cost_layer_buy_price_confirmed(
  p_layer_id uuid,
  p_confirmed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer public.package_cost_layers%rowtype;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_layer
  from public.package_cost_layers layer
  where layer.id = p_layer_id
  for update;
  if not found then
    raise exception 'cost_layer_not_found';
  end if;

  if p_confirmed and v_layer.unit_cost is distinct from 0 then
    raise exception 'buy_price_already_recorded';
  end if;

  if p_confirmed and v_layer.purchase_order_id is null then
    raise exception 'purchase_order_required';
  end if;

  update public.package_cost_layers
  set unit_cost_confirmed = p_confirmed
  where id = p_layer_id;
end;
$$;

create or replace function public.admin_set_purchase_order_buy_price_confirmed(
  p_purchase_order_id uuid,
  p_confirmed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1 from public.purchase_orders purchase where purchase.id = p_purchase_order_id
  ) then
    raise exception 'purchase_order_not_found';
  end if;

  update public.package_cost_layers
  set unit_cost_confirmed = p_confirmed
  where purchase_order_id = p_purchase_order_id
    and unit_cost = 0;

  get diagnostics v_updated = row_count;

  if p_confirmed and v_updated = 0 then
    raise exception 'no_zero_buy_price';
  end if;
end;
$$;

revoke all on function public.admin_set_cost_layer_buy_price_confirmed(uuid, boolean) from public;
grant execute on function public.admin_set_cost_layer_buy_price_confirmed(uuid, boolean)
  to authenticated, service_role;

revoke all on function public.admin_set_purchase_order_buy_price_confirmed(uuid, boolean) from public;
grant execute on function public.admin_set_purchase_order_buy_price_confirmed(uuid, boolean)
  to authenticated, service_role;
