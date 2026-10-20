-- Polythene Business Manager — Supabase SQL schema
-- Run in Supabase Dashboard → SQL Editor → New query.
-- Apply to a NEW project. Review this script before using it for real financial records.
create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('owner','mother','staff');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.app_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  pieces_per_bundle numeric(12,2) not null default 1 check (pieces_per_bundle > 0),
  stock_pieces numeric(14,2) not null default 0 check (stock_pieces >= 0),
  cost_per_piece numeric(14,2) not null default 0 check (cost_per_piece >= 0),
  selling_price_per_piece numeric(14,2) not null default 0 check (selling_price_per_piece >= 0),
  reorder_level numeric(14,2) not null default 0 check (reorder_level >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_no text not null unique,
  supplier_name text not null,
  purchase_date date not null default current_date,
  total_amount numeric(14,2) not null check(total_amount >= 0),
  amount_paid numeric(14,2) not null default 0 check(amount_paid >= 0 and amount_paid <= total_amount),
  payment_status text generated always as (
    case when amount_paid = 0 then 'unpaid'
         when amount_paid < total_amount then 'partial'
         else 'paid' end
  ) stored,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_no text not null unique,
  customer_name text not null default 'Walk-in',
  sale_date date not null default current_date,
  total_amount numeric(14,2) not null check(total_amount >= 0),
  amount_paid numeric(14,2) not null default 0 check(amount_paid >= 0 and amount_paid <= total_amount),
  payment_method text not null default 'cash' check(payment_method in ('cash','credit','mobile_money')),
  payment_status text generated always as (
    case when amount_paid = 0 then 'unpaid'
         when amount_paid < total_amount then 'partial'
         else 'paid' end
  ) stored,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null default 'Other',
  description text,
  amount numeric(14,2) not null check(amount > 0),
  paid_by text not null default 'business' check(paid_by in ('owner','mother','business')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_date date not null default current_date,
  party_name text not null,
  payment_type text not null check(payment_type in ('customer_receipt','supplier_payment')),
  method text not null default 'cash' check(method in ('cash','mobile_money','bank','other')),
  amount numeric(14,2) not null check(amount > 0),
  reference text,
  sale_id uuid references public.sales(id),
  purchase_id uuid references public.purchases(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check ((sale_id is not null)::int + (purchase_id is not null)::int <= 1)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  movement_type text not null check(movement_type in ('opening','purchase','sale','adjustment','return')),
  quantity_pieces numeric(14,2) not null,
  unit_cost numeric(14,2) not null default 0,
  reference text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists products_name_idx on public.products(name);
create index if not exists sales_date_idx on public.sales(sale_date);
create index if not exists purchases_date_idx on public.purchases(purchase_date);
create index if not exists expenses_date_idx on public.expenses(expense_date);
create index if not exists payments_date_idx on public.payments(payment_date);

-- Automatically create a profile after a user is created in Supabase Auth.
-- New accounts default to staff and must be promoted by the owner using SQL.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id,full_name,role,active)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name',''), 'staff', true)
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active=true);
$$;
create or replace function public.current_app_role()
returns text language sql stable security definer set search_path=public
as $$
  select p.role::text from public.profiles p where p.id=auth.uid() and p.active=true;
$$;

-- Basic purchase/sale capture RPCs. These capture totals/debts but do not alter item stock.
-- For stock-accurate profit, record item-level lines and stock movements in the next version.
create or replace function public.record_simple_purchase(
  p_supplier_name text, p_purchase_date date, p_total_amount numeric,
  p_amount_paid numeric default 0, p_notes text default null
) returns uuid language plpgsql security invoker set search_path=public
as $$
declare v_id uuid; v_no text;
begin
  if not public.is_active_user() then raise exception 'Active user required'; end if;
  if p_total_amount < 0 or p_amount_paid < 0 or p_amount_paid > p_total_amount then raise exception 'Invalid purchase amounts'; end if;
  v_no := 'PUR-' || to_char(clock_timestamp(),'YYMMDD-HH24MISS-MS');
  insert into public.purchases(purchase_no,supplier_name,purchase_date,total_amount,amount_paid,notes,created_by)
  values(trim(p_supplier_name),p_purchase_date,p_total_amount,p_amount_paid,p_notes,auth.uid())
  returning id into v_id;
  update public.purchases set purchase_no=v_no where id=v_id;
  if p_amount_paid > 0 then
    insert into public.payments(party_name,payment_type,method,amount,purchase_id,created_by)
    values(trim(p_supplier_name),'supplier_payment','cash',p_amount_paid,v_id,auth.uid());
  end if;
  return v_id;
end;
$$;

create or replace function public.record_simple_sale(
  p_customer_name text, p_sale_date date, p_total_amount numeric,
  p_amount_paid numeric default 0, p_payment_method text default 'cash', p_notes text default null
) returns uuid language plpgsql security invoker set search_path=public
as $$
declare v_id uuid; v_no text;
begin
  if not public.is_active_user() then raise exception 'Active user required'; end if;
  if p_total_amount < 0 or p_amount_paid < 0 or p_amount_paid > p_total_amount then raise exception 'Invalid sale amounts'; end if;
  if p_payment_method not in ('cash','credit','mobile_money') then raise exception 'Invalid payment method'; end if;
  v_no := 'SAL-' || to_char(clock_timestamp(),'YYMMDD-HH24MISS-MS');
  insert into public.sales(sale_no,customer_name,sale_date,total_amount,amount_paid,payment_method,notes,created_by)
  values(v_no,coalesce(nullif(trim(p_customer_name),''),'Walk-in'),p_sale_date,p_total_amount,p_amount_paid,p_payment_method,p_notes,auth.uid())
  returning id into v_id;
  if p_amount_paid > 0 then
    insert into public.payments(party_name,payment_type,method,amount,sale_id,created_by)
    values(coalesce(nullif(trim(p_customer_name),''),'Walk-in'),'customer_receipt',
      case when p_payment_method='mobile_money' then 'mobile_money' else 'cash' end,p_amount_paid,v_id,auth.uid());
  end if;
  return v_id;
end;
$$;

-- RLS: all active authenticated users can use business records; user management is owner-only.
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.purchases enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;
alter table public.payments enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "profiles read own or owner" on public.profiles;
create policy "profiles read own or owner" on public.profiles for select to authenticated
using (id=auth.uid() or public.current_app_role()='owner');
drop policy if exists "owner update profiles" on public.profiles;
create policy "owner update profiles" on public.profiles for update to authenticated
using (public.current_app_role()='owner') with check (public.current_app_role()='owner');

do $$
declare t text;
begin
  foreach t in array array['products','purchases','sales','expenses','payments','stock_movements'] loop
    execute format('drop policy if exists "active users read %1$s" on public.%1$I',t);
    execute format('create policy "active users read %1$s" on public.%1$I for select to authenticated using (public.is_active_user())',t);
    execute format('drop policy if exists "active users insert %1$s" on public.%1$I',t);
    execute format('create policy "active users insert %1$s" on public.%1$I for insert to authenticated with check (public.is_active_user())',t);
    execute format('drop policy if exists "active users update %1$s" on public.%1$I',t);
    execute format('create policy "active users update %1$s" on public.%1$I for update to authenticated using (public.is_active_user()) with check (public.is_active_user())',t);
    execute format('drop policy if exists "active users delete %1$s" on public.%1$I',t);
    execute format('create policy "active users delete %1$s" on public.%1$I for delete to authenticated using (public.is_active_user())',t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select,insert,update,delete on public.products,public.purchases,public.sales,public.expenses,public.payments,public.stock_movements to authenticated;
grant select,update on public.profiles to authenticated;
grant execute on function public.record_simple_purchase(text,date,numeric,numeric,text) to authenticated;
grant execute on function public.record_simple_sale(text,date,numeric,numeric,text,text) to authenticated;

-- IMPORTANT: After creating the owner's auth account, run:
-- update public.profiles set full_name='Eddy', role='owner', active=true where id='OWNER-USER-UUID';
-- Create your mother's account in Authentication, then run:
-- update public.profiles set full_name='Mother', role='mother', active=true where id='MOTHER-USER-UUID';
-- Replace UUIDs with actual user IDs from Authentication → Users.
