-- Rich package copy + multiple image URLs for portal gallery
alter table public.packages add column if not exists description text not null default '';
alter table public.packages add column if not exists gallery_images jsonb not null default '[]'::jsonb;

comment on column public.packages.description is 'Marketing copy shown on the race package detail page.';
comment on column public.packages.gallery_images is 'JSON array of image URLs (https) shown after the primary image in the gallery.';
