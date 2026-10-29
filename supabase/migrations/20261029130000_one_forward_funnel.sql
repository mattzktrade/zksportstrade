-- One forward-only funnel: "responded" folds into "contacted" (In conversation) and
-- "price_sent" folds into "follow_up" (Deciding). Due dates are kept so the cron does
-- not fire a burst of reminders. The stage constraint keeps both old values for history.

with moved as (
  update public.deals d
  set
    enquiry_stage = case d.enquiry_stage when 'responded' then 'contacted' else 'follow_up' end,
    stage = case d.enquiry_stage when 'price_sent' then 'proposal' else d.stage end,
    -- Deciding leads with no date would never be reminded; give them one check-in at 10:00 Dubai tomorrow.
    next_action_due_at = case
      when d.enquiry_stage = 'price_sent' and d.next_action_due_at is null
        then (date_trunc('day', now() at time zone 'Asia/Dubai') + interval '1 day 10 hours') at time zone 'Asia/Dubai'
      else d.next_action_due_at
    end,
    next_action = case
      when d.enquiry_stage = 'price_sent' and nullif(btrim(d.next_action), '') is null then 'Follow up'
      else d.next_action
    end,
    updated_at = now()
  where d.enquiry_stage in ('responded', 'price_sent')
    and d.stage in ('draft', 'sourcing', 'proposal')
  returning d.id, case d.enquiry_stage when 'contacted' then 'responded' else 'price_sent' end as previous, d.enquiry_stage
)
insert into public.deal_activities (deal_id, actor_profile_id, action, summary, metadata)
select
  moved.id,
  null,
  'enquiry_stage_changed',
  case moved.enquiry_stage
    when 'contacted' then 'Moved to In conversation (Responded merged into it)'
    else 'Moved to Deciding (Price sent merged into it)'
  end,
  jsonb_build_object('from', moved.previous, 'to', moved.enquiry_stage, 'migration', 'one_forward_funnel')
from moved;
