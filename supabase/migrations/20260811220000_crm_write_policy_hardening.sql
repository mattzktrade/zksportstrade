-- Keep CRM read access available to all CMS staff while enforcing the same
-- role permissions at the database boundary as the application actions.

drop policy if exists "crm_accounts_staff_all" on public.crm_accounts;
create policy "crm_accounts_staff_select"
  on public.crm_accounts for select
  using (public.is_cms_staff());
create policy "crm_accounts_manager_insert"
  on public.crm_accounts for insert
  with check (public.has_cms_permission('accounts.manage'));
create policy "crm_accounts_manager_update"
  on public.crm_accounts for update
  using (public.has_cms_permission('accounts.manage'))
  with check (public.has_cms_permission('accounts.manage'));
create policy "crm_accounts_manager_delete"
  on public.crm_accounts for delete
  using (public.has_cms_permission('accounts.manage'));

drop policy if exists "crm_contacts_staff_all" on public.crm_contacts;
create policy "crm_contacts_staff_select"
  on public.crm_contacts for select
  using (public.is_cms_staff());
create policy "crm_contacts_manager_insert"
  on public.crm_contacts for insert
  with check (public.has_cms_permission('accounts.manage'));
create policy "crm_contacts_manager_update"
  on public.crm_contacts for update
  using (public.has_cms_permission('accounts.manage'))
  with check (public.has_cms_permission('accounts.manage'));
create policy "crm_contacts_manager_delete"
  on public.crm_contacts for delete
  using (public.has_cms_permission('accounts.manage'));

drop policy if exists "crm_leads_staff_all" on public.crm_leads;
create policy "crm_leads_staff_select"
  on public.crm_leads for select
  using (public.is_cms_staff());
create policy "crm_leads_manager_insert"
  on public.crm_leads for insert
  with check (public.has_cms_permission('accounts.manage'));
create policy "crm_leads_manager_update"
  on public.crm_leads for update
  using (public.has_cms_permission('accounts.manage'))
  with check (public.has_cms_permission('accounts.manage'));
create policy "crm_leads_manager_delete"
  on public.crm_leads for delete
  using (public.has_cms_permission('accounts.manage'));

drop policy if exists "crm_lead_activities_staff_all" on public.crm_lead_activities;
create policy "crm_lead_activities_staff_select"
  on public.crm_lead_activities for select
  using (public.is_cms_staff());
create policy "crm_lead_activities_manager_insert"
  on public.crm_lead_activities for insert
  with check (public.has_cms_permission('accounts.manage'));

drop policy if exists "deals_staff_all" on public.deals;
create policy "deals_staff_select"
  on public.deals for select
  using (public.is_cms_staff());
create policy "deals_manager_insert"
  on public.deals for insert
  with check (public.has_cms_permission('deals.manage'));
create policy "deals_manager_update"
  on public.deals for update
  using (public.has_cms_permission('deals.manage'))
  with check (public.has_cms_permission('deals.manage'));
create policy "deals_manager_delete"
  on public.deals for delete
  using (public.has_cms_permission('deals.manage'));

drop policy if exists "deal_line_items_staff_all" on public.deal_line_items;
create policy "deal_line_items_staff_select"
  on public.deal_line_items for select
  using (public.is_cms_staff());
create policy "deal_line_items_manager_insert"
  on public.deal_line_items for insert
  with check (public.has_cms_permission('deals.manage'));
create policy "deal_line_items_manager_update"
  on public.deal_line_items for update
  using (public.has_cms_permission('deals.manage'))
  with check (public.has_cms_permission('deals.manage'));
create policy "deal_line_items_manager_delete"
  on public.deal_line_items for delete
  using (public.has_cms_permission('deals.manage'));

drop policy if exists "deal_activities_staff_all" on public.deal_activities;
create policy "deal_activities_staff_select"
  on public.deal_activities for select
  using (public.is_cms_staff());
create policy "deal_activities_manager_insert"
  on public.deal_activities for insert
  with check (public.has_cms_permission('deals.manage'));

