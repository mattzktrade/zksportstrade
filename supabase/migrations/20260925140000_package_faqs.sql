-- Product FAQs for the agent knowledge base. Empty answers are staff to fill.

alter table public.packages
  add column if not exists faqs jsonb not null default '[]'::jsonb;

comment on column public.packages.faqs is
  'Product and race questions for agents. Each item is {id, question, answer}. Blank answers are waiting for staff.';
