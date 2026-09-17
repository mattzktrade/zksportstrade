-- Circuit / track map image used on the product page and on brochure page 3.

alter table public.packages
  add column if not exists track_map text;

comment on column public.packages.track_map is
  'HTTPS or site-relative URL to a circuit track map. When set, the sales brochure adds a third page with this image.';
