-- Hidden products stay off the agent portal and website. Staff can still
-- attach them to deals and leads, for internal stock such as parking passes.

comment on column public.packages.is_hidden is
  'When true, the product is omitted from the agent portal and website. Staff can still find it when adding a deal.';

update public.packages
set sell_on_trade_portal = false,
    sell_on_wix = false
where is_hidden = true
  and (
    sell_on_trade_portal is distinct from false
    or sell_on_wix is distinct from false
  );

do $$
declare
  r record;
  def text;
  next_def text;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_create_deal_with_lines',
        'admin_create_deal_with_existing_links',
        'admin_create_crm_lead'
      )
  loop
    def := pg_get_functiondef(r.sig);
    next_def := replace(def, ' and is_hidden = false', '');
    next_def := replace(next_def, ' and p.is_hidden = false', '');
    next_def := replace(next_def, ' and coalesce(is_hidden, false) = false', '');
    if next_def is distinct from def then
      execute next_def;
    end if;
  end loop;
end;
$$;
