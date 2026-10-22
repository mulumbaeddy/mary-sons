-- =====================================================================
-- Polythene Business Manager — business logic, security and reports
-- Run AFTER 01_schema.sql (your original tables, unchanged).
-- Safe to re-run: everything uses create-or-replace / drop-if-exists.
-- This file does NOT alter, add or drop any table or column.
-- =====================================================================

-- ---------- helpers ---------------------------------------------------
create sequence if not exists public.sale_no_seq;
create sequence if not exists public.purchase_no_seq;

create or replace function public.has_role(roles text[])
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.current_app_role() = any(roles), false) $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
for each row execute function public.touch_updated_at();

-- ---------- remove the two broken original functions -----------------
-- (record_simple_purchase had 7 columns but only 6 values and always failed;
--  both ignored stock. Replaced by create_purchase / create_sale below.)
drop function if exists public.record_simple_purchase(text,date,numeric,numeric,text);
drop function if exists public.record_simple_sale(text,date,numeric,numeric,text,text);

-- ---------- products -------------------------------------------------
create or replace function public.create_product(
  p_name text, p_sku text, p_pieces_per_bundle numeric, p_opening_pieces numeric,
  p_cost numeric, p_price numeric, p_reorder numeric
) returns uuid language plpgsql security definer set search_path=public
as $$
declare v_id uuid;
begin
  if not public.has_role(array['owner','mother']) then raise exception 'Only the owner or partner can add products'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Product name is required'; end if;
  insert into public.products(name,sku,pieces_per_bundle,stock_pieces,cost_per_piece,selling_price_per_piece,reorder_level,created_by)
  values(trim(p_name), nullif(trim(p_sku),''), p_pieces_per_bundle, coalesce(p_opening_pieces,0),
         p_cost, p_price, coalesce(p_reorder,0), auth.uid())
  returning id into v_id;
  if coalesce(p_opening_pieces,0) > 0 then
    insert into public.stock_movements(product_id,movement_type,quantity_pieces,unit_cost,reference,notes,created_by)
    values(v_id,'opening',p_opening_pieces,p_cost,'OPENING','Opening stock',auth.uid());
  end if;
  return v_id;
end $$;

create or replace function public.adjust_stock(p_product_id uuid, p_new_pieces numeric, p_reason text)
returns void language plpgsql security definer set search_path=public
as $$
declare v_p public.products%rowtype;
begin
  if not public.has_role(array['owner','mother']) then raise exception 'Only the owner or partner can adjust stock'; end if;
  if p_new_pieces < 0 then raise exception 'Stock cannot be negative'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Please give a reason for the adjustment'; end if;
  select * into v_p from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if p_new_pieces = v_p.stock_pieces then return; end if;
  update public.products set stock_pieces = p_new_pieces where id = p_product_id;
  insert into public.stock_movements(product_id,movement_type,quantity_pieces,unit_cost,reference,notes,created_by)
  values(p_product_id,'adjustment',p_new_pieces - v_p.stock_pieces,v_p.cost_per_piece,'ADJUST',trim(p_reason),auth.uid());
end $$;

-- ---------- sales ----------------------------------------------------
-- (columns named "pieces" count PACKETS in this business)
-- p_items = [{"product_id": "...", "quantity_pieces": 200, "line_total": 30000}, ...]
-- Stock is locked, checked and reduced; cost at time of sale is kept for profit.
create or replace function public.create_sale(
  p_customer text, p_date date, p_method text, p_amount_paid numeric, p_notes text, p_items jsonb
) returns uuid language plpgsql security definer set search_path=public
as $$
declare
  v_id uuid; v_no text; v_total numeric; v_cust text; v_item jsonb;
  v_prod public.products%rowtype; v_qty numeric; v_line numeric;
begin
  if not public.is_active_user() then raise exception 'Active user required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the sale';
  end if;
  if p_method not in ('cash','credit','mobile_money') then raise exception 'Invalid payment method'; end if;
  select coalesce(sum((i->>'line_total')::numeric),0) into v_total from jsonb_array_elements(p_items) i;
  if v_total <= 0 then raise exception 'Sale total must be more than zero'; end if;
  if p_amount_paid < 0 or p_amount_paid > v_total then raise exception 'Amount paid must be between 0 and the sale total'; end if;

  v_cust := coalesce(nullif(trim(p_customer),''),'Walk-in');
  if p_method = 'credit' and v_cust = 'Walk-in' then raise exception 'Enter the customer name for a credit sale'; end if;
  v_no := 'SAL-' || lpad(nextval('public.sale_no_seq')::text, 5, '0');

  insert into public.sales(sale_no,customer_name,sale_date,total_amount,amount_paid,payment_method,notes,created_by)
  values(v_no,v_cust,coalesce(p_date,current_date),v_total,p_amount_paid,p_method,nullif(trim(p_notes),''),auth.uid())
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty  := (v_item->>'quantity_pieces')::numeric;
    v_line := (v_item->>'line_total')::numeric;
    if v_qty <= 0 or v_line < 0 then raise exception 'Invalid quantity or amount on a sale line'; end if;
    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid for update;
    if not found then raise exception 'A product on this sale no longer exists'; end if;
    if v_prod.stock_pieces < v_qty then
      raise exception 'Not enough stock for % (available: % pieces)', v_prod.name, v_prod.stock_pieces;
    end if;
    update public.products set stock_pieces = stock_pieces - v_qty where id = v_prod.id;
    insert into public.stock_movements(product_id,movement_type,quantity_pieces,unit_cost,reference,notes,created_by)
    values(v_prod.id,'sale',-v_qty,v_prod.cost_per_piece,v_no,jsonb_build_object('line_total',v_line)::text,auth.uid());
  end loop;

  if p_amount_paid > 0 then
    insert into public.payments(payment_date,party_name,payment_type,method,amount,reference,sale_id,created_by)
    values(coalesce(p_date,current_date),v_cust,'customer_receipt',
           case when p_method='mobile_money' then 'mobile_money' else 'cash' end,
           p_amount_paid,v_no,v_id,auth.uid());
  end if;
  return v_id;
end $$;

-- ---------- purchases ------------------------------------------------
-- p_items = [{"product_id": "...", "quantity_pieces": 5000, "line_total": 400000}, ...]
-- Adds stock and updates each product's cost using a weighted average.
create or replace function public.create_purchase(
  p_supplier text, p_date date, p_amount_paid numeric, p_notes text, p_items jsonb
) returns uuid language plpgsql security definer set search_path=public
as $$
declare
  v_id uuid; v_no text; v_total numeric; v_item jsonb;
  v_prod public.products%rowtype; v_qty numeric; v_line numeric;
begin
  if not public.has_role(array['owner','mother']) then raise exception 'Only the owner or partner can record purchases'; end if;
  if coalesce(trim(p_supplier),'') = '' then raise exception 'Supplier name is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the purchase';
  end if;
  select coalesce(sum((i->>'line_total')::numeric),0) into v_total from jsonb_array_elements(p_items) i;
  if v_total <= 0 then raise exception 'Purchase total must be more than zero'; end if;
  if p_amount_paid < 0 or p_amount_paid > v_total then raise exception 'Amount paid must be between 0 and the purchase total'; end if;

  v_no := 'PUR-' || lpad(nextval('public.purchase_no_seq')::text, 5, '0');
  insert into public.purchases(purchase_no,supplier_name,purchase_date,total_amount,amount_paid,notes,created_by)
  values(v_no,trim(p_supplier),coalesce(p_date,current_date),v_total,p_amount_paid,nullif(trim(p_notes),''),auth.uid())
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty  := (v_item->>'quantity_pieces')::numeric;
    v_line := (v_item->>'line_total')::numeric;
    if v_qty <= 0 or v_line < 0 then raise exception 'Invalid quantity or amount on a purchase line'; end if;
    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid for update;
    if not found then raise exception 'A product on this purchase no longer exists'; end if;
    update public.products
       set stock_pieces = stock_pieces + v_qty,
           cost_per_piece = round(((stock_pieces * cost_per_piece) + v_line) / (stock_pieces + v_qty), 2)
     where id = v_prod.id;
    insert into public.stock_movements(product_id,movement_type,quantity_pieces,unit_cost,reference,notes,created_by)
    values(v_prod.id,'purchase',v_qty,round(v_line / v_qty,2),v_no,jsonb_build_object('line_total',v_line)::text,auth.uid());
  end loop;

  if p_amount_paid > 0 then
    insert into public.payments(payment_date,party_name,payment_type,method,amount,reference,purchase_id,created_by)
    values(coalesce(p_date,current_date),trim(p_supplier),'supplier_payment','cash',p_amount_paid,v_no,v_id,auth.uid());
  end if;
  return v_id;
end $$;

-- ---------- later payments (debts) ----------------------------------
-- p_kind: 'sale' (customer pays us) or 'purchase' (we pay supplier)
create or replace function public.record_payment(
  p_kind text, p_id uuid, p_amount numeric, p_method text default 'cash',
  p_date date default current_date, p_reference text default null
) returns uuid language plpgsql security definer set search_path=public
as $$
declare v_pay uuid; v_s public.sales%rowtype; v_p public.purchases%rowtype;
begin
  if not public.is_active_user() then raise exception 'Active user required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero'; end if;
  if p_method not in ('cash','mobile_money','bank','other') then raise exception 'Invalid payment method'; end if;

  if p_kind = 'sale' then
    select * into v_s from public.sales where id = p_id for update;
    if not found then raise exception 'Sale not found'; end if;
    if p_amount > v_s.total_amount - v_s.amount_paid then
      raise exception 'Amount is more than the balance of %', (v_s.total_amount - v_s.amount_paid);
    end if;
    update public.sales set amount_paid = amount_paid + p_amount where id = p_id;
    insert into public.payments(payment_date,party_name,payment_type,method,amount,reference,sale_id,created_by)
    values(coalesce(p_date,current_date),v_s.customer_name,'customer_receipt',p_method,p_amount,
           coalesce(nullif(trim(p_reference),''),v_s.sale_no),p_id,auth.uid())
    returning id into v_pay;
  elsif p_kind = 'purchase' then
    if not public.has_role(array['owner','mother']) then raise exception 'Only the owner or partner can pay suppliers'; end if;
    select * into v_p from public.purchases where id = p_id for update;
    if not found then raise exception 'Purchase not found'; end if;
    if p_amount > v_p.total_amount - v_p.amount_paid then
      raise exception 'Amount is more than the balance of %', (v_p.total_amount - v_p.amount_paid);
    end if;
    update public.purchases set amount_paid = amount_paid + p_amount where id = p_id;
    insert into public.payments(payment_date,party_name,payment_type,method,amount,reference,purchase_id,created_by)
    values(coalesce(p_date,current_date),v_p.supplier_name,'supplier_payment',p_method,p_amount,
           coalesce(nullif(trim(p_reference),''),v_p.purchase_no),p_id,auth.uid())
    returning id into v_pay;
  else
    raise exception 'Unknown payment kind';
  end if;
  return v_pay;
end $$;

-- ---------- void (owner only) ---------------------------------------
create or replace function public.void_sale(p_sale_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare v_s public.sales%rowtype; m record;
begin
  if not public.has_role(array['owner']) then raise exception 'Only the owner can cancel a sale'; end if;
  select * into v_s from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  for m in select * from public.stock_movements where reference = v_s.sale_no and movement_type = 'sale' loop
    update public.products set stock_pieces = stock_pieces - m.quantity_pieces where id = m.product_id;  -- quantity is negative, so this adds stock back
    insert into public.stock_movements(product_id,movement_type,quantity_pieces,unit_cost,reference,notes,created_by)
    values(m.product_id,'return',-m.quantity_pieces,m.unit_cost,v_s.sale_no || '-VOID','Sale cancelled',auth.uid());
  end loop;
  delete from public.payments where sale_id = p_sale_id;
  delete from public.sales where id = p_sale_id;
end $$;

create or replace function public.void_purchase(p_purchase_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare v_p public.purchases%rowtype; m record; v_stock numeric;
begin
  if not public.has_role(array['owner']) then raise exception 'Only the owner can cancel a purchase'; end if;
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  for m in select * from public.stock_movements where reference = v_p.purchase_no and movement_type = 'purchase' loop
    select stock_pieces into v_stock from public.products where id = m.product_id for update;
    if v_stock < m.quantity_pieces then
      raise exception 'Cannot cancel: part of this stock has already been sold';
    end if;
    update public.products set stock_pieces = stock_pieces - m.quantity_pieces where id = m.product_id;
    insert into public.stock_movements(product_id,movement_type,quantity_pieces,unit_cost,reference,notes,created_by)
    values(m.product_id,'adjustment',-m.quantity_pieces,m.unit_cost,v_p.purchase_no || '-VOID','Purchase cancelled',auth.uid());
  end loop;
  delete from public.payments where purchase_id = p_purchase_id;
  delete from public.purchases where id = p_purchase_id;
end $$;

-- ---------- reports --------------------------------------------------
create or replace function public.report_summary(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare v jsonb;
begin
  if not public.has_role(array['owner','mother']) then raise exception 'Reports are available to the owner and partner only'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Choose a valid date range'; end if;
  select jsonb_build_object(
    'sales_total',     coalesce((select sum(total_amount) from public.sales where sale_date between p_from and p_to),0),
    'sales_count',     (select count(*) from public.sales where sale_date between p_from and p_to),
    'cash_received',   coalesce((select sum(amount) from public.payments where payment_type='customer_receipt' and payment_date between p_from and p_to),0),
    'cogs',            coalesce((select sum(-m.quantity_pieces * m.unit_cost) from public.stock_movements m
                                  join public.sales s on s.sale_no = m.reference
                                 where m.movement_type='sale' and s.sale_date between p_from and p_to),0),
    'purchases_total', coalesce((select sum(total_amount) from public.purchases where purchase_date between p_from and p_to),0),
    'purchases_count', (select count(*) from public.purchases where purchase_date between p_from and p_to),
    'supplier_paid',   coalesce((select sum(amount) from public.payments where payment_type='supplier_payment' and payment_date between p_from and p_to),0),
    'expenses_total',  coalesce((select sum(amount) from public.expenses where expense_date between p_from and p_to),0),
    'customer_debt',   coalesce((select sum(total_amount - amount_paid) from public.sales),0),
    'supplier_debt',   coalesce((select sum(total_amount - amount_paid) from public.purchases),0),
    'stock_value',     coalesce((select sum(stock_pieces * cost_per_piece) from public.products),0),
    'low_stock_count', (select count(*) from public.products where stock_pieces <= reorder_level),
    'daily', coalesce((select jsonb_agg(d order by d.day) from (
                select sale_date::text as day, sum(total_amount) as sales, count(*) as count
                  from public.sales where sale_date between p_from and p_to group by sale_date) d),'[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(t) from (
                select p.name, sum(-m.quantity_pieces) as pieces,
                       sum((m.notes::jsonb->>'line_total')::numeric) as revenue,
                       sum(-m.quantity_pieces * m.unit_cost) as cost
                  from public.stock_movements m
                  join public.sales s on s.sale_no = m.reference
                  join public.products p on p.id = m.product_id
                 where m.movement_type='sale' and s.sale_date between p_from and p_to
                 group by p.name order by revenue desc limit 10) t),'[]'::jsonb),
    'expenses_by_category', coalesce((select jsonb_agg(e) from (
                select category, sum(amount) as total from public.expenses
                 where expense_date between p_from and p_to group by category order by total desc) e),'[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ---------- user management (owner only) ----------------------------
create or replace function public.admin_list_users()
returns table(id uuid, email text, full_name text, role text, active boolean, created_at timestamptz)
language plpgsql stable security definer set search_path=public
as $$
begin
  if not public.has_role(array['owner']) then raise exception 'Owner only'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.role::text, p.active, p.created_at
      from public.profiles p join auth.users u on u.id = p.id
     order by p.created_at;
end $$;

create or replace function public.admin_update_user(p_id uuid, p_full_name text, p_role text, p_active boolean)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if not public.has_role(array['owner']) then raise exception 'Owner only'; end if;
  if p_role not in ('owner','mother','staff') then raise exception 'Invalid role'; end if;
  if p_id = auth.uid() and (p_role <> 'owner' or p_active = false) then
    raise exception 'You cannot remove your own owner access';
  end if;
  update public.profiles set full_name = trim(p_full_name), role = p_role::public.app_role, active = p_active where id = p_id;
end $$;

-- ---------- line-item views (use the caller's permissions) ----------
create or replace view public.v_sale_lines with (security_invoker = true) as
select m.id, s.id as sale_id, s.sale_no, m.product_id, p.name as product_name,
       -m.quantity_pieces as quantity_pieces, m.unit_cost,
       (m.notes::jsonb->>'line_total')::numeric as line_total
  from public.stock_movements m
  join public.sales s on s.sale_no = m.reference
  join public.products p on p.id = m.product_id
 where m.movement_type = 'sale';

create or replace view public.v_purchase_lines with (security_invoker = true) as
select m.id, pu.id as purchase_id, pu.purchase_no, m.product_id, p.name as product_name,
       m.quantity_pieces, m.unit_cost,
       (m.notes::jsonb->>'line_total')::numeric as line_total
  from public.stock_movements m
  join public.purchases pu on pu.purchase_no = m.reference
  join public.products p on p.id = m.product_id
 where m.movement_type = 'purchase';

-- ---------- row level security (tightened) --------------------------
-- All stock/money changes now go through the functions above, so the
-- browser can no longer edit stock, sales, purchases or payments directly.
do $$
declare t text; pol record;
begin
  foreach t in array array['products','purchases','sales','expenses','payments','stock_movements'] loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('create policy "read %1$s" on public.%1$I for select to authenticated using (public.is_active_user())', t);
  end loop;
end $$;

create policy "partner edit products"   on public.products for update to authenticated
  using (public.has_role(array['owner','mother'])) with check (public.has_role(array['owner','mother']));
create policy "owner delete products"   on public.products for delete to authenticated
  using (public.has_role(array['owner']));
create policy "active add expenses"     on public.expenses for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());
create policy "owner edit expenses"     on public.expenses for update to authenticated
  using (public.has_role(array['owner'])) with check (public.has_role(array['owner']));
create policy "owner delete expenses"   on public.expenses for delete to authenticated
  using (public.has_role(array['owner']));

revoke insert, update, delete on public.products, public.purchases, public.sales,
       public.payments, public.stock_movements, public.expenses, public.profiles from authenticated;
grant select on public.products, public.purchases, public.sales, public.payments,
       public.stock_movements, public.expenses, public.profiles to authenticated;
grant update (name, sku, pieces_per_bundle, cost_per_piece, selling_price_per_piece, reorder_level) on public.products to authenticated;
grant delete on public.products to authenticated;
grant insert, update, delete on public.expenses to authenticated;
grant select on public.v_sale_lines, public.v_purchase_lines to authenticated;

-- ---------- function permissions ------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'create_product(text,text,numeric,numeric,numeric,numeric,numeric)',
    'adjust_stock(uuid,numeric,text)',
    'create_sale(text,date,text,numeric,text,jsonb)',
    'create_purchase(text,date,numeric,text,jsonb)',
    'record_payment(text,uuid,numeric,text,date,text)',
    'void_sale(uuid)', 'void_purchase(uuid)',
    'report_summary(date,date)', 'admin_list_users()',
    'admin_update_user(uuid,text,text,boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
