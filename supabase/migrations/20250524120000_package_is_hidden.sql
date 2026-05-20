-- Allow admins to hide packages from the agent portal without deleting them.

alter table public.packages
  add column if not exists is_hidden boolean not null default false;

comment on column public.packages.is_hidden is
  'When true, package is omitted from the agent portal (admins still see and can edit it).';

create index if not exists packages_is_hidden_idx on public.packages (is_hidden) where is_hidden = true;

-- Agents: approved profiles only see visible packages. Admins see all.
drop policy if exists "packages_select_approved" on public.packages;

create policy "packages_select_approved"
  on public.packages for select
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or (
        not coalesce(is_hidden, false)
        and exists (
          select 1 from public.profiles pr
          where pr.id = auth.uid()
            and pr.approval_status = 'approved'
        )
      )
    )
  );

-- Hide 2027 season until ready to publish (reversible in admin catalog).
update public.packages
set is_hidden = true
where race_id like '%-2027';
