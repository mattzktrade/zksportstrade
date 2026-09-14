-- Keep marketing follow-up off until the team approve copy and the sending accounts.

update public.marketing_outreach_settings
set enabled = false, updated_at = timezone('utc', now())
where sequence_key = 'marketing_leads'
  and enabled is distinct from false;
