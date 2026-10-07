-- Sales list remaining qty is purchased cost-layer units minus confirmed sales.
-- Cost layers were admin/finance-only, so a sales login still saw every deal
-- they sold but none of the stock we bought. Net then became 0 - sold, which
-- looks like a list of sold units (0s and red negatives) instead of stock
-- available to sell. inventory.view already covers this; writes stay on
-- admin/finance RPCs.

drop policy if exists "package_cost_layers_select_admin" on public.package_cost_layers;
drop policy if exists "package_cost_layers_select_cms_staff" on public.package_cost_layers;
create policy "package_cost_layers_select_cms_staff"
  on public.package_cost_layers for select
  using (public.has_cms_permission('inventory.view'));
