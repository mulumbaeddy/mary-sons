-- Run this once in the Supabase SQL editor.
-- Lets you delete a product when no active sale or purchase still uses it.
-- Its stock history (opening stock, reversed sales/purchases, adjustments) is removed with it.
create or replace function public.delete_product(p_product_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare v_ref text;
begin
  if not public.has_role(array['owner','mother']) then raise exception 'Only the owner or partner can delete products'; end if;

  select m.reference into v_ref from public.stock_movements m
   where m.product_id = p_product_id and m.movement_type = 'sale'
     and exists (select 1 from public.sales s where s.sale_no = m.reference) limit 1;
  if v_ref is not null then raise exception 'This product is used in sale % . Cancel that sale first.', v_ref; end if;

  select m.reference into v_ref from public.stock_movements m
   where m.product_id = p_product_id and m.movement_type = 'purchase'
     and exists (select 1 from public.purchases p where p.purchase_no = m.reference) limit 1;
  if v_ref is not null then raise exception 'This product is used in purchase % . Cancel that purchase first.', v_ref; end if;

  delete from public.stock_movements where product_id = p_product_id;
  delete from public.products where id = p_product_id;
end $$;
grant execute on function public.delete_product(uuid) to authenticated;
