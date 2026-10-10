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
  source         text not null check (source in ('office','dealer','salesman')),
  salesman_name  text,
  item_description text,
  total_amount   numeric(14,2) not null check (total_amount >= 0),
  cash_amount    numeric(14,2) not null default 0 check (cash_amount >= 0),
  bank_amount    numeric(14,2) not null default 0 check (bank_amount >= 0),
  loan_amount    numeric(14,2) not null default 0 check (loan_amount >= 0),
  is_installment boolean not null default false,
  notes          text,
  constraint paid_within_total check (cash_amount + bank_amount + loan_amount <= total_amount + 0.009)
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
  notes       text
);

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  paid_at     date not null default current_date,
  sale_id     uuid references public.sales(id) on delete cascade,
  payable_id  uuid references public.payables(id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  method      text not null default 'cash' check (method in ('cash','bank')),
  notes       text,
  constraint one_target check (
    (case when sale_id is not null then 1 else 0 end
   + case when payable_id is not null then 1 else 0 end) = 1
  )
);

create table if not exists public.ledger_entries (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  entry_date  date not null default current_date,
  particulars text not null,
  debit       numeric(14,2) not null default 0 check (debit >= 0),
  credit      numeric(14,2) not null default 0 check (credit >= 0),
  notes       text,
  constraint debit_or_credit check (debit > 0 or credit > 0)
);

-- ============ INDEXES ============
create index if not exists idx_sales_date     on public.sales (sale_date desc);
create index if not exists idx_sales_customer on public.sales (lower(customer_name));
create index if not exists idx_inst_sale      on public.installments (sale_id);
create index if not exists idx_pay_sale       on public.payments (sale_id);
create index if not exists idx_pay_payable    on public.payments (payable_id);
create index if not exists idx_pay_date       on public.payments (paid_at);
create index if not exists idx_payables_date  on public.payables (entry_date desc);
create index if not exists idx_ledger_date    on public.ledger_entries (entry_date desc);

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

-- ============ ROW LEVEL SECURITY ============
-- App is single-user: only the logged-in account can read/write anything.

alter table public.sales           enable row level security;
alter table public.installments    enable row level security;
alter table public.payables        enable row level security;
alter table public.payments        enable row level security;
alter table public.ledger_entries  enable row level security;

drop policy if exists "auth all" on public.sales;
drop policy if exists "auth all" on public.installments;
drop policy if exists "auth all" on public.payables;
drop policy if exists "auth all" on public.payments;
drop policy if exists "auth all" on public.ledger_entries;

create policy "auth all" on public.sales          for all to authenticated using (true) with check (true);
create policy "auth all" on public.installments   for all to authenticated using (true) with check (true);
create policy "auth all" on public.payables       for all to authenticated using (true) with check (true);
create policy "auth all" on public.payments       for all to authenticated using (true) with check (true);
create policy "auth all" on public.ledger_entries for all to authenticated using (true) with check (true);

-- ============ LOGIN USER ============
-- No credentials are stored in this file (security).
-- After running this script, create the login user manually:
--   Supabase Dashboard -> Authentication -> Users -> Add user
--   - email + password of your choice
--   - tick "Auto Confirm"
-- Never commit passwords to this repository.
