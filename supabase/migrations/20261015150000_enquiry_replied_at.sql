-- First client reply on WhatsApp or email. Independent of enquiry_stage so
-- Price sent / Follow-up still show that they replied, for response-rate later.

alter table public.deals
  add column if not exists enquiry_replied_at timestamptz;

comment on column public.deals.enquiry_replied_at is
  'First client WhatsApp or email reply. Stays set after the enquiry stage moves on.';

create index if not exists deals_enquiry_replied_at_idx
  on public.deals (enquiry_replied_at)
  where enquiry_replied_at is not null;

-- People currently sitting on Responded have already come back.
update public.deals
set enquiry_replied_at = coalesce(updated_at, now())
where enquiry_replied_at is null
  and enquiry_stage = 'responded';
