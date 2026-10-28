-- Call attempts on enquiries (marketing lead call cadence), a per-enrollment
-- WhatsApp block for wrong numbers, and a backfill so marketing leads that the
-- sequence moved to Contacted on its own go back to New until a person connects.

create table if not exists public.enquiry_call_attempts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  attempt_no integer not null,
  outcome text not null,
  lost_reason text,
  notes text,
  callback_at timestamptz,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint enquiry_call_attempts_attempt_check check (attempt_no >= 1 and attempt_no <= 50),
  constraint enquiry_call_attempts_outcome_check check (
    outcome in (
      'connected_interested',
      'connected_callback',
      'connected_not_interested',
      'connected_booked',
      'no_answer',
      'voicemail',
      'busy',
      'wrong_number',
      'do_not_contact',
      'unqualified'
    )
  ),
  constraint enquiry_call_attempts_lost_reason_check check (
    lost_reason is null
    or lost_reason in ('price', 'dates', 'other_provider', 'browsing', 'booked_direct', 'other')
  )
);

create index if not exists enquiry_call_attempts_deal_idx
  on public.enquiry_call_attempts (deal_id, created_at desc);

create index if not exists enquiry_call_attempts_created_idx
  on public.enquiry_call_attempts (created_at desc);

alter table public.enquiry_call_attempts enable row level security;

drop policy if exists "enquiry_call_attempts_staff_select" on public.enquiry_call_attempts;
create policy "enquiry_call_attempts_staff_select"
  on public.enquiry_call_attempts for select
  using (public.is_cms_staff());

drop policy if exists "enquiry_call_attempts_staff_insert" on public.enquiry_call_attempts;
create policy "enquiry_call_attempts_staff_insert"
  on public.enquiry_call_attempts for insert
  with check (public.has_cms_permission('deals.manage'));

grant select, insert on table public.enquiry_call_attempts to authenticated;
grant all on table public.enquiry_call_attempts to service_role;

comment on table public.enquiry_call_attempts is
  'One row per phone call attempt on an enquiry, with the outcome staff logged.';

alter table public.marketing_outreach_enrollments
  add column if not exists whatsapp_blocked boolean not null default false;

comment on column public.marketing_outreach_enrollments.whatsapp_blocked is
  'Staff logged a wrong number. WhatsApp stages are skipped; email continues.';

update public.deals d
set enquiry_stage = 'new',
    next_action = 'Make contact',
    updated_at = timezone('utc', now())
where d.source = 'marketing'
  and d.enquiry_stage = 'contacted'
  and d.stage = 'draft'
  and exists (
    select 1 from public.marketing_outreach_enrollments e
    where e.deal_id = d.id and e.status = 'active'
  )
  and not exists (
    select 1 from public.deal_activities a
    where a.deal_id = d.id
      and a.actor_profile_id is not null
      and a.action in ('enquiry_stage_changed', 'workflow_updated', 'stage_changed')
  );
