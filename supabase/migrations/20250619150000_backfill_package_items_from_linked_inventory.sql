-- Backfill package_items from linked inventory groups for Salesforce Package Items sync.

insert into public.package_items (
  parent_package_id,
  child_package_id,
  quantity_per_parent,
  sort_order
)
select
  parent.id as parent_package_id,
  child.id as child_package_id,
  1 as quantity_per_parent,
  case child.duration
    when 'friday_only' then 10
    when 'saturday_only' then 20
    when 'sunday_only' then 30
    else 0
  end as sort_order
from public.packages parent
join public.packages child
  on child.inventory_group_id = parent.inventory_group_id
 and child.id <> parent.id
where parent.inventory_group_id is not null
  and (
    (parent.duration = '3_day' and child.duration in ('friday_only', 'saturday_only', 'sunday_only'))
    or
    (parent.duration = '2_day' and child.duration in ('saturday_only', 'sunday_only'))
  )
on conflict (parent_package_id, child_package_id)
do update set
  quantity_per_parent = excluded.quantity_per_parent,
  sort_order = excluded.sort_order,
  updated_at = timezone('utc', now());
