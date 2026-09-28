-- Split the deal source "offline" into WhatsApp and Email.
-- Existing offline deals become WhatsApp. A before-trigger keeps any later
-- offline write on that same path so stored rows stay on the new values.

alter table public.deals
  drop constraint if exists deals_source_check;

update public.deals
set source = 'whatsapp'
where source = 'offline';

alter table public.deals
  alter column source set default 'whatsapp';

create or replace function public.deals_rewrite_legacy_offline_source()
returns trigger
language plpgsql
as $$
begin
  if NEW.source is null or btrim(NEW.source) = '' or NEW.source = 'offline' then
    NEW.source := 'whatsapp';
  end if;
  return NEW;
end;
$$;

drop trigger if exists deals_rewrite_legacy_offline_source on public.deals;
create trigger deals_rewrite_legacy_offline_source
before insert or update of source on public.deals
for each row
execute function public.deals_rewrite_legacy_offline_source();

alter table public.deals
  add constraint deals_source_check
  check (source in ('whatsapp', 'email', 'portal', 'website', 'referral', 'other', 'marketing'));

comment on column public.deals.source is
  'Where the enquiry came from: whatsapp, email, portal, website, referral, marketing, or other.';

-- Widen the deal-source allow-lists inside existing functions, and stop new
-- deals defaulting to the retired offline value.
do $$
declare
  r record;
  def text;
  next_def text;
  old_with_marketing text := '''offline'', ''portal'', ''website'', ''referral'', ''other'', ''marketing''';
  old_without_marketing text := '''offline'', ''portal'', ''website'', ''referral'', ''other''';
  next_sources text := '''whatsapp'', ''email'', ''offline'', ''portal'', ''website'', ''referral'', ''other'', ''marketing''';
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    begin
      def := pg_get_functiondef(r.oid);
    exception
      when others then
        continue;
    end;

    next_def := def;
    if position(old_with_marketing in next_def) > 0 then
      next_def := replace(next_def, old_with_marketing, next_sources);
    elsif position(old_without_marketing in next_def) > 0 then
      next_def := replace(next_def, old_without_marketing, next_sources);
    end if;
    next_def := replace(
      next_def,
      'coalesce(nullif(btrim(p_source), ''''), ''offline'')',
      'case when nullif(btrim(p_source), '''') is null or lower(btrim(p_source)) = ''offline'' then ''whatsapp'' else btrim(p_source) end'
    );
    next_def := replace(
      next_def,
      'when v_lead.source = ''repeat_client'' then ''offline''',
      'when v_lead.source = ''repeat_client'' then ''whatsapp'''
    );
    next_def := replace(
      next_def,
      'when coalesce(v_order.channel, ''trade_portal'') = ''admin'' then ''offline''',
      'when coalesce(v_order.channel, ''trade_portal'') = ''admin'' then ''whatsapp'''
    );
    next_def := replace(
      next_def,
      'p_source text DEFAULT ''offline''::text',
      'p_source text DEFAULT ''whatsapp''::text'
    );
    next_def := replace(
      next_def,
      'p_source text default ''offline''',
      'p_source text default ''whatsapp'''
    );

    if next_def is distinct from def then
      execute next_def;
    end if;
  end loop;
end $$;
