-- Align portal race naming with Salesforce: Brazilian Grand Prix (not São Paulo Grand Prix).

update public.races
set name = 'Brazilian Grand Prix',
    short_name = 'Brazil'
where id in ('brazil-2026', 'brazil-2027')
   or name in ('São Paulo Grand Prix', 'Sao Paulo Grand Prix');

update public.packages
set circuit = 'Brazilian Grand Prix'
where race_id in ('brazil-2026', 'brazil-2027')
  and circuit in ('São Paulo Grand Prix', 'Sao Paulo Grand Prix');
