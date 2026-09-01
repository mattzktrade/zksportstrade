-- Finance staff (e.g. Chelley) create deals and accounts as sales admin.
-- Sending a booking form to the client remains admin-only.

create or replace function public.has_cms_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (
          p.role = 'finance'
          and p_permission in (
            'cms.access',
            'finance.view',
            'finance.manage',
            'orders.view',
            'deals.view',
            'deals.manage',
            'accounts.manage',
            'inventory.view',
            'operations.view'
          )
        )
        or (
          p.role = 'sales'
          and p_permission in (
            'cms.access',
            'deals.view',
            'deals.manage',
            'accounts.manage',
            'inventory.view',
            'inventory.hold',
            'orders.view',
            'operations.view',
            'operations.manage'
          )
        )
      )
  );
$$;

grant execute on function public.has_cms_permission(text) to authenticated, anon;

comment on function public.has_cms_permission(text) is
  'Finance can manage deals and accounts. Only admin can send booking forms to clients.';
