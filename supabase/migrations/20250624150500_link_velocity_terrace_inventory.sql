-- Link Abu Dhabi Velocity Terrace variants into one shared inventory pool.
-- Total shared stock should be 200 across 3-day, 2-day, Friday, Saturday, and Sunday variants.

update public.packages
set duration = case
      when name ~* '3\s*days?' then '3_day'
      when name ~* '2\s*days?' or name ~* 'saturday\s*(?:&|and)\s*sunday' then '2_day'
      when name ~* '^friday\b' or name ~* 'friday\s+only' then 'friday_only'
      when name ~* '^saturday\b' or name ~* 'saturday\s+only' then 'saturday_only'
      when name ~* '^sunday\b' or name ~* 'sunday\s+only' then 'sunday_only'
      else duration
    end,
    inventory_group_id = 'abudhabi-2026/velocity-terrace',
    total_capacity = greatest(total_capacity, 200)
where race_id = 'abudhabi-2026'
  and name ilike '%velocity terrace%';

insert into public.package_inventory (package_id, qty_available, qty_held)
select id, 0, 0
from public.packages
where race_id = 'abudhabi-2026'
  and name ilike '%velocity terrace%'
on conflict (package_id) do nothing;

update public.package_inventory pi
set qty_available = 200,
    qty_held = 0
from public.packages p
where pi.package_id = p.id
  and p.race_id = 'abudhabi-2026'
  and p.name ilike '%velocity terrace%';

select public.reconcile_linked_multi_day_inventory('abudhabi-2026/velocity-terrace');
select public.reconcile_linked_inventory_holds('abudhabi-2026/velocity-terrace');

-- Ensure portal package-item rows exist so Salesforce package item sync can create/update SF child links.
insert into public.package_items (parent_package_id, child_package_id, quantity_per_parent, sort_order)
select parent.id, child.id, 1,
  case child.duration
    when 'friday_only' then 10
    when 'saturday_only' then 20
    when 'sunday_only' then 30
    else 0
  end
from public.packages parent
join public.packages child
  on child.inventory_group_id = parent.inventory_group_id
  and child.id <> parent.id
where parent.inventory_group_id = 'abudhabi-2026/velocity-terrace'
  and (
    (parent.duration = '3_day' and child.duration in ('friday_only', 'saturday_only', 'sunday_only'))
    or (parent.duration = '2_day' and child.duration in ('saturday_only', 'sunday_only'))
  )
on conflict (parent_package_id, child_package_id) do update
set quantity_per_parent = excluded.quantity_per_parent,
    sort_order = excluded.sort_order,
    updated_at = timezone('utc', now());
