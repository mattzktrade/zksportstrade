-- Agent mobile / contact number for urgent outreach
alter table public.profiles
  add column if not exists mobile text not null default '';
