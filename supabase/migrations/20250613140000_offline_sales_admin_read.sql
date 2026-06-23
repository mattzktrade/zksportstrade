-- Admins can read offline Salesforce sale records for inventory breakdown UI.

drop policy if exists "salesforce_offline_sale_applications_select_admin"
  on public.salesforce_offline_sale_applications;

create policy "salesforce_offline_sale_applications_select_admin"
  on public.salesforce_offline_sale_applications for select
  using (public.is_admin());

grant select on public.salesforce_offline_sale_applications to authenticated;
