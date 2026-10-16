insert into storage.buckets (id, name, public)
values ('assistant-whatsapp-media', 'assistant-whatsapp-media', false)
on conflict (id) do update set public = false;

drop policy if exists "assistant_whatsapp_media_staff_read" on storage.objects;
create policy "assistant_whatsapp_media_staff_read"
  on storage.objects for select
  using (bucket_id = 'assistant-whatsapp-media' and public.is_cms_staff());

drop policy if exists "assistant_whatsapp_media_staff_write" on storage.objects;
create policy "assistant_whatsapp_media_staff_write"
  on storage.objects for all
  using (bucket_id = 'assistant-whatsapp-media' and public.is_cms_staff())
  with check (bucket_id = 'assistant-whatsapp-media' and public.is_cms_staff());
