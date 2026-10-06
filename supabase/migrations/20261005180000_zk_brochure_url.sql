-- ZK-branded sales brochure (white-label pages plus a closing contact page).
-- Portal agents keep using brochure_url; staff download zk_brochure_url from Sales list.

alter table public.packages add column if not exists zk_brochure_url text;

comment on column public.packages.zk_brochure_url is
  'HTTPS URL to the ZK-branded sales brochure PDF. Same inner pages as brochure_url, plus a closing page with the ZK lockup and office contact details. Not shown on the agent portal.';
