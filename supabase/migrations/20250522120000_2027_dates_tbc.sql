-- Portal shows "Dates TBC" for the 2027 season; align existing seeded rows.
UPDATE public.races SET date_range = 'Dates TBC' WHERE season = 2027;
UPDATE public.packages SET date_range = 'Dates TBC' WHERE race_id LIKE '%-2027';
