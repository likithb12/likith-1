-- Personal Net Worth Tracker — initial schema
--
-- Every table carries user_id and has RLS enabled with a policy of
-- user_id = auth.uid() for SELECT/INSERT/UPDATE/DELETE. No exceptions.
-- The policy creation at the bottom of this file is driven off a table list
-- so that "no exceptions" is enforced mechanically rather than by review.
--
-- All monetary amounts are numeric(18,2). Never float.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type account_class as enum ('asset', 'liability');

create type account_type as enum (
  'cash', 'savings', 'offset', 'super', 'brokerage', 'loan', 'credit_card', 'other'
);

create type snapshot_source as enum ('manual', 'derived_holdings', 'csv');

create type price_source as enum ('api', 'manual');

create type category_kind as enum ('expense', 'income');

create type txn_direction as enum ('debit', 'credit');

create type txn_source as enum ('manual', 'csv');

create type obligation_direction as enum ('payable', 'receivable');

create type obligation_status as enum ('open', 'partial', 'settled', 'written_off');

create type recurrence_kind as enum (
  'none', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'annual'
);

create type income_frequency as enum (
  'weekly', 'fortnightly', 'monthly', 'quarterly', 'annual', 'irregular'
);

create type match_type as enum ('contains', 'starts_with', 'regex');

create type amount_convention as enum ('single_signed', 'separate_debit_credit');

-- ---------------------------------------------------------------------------
-- Core
-- ---------------------------------------------------------------------------

create table profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  display_name       text,
  base_currency      text not null default 'AUD' check (base_currency ~ '^[A-Z]{3}$'),
  secondary_currency text check (secondary_currency ~ '^[A-Z]{3}$'),
  created_at         timestamptz not null default now()
);

create table accounts (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  name                 text not null check (length(trim(name)) > 0),
  institution          text,
  class                account_class not null,
  type                 account_type not null,
  currency             text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  is_active            boolean not null default true,
  include_in_net_worth boolean not null default true,
  display_order        integer not null default 0,
  created_at           timestamptz not null default now()
);

create index accounts_user_idx on accounts (user_id, display_order, name);

-- ---------------------------------------------------------------------------
-- History. Balances are never overwritten in place — current balance is
-- derived as the most recent snapshot.
-- ---------------------------------------------------------------------------

create table balance_snapshots (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references accounts (id) on delete cascade,
  as_at      date not null,
  balance    numeric(18, 2) not null,
  currency   text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  source     snapshot_source not null default 'manual',
  note       text,
  created_at timestamptz not null default now(),
  unique (account_id, as_at)
);

create index balance_snapshots_lookup_idx on balance_snapshots (user_id, account_id, as_at desc);

-- Materialised for fast charting. Recomputed by the application through a
-- single idempotent upsert path; the unique constraint makes re-running a
-- date range free of duplicates.
create table net_worth_snapshots (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  as_at                  date not null,
  total_assets_base      numeric(18, 2) not null default 0,
  total_liabilities_base numeric(18, 2) not null default 0,
  net_worth_base         numeric(18, 2) not null default 0,
  base_currency          text not null default 'AUD' check (base_currency ~ '^[A-Z]{3}$'),
  computed_at            timestamptz not null default now(),
  unique (user_id, as_at)
);

create index net_worth_snapshots_lookup_idx on net_worth_snapshots (user_id, as_at);

-- ---------------------------------------------------------------------------
-- Investments
-- ---------------------------------------------------------------------------

create table holdings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  account_id        uuid not null references accounts (id) on delete cascade,
  ticker            text not null check (length(trim(ticker)) > 0),
  exchange          text,
  units             numeric(18, 6) not null default 0,
  avg_cost_per_unit numeric(18, 6),
  currency          text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  created_at        timestamptz not null default now(),
  unique (account_id, ticker)
);

create index holdings_user_idx on holdings (user_id, account_id);

-- The spec's unique (ticker, as_at) is global; with per-user rows that would
-- let one user's price block another user's insert. Scoped to the user.
create table price_points (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  ticker     text not null check (length(trim(ticker)) > 0),
  exchange   text,
  as_at      date not null,
  price      numeric(18, 6) not null,
  currency   text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  source     price_source not null default 'manual',
  created_at timestamptz not null default now(),
  unique (user_id, ticker, as_at)
);

create index price_points_lookup_idx on price_points (user_id, ticker, as_at desc);

-- ---------------------------------------------------------------------------
-- FX. Same per-user scoping rationale as price_points.
-- ---------------------------------------------------------------------------

create table fx_rates (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  base_currency  text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  as_at          date not null,
  rate           numeric(18, 8) not null check (rate > 0),
  source         text not null default 'manual',
  created_at     timestamptz not null default now(),
  unique (user_id, base_currency, quote_currency, as_at),
  check (base_currency <> quote_currency)
);

create index fx_rates_lookup_idx on fx_rates (user_id, base_currency, quote_currency, as_at desc);

-- ---------------------------------------------------------------------------
-- Cashflow
-- ---------------------------------------------------------------------------

create table categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  parent_id  uuid references categories (id) on delete set null,
  kind       category_kind not null default 'expense',
  colour     text,
  created_at timestamptz not null default now()
);

create index categories_user_idx on categories (user_id, kind, name);

create table csv_import_profiles (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  name                text not null,
  date_column         text not null,
  date_format         text not null default 'DD/MM/YYYY',
  amount_column       text,
  amount_convention   amount_convention not null default 'single_signed',
  debit_column        text,
  credit_column       text,
  description_columns text[] not null default '{}',
  skip_rows           integer not null default 0 check (skip_rows >= 0),
  delimiter           text not null default ',',
  encoding            text not null default 'utf-8',
  default_account_id  uuid references accounts (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index csv_import_profiles_user_idx on csv_import_profiles (user_id, name);

create table import_batches (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  account_id             uuid references accounts (id) on delete set null,
  profile_id             uuid references csv_import_profiles (id) on delete set null,
  filename               text not null,
  imported_at            timestamptz not null default now(),
  rows_total             integer not null default 0,
  rows_imported          integer not null default 0,
  rows_skipped_duplicate integer not null default 0,
  rows_failed            integer not null default 0
);

create index import_batches_user_idx on import_batches (user_id, imported_at desc);

create table transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  account_id       uuid references accounts (id) on delete set null,
  txn_date         date not null,
  -- Positive magnitude; sign is carried by `direction`.
  amount           numeric(18, 2) not null check (amount >= 0),
  direction        txn_direction not null,
  currency         text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  description_raw  text,
  description      text,
  category_id      uuid references categories (id) on delete set null,
  is_transfer      boolean not null default false,
  transfer_pair_id uuid references transactions (id) on delete set null,
  source           txn_source not null default 'manual',
  import_batch_id  uuid references import_batches (id) on delete set null,
  dedupe_hash      text not null,
  created_at       timestamptz not null default now(),
  unique (user_id, dedupe_hash)
);

create index transactions_user_date_idx on transactions (user_id, txn_date desc);
create index transactions_category_idx on transactions (user_id, category_id);
create index transactions_batch_idx on transactions (import_batch_id);
create index transactions_account_idx on transactions (user_id, account_id, txn_date desc);

create table budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  category_id  uuid not null references categories (id) on delete cascade,
  period_month date not null check (extract(day from period_month) = 1),
  amount       numeric(18, 2) not null check (amount >= 0),
  currency     text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  created_at   timestamptz not null default now(),
  unique (user_id, category_id, period_month)
);

create index budgets_user_period_idx on budgets (user_id, period_month);

create table categorisation_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  match_type  match_type not null default 'contains',
  pattern     text not null check (length(trim(pattern)) > 0),
  category_id uuid not null references categories (id) on delete cascade,
  priority    integer not null default 100,
  created_at  timestamptz not null default now()
);

create index categorisation_rules_user_idx on categorisation_rules (user_id, priority);

-- ---------------------------------------------------------------------------
-- Obligations — both directions
-- ---------------------------------------------------------------------------

create table obligations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  direction         obligation_direction not null,
  counterparty      text not null check (length(trim(counterparty)) > 0),
  description       text,
  amount_total      numeric(18, 2) not null check (amount_total >= 0),
  currency          text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  amount_settled    numeric(18, 2) not null default 0 check (amount_settled >= 0),
  due_date          date,
  status            obligation_status not null default 'open',
  linked_account_id uuid references accounts (id) on delete set null,
  recurrence        recurrence_kind not null default 'none',
  notes             text,
  created_at        timestamptz not null default now()
);

create index obligations_user_idx on obligations (user_id, status, due_date);

create table obligation_payments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  obligation_id  uuid not null references obligations (id) on delete cascade,
  paid_on        date not null,
  amount         numeric(18, 2) not null check (amount > 0),
  currency       text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  transaction_id uuid references transactions (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index obligation_payments_idx on obligation_payments (user_id, obligation_id, paid_on);

-- ---------------------------------------------------------------------------
-- Income
-- ---------------------------------------------------------------------------

create table income_sources (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  name               text not null check (length(trim(name)) > 0),
  employer           text,
  gross_amount       numeric(18, 2),
  currency           text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  frequency          income_frequency not null default 'monthly',
  next_expected_date date,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

create index income_sources_user_idx on income_sources (user_id, is_active);

create table income_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  income_source_id uuid references income_sources (id) on delete set null,
  received_on      date not null,
  gross_amount     numeric(18, 2),
  net_amount       numeric(18, 2) not null,
  currency         text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  account_id       uuid references accounts (id) on delete set null,
  transaction_id   uuid references transactions (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index income_events_user_idx on income_events (user_id, received_on desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Driven off a table list so that adding a table without a policy is a
-- deliberate act rather than an oversight. Four separate policies per table
-- rather than FOR ALL, so each command is visible in pg_policies.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'accounts', 'balance_snapshots', 'net_worth_snapshots',
    'holdings', 'price_points', 'fx_rates', 'categories', 'transactions',
    'budgets', 'categorisation_rules', 'csv_import_profiles', 'import_batches',
    'obligations', 'obligation_payments', 'income_sources', 'income_events'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    -- Deny access even to the table owner unless a policy matches.
    execute format('alter table public.%I force row level security', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
      t || '_delete_own', t);
  end loop;
end $$;

-- Supabase grants these by default, but stating them here keeps the migration
-- self-contained. `anon` is deliberately granted nothing: an unauthenticated
-- caller has no reason to touch any of these tables, and RLS is the boundary
-- for everyone else.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Fail the migration if any public table escaped the loop above.
do $$
declare
  missing text;
begin
  select string_agg(c.relname, ', ')
    into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if missing is not null then
    raise exception 'Tables without RLS enabled: %', missing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Profile bootstrap. Without this a new user has no profile row and the app
-- cannot read their base currency.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
