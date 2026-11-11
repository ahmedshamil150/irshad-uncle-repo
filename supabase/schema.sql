-- Irshad Finance — Supabase schema
-- Run this ONCE in: Supabase Dashboard > SQL Editor > New query > Run
-- Safe to re-run (idempotent).

-- ============ EXTENSIONS ============
create extension if not exists pgcrypto;

-- ============ TABLES ============

create table if not exists public.sales (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  sale_date      date not null default current_date,
  customer_name  text not null,
  source         text not null check (source in ('office','dealer','salesman','reference')),
  salesman_name  text,
  item_description text,
  total_amount   numeric(14,2) not null check (total_amount >= 0),
  cash_amount    numeric(14,2) not null default 0 check (cash_amount >= 0),
  bank_amount    numeric(14,2) not null default 0 check (bank_amount >= 0),
  adjustment_amount numeric(14,2) not null default 0 check (adjustment_amount >= 0),
  adjustment_method text check (adjustment_method is null or adjustment_method in ('cash','bank')),
  adjustment_item   text,
  loan_amount    numeric(14,2) not null default 0 check (loan_amount >= 0),
  is_installment boolean not null default false,
  notes          text,
  constraint paid_within_total check (cash_amount + bank_amount + adjustment_amount + loan_amount <= total_amount + 0.009)
);

create table if not exists public.installments (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references public.sales(id) on delete cascade,
  installment_no  int not null,
  due_date        date not null,
  amount          numeric(14,2) not null check (amount > 0),
  unique (sale_id, installment_no)
);

create table if not exists public.payables (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  entry_date  date not null default current_date,
  party       text not null,
  amount      numeric(14,2) not null check (amount > 0),
  due_date    date,
  notes       text
);

create table if not exists public.salesmen (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null
);

-- Personal loans: money WE gave to someone (they pay us back).
create table if not exists public.personal_loans (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  loan_date   date not null default current_date,
  person      text not null,
  amount      numeric(14,2) not null check (amount > 0),
  due_date    date,
  returned_at timestamptz,
  notes       text
);

-- Expenses: money WE spent (shop running costs, salaries, bills…).
create table if not exists public.expenses (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entry_date date not null default current_date,
  title      text not null,
  payee      text,
  amount     numeric(14,2) not null check (amount > 0),
  notes      text
);

-- Purchases: things we bought (stock, machines, supplies…).
create table if not exists public.purchases (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entry_date date not null default current_date,
  title      text not null,
  supplier   text,
  amount     numeric(14,2) not null check (amount > 0),
  cash_amount numeric(14,2) not null default 0 check (cash_amount >= 0),
  bank_amount numeric(14,2) not null default 0 check (bank_amount >= 0),
  due_date    date,
  notes      text,
  mode       text not null default 'batch' check (mode in ('batch','local'))
);

-- Zakat: money given out as zakat.
create table if not exists public.zakat (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entry_date date not null default current_date,
  amount     numeric(14,2) not null check (amount > 0),
  notes      text
);

-- Cash in: money received from people (machine repairs, contributions, etc.).
create table if not exists public.cash_ins (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entry_date date not null default current_date,
  from_name  text not null,
  amount     numeric(14,2) not null check (amount > 0),
  reason     text,
  notes      text
);

-- Payments: money in (from sales, loan returns) or out (to suppliers, on what we owe).
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  paid_at     date not null default current_date,
  sale_id     uuid references public.sales(id) on delete cascade,
  payable_id  uuid references public.payables(id) on delete cascade,
  purchase_id uuid references public.purchases(id) on delete cascade,
  loan_id     uuid references public.personal_loans(id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  method      text not null default 'cash' check (method in ('cash','bank')),
  payer       text,
  notes       text,
  constraint one_target check (
    (case when sale_id is not null then 1 else 0 end
   + case when payable_id is not null then 1 else 0 end
   + case when purchase_id is not null then 1 else 0 end
   + case when loan_id is not null then 1 else 0 end) = 1
  )
);

-- Installment schedule for what we still owe a supplier on a purchase.
create table if not exists public.purchase_installments (
  id             uuid primary key default gen_random_uuid(),
  purchase_id    uuid not null references public.purchases(id) on delete cascade,
  installment_no int not null,
  due_date       date not null,
  amount         numeric(14,2) not null check (amount > 0),
  unique (purchase_id, installment_no)
);

-- Installment schedule for a personal loan coming back to us in parts.
create table if not exists public.loan_installments (
  id             uuid primary key default gen_random_uuid(),
  loan_id        uuid not null references public.personal_loans(id) on delete cascade,
  installment_no int not null,
  due_date       date not null,
  amount         numeric(14,2) not null check (amount > 0),
  unique (loan_id, installment_no)
);

-- Newer columns on existing installs (no-ops on a fresh database).
alter table public.sales add column if not exists reference_type text check (reference_type in ('office','salesman'));
alter table public.sales add column if not exists reference_name text;
alter table public.sales add column if not exists dealer_name text;
alter table public.expenses add column if not exists payee text;
-- Envelope system: a TOP-LEVEL expense is money given out (e.g. "30k to Rauf");
-- its CHILDREN (parent_id set) are the spends recorded inside that envelope
-- ("3k milkman"). One level deep only; deleting a card removes its spends.
alter table public.expenses add column if not exists parent_id uuid references public.expenses(id) on delete cascade;
-- Who created the row. Non-admins may only edit/delete rows they created;
-- the admin ignores ownership. Default fills it in on every insert.
alter table public.expenses add column if not exists created_by uuid default auth.uid();
alter table public.purchases add column if not exists cash_amount numeric(14,2) not null default 0 check (cash_amount >= 0);
alter table public.purchases add column if not exists bank_amount numeric(14,2) not null default 0 check (bank_amount >= 0);
alter table public.payments add column if not exists purchase_id uuid references public.purchases(id) on delete cascade;
alter table public.payments add column if not exists loan_id uuid references public.personal_loans(id) on delete cascade;
-- When the money is due back (owe entries and purchases alike) + who handed
-- a payment over — both optional, both shown in the To pay list/history.
alter table public.payables add column if not exists due_date date;
alter table public.purchases add column if not exists due_date date;
alter table public.payments add column if not exists payer text;
alter table public.payments drop constraint if exists one_target;
alter table public.payments add constraint one_target check (
  (case when sale_id is not null then 1 else 0 end
 + case when payable_id is not null then 1 else 0 end
 + case when purchase_id is not null then 1 else 0 end
 + case when loan_id is not null then 1 else 0 end) = 1
);

-- ============ INDEXES ============
create index if not exists idx_sales_date     on public.sales (sale_date desc);
create index if not exists idx_sales_customer on public.sales (lower(customer_name));
create unique index if not exists idx_salesmen_name  on public.salesmen (lower(name));
create index if not exists idx_inst_sale      on public.installments (sale_id);
create index if not exists idx_pay_sale       on public.payments (sale_id);
create index if not exists idx_pay_payable    on public.payments (payable_id);
create index if not exists idx_pay_purchase   on public.payments (purchase_id);
create index if not exists idx_pay_loan       on public.payments (loan_id);
create index if not exists idx_pinst_purchase on public.purchase_installments (purchase_id);
create index if not exists idx_linst_loan     on public.loan_installments (loan_id);
create index if not exists idx_pay_date       on public.payments (paid_at);
create index if not exists idx_payables_date  on public.payables (entry_date desc);
create index if not exists idx_loans_date     on public.personal_loans (loan_date desc);
create index if not exists idx_expenses_date  on public.expenses (entry_date desc);
create index if not exists idx_expenses_parent on public.expenses (parent_id);
create index if not exists idx_purchases_date on public.purchases (entry_date desc);
create index if not exists idx_zakat_date     on public.zakat (entry_date desc);
create index if not exists idx_cash_ins_date  on public.cash_ins (entry_date desc);

-- ============ updated_at TRIGGER ============
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sales_updated_at on public.sales;
create trigger trg_sales_updated_at
  before update on public.sales
  for each row execute function public.set_updated_at();

-- ============ USERS & ACCESS (admin adds people, gives per-flow access) ============

-- One row per person who may use the app. perms is a small JSON document:
--   {"flows": {"expenses": {"access": "write", "delete": false}, ...}}
-- access = "none" (can't even see the tab) | "read" (look, search, filter)
--        | "write" (add + edit)     delete = may remove entries in that flow
-- is_admin = the boss: sees every screen and manages the Users screen.
create table if not exists public.app_users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  name       text,
  is_admin   boolean not null default false,
  perms      jsonb not null default '{"flows":{}}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.app_users enable row level security;

-- SECURITY DEFINER helpers: they read app_users as the table owner, which is
-- what keeps policies from recursing into themselves (policy -> function ->
-- policy ...). auth.uid() is just the signed-in user's id.
create or replace function public.app_is_admin()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce((select a.is_admin from public.app_users a where a.id = auth.uid()), false);
$$;

-- The permission matrix: which flows (screens) may touch which tables.
--   tbl / need        -> the flows whose permission is checked
--   read  accepts     -> access = "read" or "write"
--   write accepts     -> access = "write"
--   delete accepts    -> access = "read"/"write" AND the flow's "delete" tick
create or replace function public.app_can(tbl text, need text)
returns boolean language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_perms jsonb;
  f text;
  v_flows text[];
begin
  if public.app_is_admin() then return true; end if;          -- admin can do everything
  select a.perms into v_perms from public.app_users a where a.id = auth.uid();
  if v_perms is null then return false; end if;               -- unknown account = no access
  v_flows := case tbl
    when 'sales'                 then (case when need = 'read' then array['sales','receivables'] else array['sales'] end)
    when 'installments'          then (case when need = 'read' then array['sales','receivables'] else array['sales'] end)
    when 'salesmen'              then array['sales']
    when 'payments'              then array['sales','receivables','payables','purchases','loans']
    when 'payables'              then array['payables']
    when 'purchases'             then (case when need = 'read' then array['purchases','payables'] else array['purchases'] end)
    when 'purchase_installments' then (case when need = 'read' then array['purchases','payables'] else array['purchases'] end)
    when 'personal_loans'        then array['loans']
    when 'loan_installments'     then array['loans']
    when 'expenses'              then array['expenses']
    when 'zakat'                 then array['zakat']
    when 'cash_ins'              then array['cashin']
    else array[]::text[]
  end;
  foreach f in array v_flows loop
    if need = 'delete' then
      -- delete = the flow's "delete" tick AND at least read access to it
      if coalesce(v_perms #>> array['flows', f, 'access'], 'none') <> 'none'
         and coalesce((v_perms #>> array['flows', f, 'delete'])::boolean, false)
      then return true; end if;
    else
      if (v_perms #>> array['flows', f, 'access']) = need then return true; end if;
      if need = 'read' and (v_perms #>> array['flows', f, 'access']) = 'write' then return true; end if;
    end if;
  end loop;
  return false;
end $$;

-- ============ ROW LEVEL SECURITY ============
-- Multi-user: logging in is Supabase Auth, and WHAT a user may do is decided
-- by the permissions the admin gave them (stored in app_users.perms, checked
-- through public.app_can() (defined in the USERS & ACCESS section above):
--   select            -> app_can('<table>', 'read')
--   insert / update   -> app_can('<table>', 'write')
--   delete            -> app_can('<table>', 'delete')   (per-flow "can delete" tick)

alter table public.sales           enable row level security;
alter table public.installments    enable row level security;
alter table public.purchase_installments enable row level security;
alter table public.loan_installments     enable row level security;
alter table public.payables        enable row level security;
alter table public.payments        enable row level security;
alter table public.salesmen        enable row level security;
alter table public.personal_loans enable row level security;
alter table public.expenses       enable row level security;
alter table public.purchases      enable row level security;
alter table public.zakat          enable row level security;
alter table public.cash_ins       enable row level security;

-- The policies below are (re)built for every table in this list — one read,
-- one insert, one update and one delete policy each. Re-running is safe:
-- every policy is dropped first.
do $$
declare t text;
begin
  foreach t in array array[
    'sales','installments','purchase_installments','loan_installments','payables',
    'payments','salesmen','personal_loans','expenses','purchases','zakat','cash_ins'
  ] loop
    execute format('drop policy if exists "auth all"    on public.%I', t);
    execute format('drop policy if exists "flow select" on public.%I', t);
    execute format('drop policy if exists "flow insert" on public.%I', t);
    execute format('drop policy if exists "flow update" on public.%I', t);
    execute format('drop policy if exists "flow delete" on public.%I', t);
    execute format('create policy "flow select" on public.%I for select  to authenticated using      (public.app_can(%L, ''read''))',  t, t);
    if t = 'expenses' then
      -- Expenses are OWNED rows: besides the flow permission, you may only
      -- insert/change/remove a row that you created yourself (admins bypass
      -- ownership). SELECT stays open — everyone with access SEES all rows,
      -- so the whole team can follow where the money went.
      execute format('create policy "flow insert" on public.expenses for insert to authenticated with check (public.app_can(''expenses'', ''write'') and (public.app_is_admin() or created_by = auth.uid()))');
      execute format('create policy "flow update" on public.expenses for update to authenticated using      (public.app_can(''expenses'', ''write'') and (public.app_is_admin() or created_by = auth.uid())) with check (public.app_can(''expenses'', ''write'') and (public.app_is_admin() or created_by = auth.uid()))');
      execute format('create policy "flow delete" on public.expenses for delete to authenticated using      (public.app_can(''expenses'', ''delete'') and (public.app_is_admin() or created_by = auth.uid()))');
    else
      execute format('create policy "flow insert" on public.%I for insert to authenticated with check (public.app_can(%L, ''write''))', t, t);
      execute format('create policy "flow update" on public.%I for update to authenticated using      (public.app_can(%L, ''write'')) with check (public.app_can(%L, ''write''))', t, t, t);
      execute format('create policy "flow delete" on public.%I for delete to authenticated using      (public.app_can(%L, ''delete''))', t, t);
    end if;
  end loop;
end $$;

-- ============ USERS & ACCESS (continued): policies, bootstrap, admin RPCs ============
-- The app_users table and the app_can / app_is_admin helpers live ABOVE the
-- row-level-security section, because the policies there call app_can() first.

-- app_users' own policies: everyone reads THEMSELVES (the app loads its own
-- permissions after login), the admin reads/edits EVERYONE.
drop policy if exists "read self or admin" on public.app_users;
drop policy if exists "admin insert"       on public.app_users;
drop policy if exists "admin update"       on public.app_users;
drop policy if exists "admin delete"       on public.app_users;
create policy "read self or admin" on public.app_users for select to authenticated
  using (id = auth.uid() or public.app_is_admin());
create policy "admin insert" on public.app_users for insert to authenticated
  with check (public.app_is_admin());
create policy "admin update" on public.app_users for update to authenticated
  using (public.app_is_admin()) with check (public.app_is_admin());
create policy "admin delete" on public.app_users for delete to authenticated
  using (public.app_is_admin());

-- Anyone who could already sign in before this feature existed keeps full
-- access (they were the single user until now). Runs only while app_users is
-- empty, so later accounts are never promoted by re-running this file.
do $$
begin
  if not exists (select 1 from public.app_users) then
    insert into public.app_users (id, email, is_admin)
    select u.id, u.email, true from auth.users u;
  end if;
end $$;

-- Existing expenses predate the ownership column: attribute them to the admin
-- (or, on a setup with no admin row yet, to the earliest login), then make
-- created_by mandatory. Guarded so a database with zero users can still run
-- this file; a later re-run finishes the job once people exist.
update public.expenses e
   set created_by = coalesce(
         (select a.id from public.app_users a where a.is_admin order by a.created_at limit 1),
         (select u.id from auth.users u order by u.created_at limit 1))
 where e.created_by is null;
do $$
begin
  if not exists (select 1 from public.expenses where created_by is null) then
    alter table public.expenses alter column created_by set not null;
  end if;
end $$;

-- Every new Supabase Auth user automatically gets an app_users row:
-- the very first one becomes the admin, everyone after starts with no access
-- until the admin grants it in the app.
create or replace function public.handle_new_app_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_users (id, email, is_admin)
  values (new.id, lower(new.email), not exists (select 1 from public.app_users))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_app_user();

-- ---- admin helper functions (called from the app with sb.rpc(...)) ----

-- Every user + every login, for the admin's Users screen.
create or replace function public.admin_list_users()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare v jsonb;
begin
  if not public.app_is_admin() then raise exception 'Admins only.'; end if;
  with rows as (
    select a.id, a.email, a.name, a.is_admin, a.perms, a.created_at
      from public.app_users a
    union all
    -- logins created straight in the Supabase dashboard that have no access row yet
    select u.id, u.email, null, false, null, u.created_at
      from auth.users u where not exists (select 1 from public.app_users a where a.id = u.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'email', r.email, 'name', r.name,
           'is_admin', r.is_admin, 'perms', r.perms) order by r.created_at), '[]'::jsonb)
    into v from rows r;
  return v;
end $$;

-- Add a person: creates the Supabase Auth login (email + password, confirmed
-- straight away) and applies the permissions chosen in the Users screen.
create or replace function public.admin_add_user(p_email text, p_password text, p_name text default null, p_perms jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_uid uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.app_is_admin() then raise exception 'Admins only.'; end if;
  if position('@' in v_email) = 0 then raise exception 'Enter a valid email address.'; end if;
  if coalesce(p_password, '') = '' or length(p_password) < 6 then raise exception 'Password must be at least 6 characters.'; end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'That email already has a login - use Add with password left blank instead.';
  end if;
  v_uid := gen_random_uuid();
  -- same columns GoTrue writes on a normal sign-up; email_confirmed_at makes
  -- the password usable immediately (no confirmation email needed).
  -- The token columns MUST be '' and not NULL: GoTrue scans them into plain
  -- Go strings, so a NULL makes every sign-in for that user fail with
  -- 500 "Database error querying schema".
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          confirmation_token, recovery_token,
                          email_change_token_new, email_change_token_current, email_change,
                          created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
          v_email, crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('name', coalesce(p_name, '')),
          '', '', '', '', '', now(), now());
  -- and the identity row GoTrue would create (its timestamps must not be
  -- NULL either - the eager-loaded scan fails on them the same way)
  insert into auth.identities (id, provider_id, user_id, provider, identity_data,
                               last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid::text, v_uid, 'email',
          jsonb_build_object('sub', v_uid::text, 'email', v_email,
                             'email_verified', true, 'phone_verified', false),
          now(), now(), now());
  -- the trigger above created the app_users row; now give it the chosen name/permissions
  update public.app_users
     set name = coalesce(p_name, name), perms = coalesce(p_perms, perms)
   where id = v_uid;
  return (select jsonb_build_object('id', a.id, 'email', a.email) from public.app_users a where a.id = v_uid);
end $$;

-- Give access to a login that already exists (created in the Supabase dashboard).
create or replace function public.admin_grant_user(p_email text, p_name text default null, p_perms jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.app_is_admin() then raise exception 'Admins only.'; end if;
  select u.id into v_uid from auth.users u where lower(u.email) = v_email;
  if v_uid is null then
    raise exception 'No login exists for that email - create it in the Supabase dashboard (Authentication -> Users -> Add user, tick Auto Confirm), then add it here again.';
  end if;
  insert into public.app_users (id, email, name, is_admin, perms)
  values (v_uid, v_email, coalesce(p_name, null), false, coalesce(p_perms, '{"flows":{}}'::jsonb))
  on conflict (id) do update
    set name = coalesce(excluded.name, public.app_users.name),
        perms = coalesce(excluded.perms, public.app_users.perms),
        email = excluded.email;
  return (select jsonb_build_object('id', a.id, 'email', a.email) from public.app_users a where a.id = v_uid);
end $$;

-- Remove a person completely (kills the login too). Not for yourself.
create or replace function public.admin_delete_user(p_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.app_is_admin() then raise exception 'Admins only.'; end if;
  if p_id = auth.uid() then raise exception 'You cannot remove your own account.'; end if;
  delete from auth.users where id = p_id;   -- app_users follows via on delete cascade
  if not found then delete from public.app_users where id = p_id; end if;
end $$;

grant execute on function public.app_is_admin()                    to authenticated;
grant execute on function public.app_can(text, text)               to authenticated;
grant execute on function public.admin_list_users()                to authenticated;
grant execute on function public.admin_add_user(text, text, text, jsonb) to authenticated;
grant execute on function public.admin_grant_user(text, text, jsonb)     to authenticated;
grant execute on function public.admin_delete_user(uuid)           to authenticated;

-- ============ SEED: SALESMEN ============
-- Safe to re-run (skips names that already exist).
insert into public.salesmen (name) values ('Yasir'), ('Fazal'), ('Usman')
on conflict do nothing;

-- ============ LOGIN USER ============
-- No credentials are stored in this file (security).
-- After running this script, create the login user manually:
--   Supabase Dashboard -> Authentication -> Users -> Add user
--   - email + password of your choice
--   - tick "Auto Confirm"
-- Never commit passwords to this repository.
