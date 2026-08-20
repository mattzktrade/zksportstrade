-- Rewrite legacy purchase-order numbers (invoice / contract / IMP-* grouping keys)
-- onto the uniform internal format PO-YYYYMMDD-XXXXXX. Keep the old value in
-- supplier_reference when that column is still empty.

update public.purchase_orders
set supplier_reference = btrim(po_number)
where coalesce(btrim(supplier_reference), '') = ''
  and btrim(po_number) <> ''
  and po_number !~ '^(PO-[0-9]{8}-|IMP-)';

do $$
declare
  r record;
  v_number text;
  v_n int;
  v_date text;
begin
  for r in
    select id, issued_at, created_at
    from public.purchase_orders
    where po_number !~ '^PO-[0-9]{8}-[A-Z0-9]{4,}$'
    order by created_at, id
  loop
    v_date := to_char(
      coalesce(r.issued_at, (r.created_at at time zone 'utc')::date),
      'YYYYMMDD'
    );
    v_n := 0;
    loop
      v_number := 'PO-' || v_date || '-' || upper(substr(md5(r.id::text || ':' || v_n::text), 1, 6));
      exit when not exists (
        select 1
        from public.purchase_orders
        where lower(btrim(po_number)) = lower(v_number)
          and id <> r.id
      );
      v_n := v_n + 1;
    end loop;

    update public.purchase_orders
    set po_number = v_number,
        updated_at = timezone('utc', now())
    where id = r.id;
  end loop;
end;
$$;
