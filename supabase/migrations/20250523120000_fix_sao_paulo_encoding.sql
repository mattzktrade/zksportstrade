-- Fix corrupted "São Paulo" text (often stored as S?o / replacement char).
UPDATE public.races
SET
  name = 'São Paulo Grand Prix',
  location = 'São Paulo'
WHERE id LIKE 'brazil-%';

UPDATE public.packages
SET
  circuit = 'São Paulo Grand Prix',
  location = 'São Paulo'
WHERE race_id LIKE 'brazil-%';
