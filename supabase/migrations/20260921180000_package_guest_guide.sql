-- Guest guide PDF (separate from the sales brochure) plus staff-edited page copy.

alter table public.packages
  add column if not exists guest_guide_url text,
  add column if not exists guest_guide jsonb;

comment on column public.packages.guest_guide_url is
  'Public URL of the generated guest guide PDF. Portal clients may download it; only CMS staff can create it.';

comment on column public.packages.guest_guide is
  'Staff-edited guest guide page copy used to generate the guest guide PDF.';
