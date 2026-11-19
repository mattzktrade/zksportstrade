-- Expand races.category beyond F1 / tennis / football / concert / other.
-- Stored key for concerts stays `concert` so existing rows keep working.

alter table public.races
  drop constraint if exists races_category_check;

alter table public.races
  add constraint races_category_check
  check (category in (
    'formula_1',
    'football',
    'tennis',
    'cricket',
    'rugby',
    'concert',
    'nfl',
    'basketball',
    'baseball',
    'horse_racing',
    'motorsports',
    'boxing',
    'golf',
    'other'
  ));
