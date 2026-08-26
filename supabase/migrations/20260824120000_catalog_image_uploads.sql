-- Public catalog images (event / package photos uploaded in admin).
-- Reads are public so the portal can show them. Writes go through the
-- service-role upload action.

insert into storage.buckets (id, name, public)
values ('catalog-images', 'catalog-images', true)
on conflict (id) do update set public = true;

drop policy if exists "catalog_images_public_read" on storage.objects;
create policy "catalog_images_public_read"
  on storage.objects for select
  using (bucket_id = 'catalog-images');

drop policy if exists "catalog_images_admin_insert" on storage.objects;
create policy "catalog_images_admin_insert"
  on storage.objects for insert
  with check (bucket_id = 'catalog-images' and public.is_admin());

drop policy if exists "catalog_images_admin_update" on storage.objects;
create policy "catalog_images_admin_update"
  on storage.objects for update
  using (bucket_id = 'catalog-images' and public.is_admin())
  with check (bucket_id = 'catalog-images' and public.is_admin());

drop policy if exists "catalog_images_admin_delete" on storage.objects;
create policy "catalog_images_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'catalog-images' and public.is_admin());
