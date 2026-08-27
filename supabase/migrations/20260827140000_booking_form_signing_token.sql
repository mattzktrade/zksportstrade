alter table public.booking_forms
  add column if not exists client_signing_token text;

comment on column public.booking_forms.client_signing_token is
  'Current plaintext client signing token so staff can copy the same secure link for WhatsApp. Public signing still looks up by hash only.';
