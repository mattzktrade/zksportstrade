-- Point Portugal and Turkey 2027 races (and any enquire packages) at the new circuit images.

update public.races
set image = '/images/circuits/portugal.png'
where id = 'portugal-2027';

update public.races
set image = '/images/circuits/istanbul.png'
where id = 'turkey-2027';

update public.packages
set image = '/images/circuits/portugal.png'
where race_id = 'portugal-2027';

update public.packages
set image = '/images/circuits/istanbul.png'
where race_id = 'turkey-2027';
