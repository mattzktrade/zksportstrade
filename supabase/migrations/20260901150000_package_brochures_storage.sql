-- Public generated sales brochures. Reads are public so the attached
-- brochure_url can be downloaded from the portal after an admin creates it.
-- Writes go through the service-role action; portal clients cannot generate.

insert into storage.buckets (id, name, public)
values ('package-brochures', 'package-brochures', true)
on conflict (id) do update set public = true;

drop policy if exists "package_brochures_public_read" on storage.objects;
create policy "package_brochures_public_read"
  on storage.objects for select
  using (bucket_id = 'package-brochures');

drop policy if exists "package_brochures_admin_insert" on storage.objects;
create policy "package_brochures_admin_insert"
  on storage.objects for insert
  with check (bucket_id = 'package-brochures' and public.is_cms_staff());

drop policy if exists "package_brochures_admin_update" on storage.objects;
create policy "package_brochures_admin_update"
  on storage.objects for update
  using (bucket_id = 'package-brochures' and public.is_cms_staff())
  with check (bucket_id = 'package-brochures' and public.is_cms_staff());

drop policy if exists "package_brochures_admin_delete" on storage.objects;
create policy "package_brochures_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'package-brochures' and public.is_cms_staff());
