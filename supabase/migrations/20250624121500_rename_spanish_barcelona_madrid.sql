-- 2026 naming correction:
-- - Madrid is the Spanish Grand Prix.
-- - The former Spanish Grand Prix at Barcelona is the Barcelona Grand Prix.

update public.races
set name = 'Barcelona Grand Prix',
    short_name = 'Barcelona'
where id = 'spain-2026';

update public.races
set name = 'Spanish Grand Prix',
    short_name = 'Spain'
where id = 'madrid-2026';

update public.packages
set circuit = 'Barcelona Grand Prix'
where race_id = 'spain-2026'
  and circuit = 'Spanish Grand Prix';

update public.packages
set circuit = 'Spanish Grand Prix'
where race_id = 'madrid-2026'
  and circuit = 'Madrid Grand Prix';
