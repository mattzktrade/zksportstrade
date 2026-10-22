alter table public.marketing_outreach_steps
  add column if not exists delay_minutes integer not null default 0;

alter table public.marketing_outreach_steps
  drop constraint if exists marketing_outreach_steps_delay_minutes_check;

alter table public.marketing_outreach_steps
  add constraint marketing_outreach_steps_delay_minutes_check
  check (delay_minutes >= 0 and delay_minutes < 60);

update public.marketing_outreach_steps
set delay_minutes = 5, updated_at = timezone('utc', now())
where sequence_key = 'marketing_leads'
  and stage = 1
  and delay_hours = 0
  and delay_minutes = 0;

comment on column public.marketing_outreach_steps.delay_minutes is
  'Extra wait on top of delay_hours. Stage 1 defaults to 5 minutes so the first message does not feel instant.';
