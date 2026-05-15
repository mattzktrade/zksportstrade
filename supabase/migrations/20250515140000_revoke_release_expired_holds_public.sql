-- Hold release is invoked from place_order (security definer), not by clients via PostgREST.
revoke execute on function public.release_expired_inventory_holds() from anon;
revoke execute on function public.release_expired_inventory_holds() from authenticated;
