-- Allow cron / service-role jobs to apply linked inventory adjustments when
-- Salesforce offline sales reduce Available Quantity on Product2.

grant execute on function public.adjust_linked_inventory_available(text, int) to service_role;
grant execute on function public.reconcile_linked_multi_day_inventory(text) to service_role;
