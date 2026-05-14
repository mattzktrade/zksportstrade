-- Optional marketing brochure (PDF or landing page) per package for trade agents
alter table public.packages add column if not exists brochure_url text;

comment on column public.packages.brochure_url is 'HTTPS URL to brochure PDF or page; shown in portal when set.';
