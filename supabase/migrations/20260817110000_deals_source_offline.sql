-- Set every existing deal to offline. Website remains a valid source for new/edited deals.

update public.deals
set
  source = 'offline',
  updated_at = timezone('utc', now())
where source is distinct from 'offline';
