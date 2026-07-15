-- Shell Single Ticket packages must never appear in the agent portal, even if is_hidden
-- is accidentally cleared. Admins still see everything via is_admin().

drop policy if exists "packages_select_approved" on public.packages;

create policy "packages_select_approved"
  on public.packages for select
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or (
        not coalesce(is_hidden, false)
        and shell_parent_package_id is null
        and exists (
          select 1 from public.profiles pr
          where pr.id = auth.uid()
            and pr.approval_status = 'approved'
        )
      )
    )
  );
