-- RLS isolation tests.
--
-- Requirement: at minimum, prove user A cannot read user B's rows. This goes
-- further and checks all four commands, the WITH CHECK path that stops a user
-- forging someone else's user_id, and that every table is actually covered.
--
-- Run with supabase/tests/run_tests.sh.

\set ON_ERROR_STOP on
\set QUIET on

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Assertion helper
-- ---------------------------------------------------------------------------

create or replace function test_assert(condition boolean, description text)
returns void
language plpgsql
as $$
begin
  if condition then
    raise notice '  ok   %', description;
  else
    raise exception 'FAILED: %', description;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures: two users, each with a full row in several tables.
-- Seeded as superuser, which bypasses RLS.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test');

insert into accounts (id, user_id, name, class, type) values
  ('a0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'A Savings', 'asset', 'savings'),
  ('b0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000002', 'B Savings', 'asset', 'savings');

insert into balance_snapshots (user_id, account_id, as_at, balance) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', '2026-06-30', 1000.00),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', '2026-06-30', 999999.00);

insert into transactions (user_id, txn_date, amount, direction, dedupe_hash) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '2026-06-01', 10.00, 'debit', 'hash-a'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '2026-06-01', 20.00, 'debit', 'hash-b');

insert into obligations (user_id, direction, counterparty, amount_total) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'payable', 'A ATO', 500.00),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'payable', 'B ATO', 600.00);

insert into profiles (user_id, display_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'B')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Coverage: no table may escape RLS
-- ---------------------------------------------------------------------------

\echo 'RLS coverage'

do $$
declare
  offenders text;
begin
  select string_agg(c.relname, ', ')
    into offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  perform test_assert(offenders is null, 'every public table has RLS enabled');
end $$;

do $$
declare
  offenders text;
begin
  -- Each table needs a policy for all four commands.
  select string_agg(t.relname || ' (' || t.cmds || ')', ', ')
    into offenders
  from (
    select c.relname, string_agg(distinct p.cmd::text, ',') as cmds, count(distinct p.cmd) as n
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    left join pg_policies p on p.tablename = c.relname and p.schemaname = 'public'
    where ns.nspname = 'public' and c.relkind = 'r'
    group by c.relname
  ) t
  where t.n < 4;

  perform test_assert(offenders is null, 'every public table has SELECT/INSERT/UPDATE/DELETE policies');
end $$;

-- ---------------------------------------------------------------------------
-- Reads: user A must not see user B's rows
-- ---------------------------------------------------------------------------

\echo 'Isolation — reads'

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

do $$
begin
  perform test_assert((select count(*) from accounts) = 1, 'A sees exactly one account');
  perform test_assert(
    (select count(*) from accounts where user_id <> auth.uid()) = 0,
    'A cannot read B''s accounts');
  perform test_assert(
    (select count(*) from balance_snapshots where balance > 1000) = 0,
    'A cannot read B''s balance snapshots');
  perform test_assert(
    (select count(*) from transactions where dedupe_hash = 'hash-b') = 0,
    'A cannot read B''s transactions');
  perform test_assert(
    (select count(*) from obligations where counterparty = 'B ATO') = 0,
    'A cannot read B''s obligations');
  perform test_assert(
    (select count(*) from profiles where display_name = 'B') = 0,
    'A cannot read B''s profile');
end $$;
commit;

-- ---------------------------------------------------------------------------
-- Writes: user A must not create, alter or destroy user B's rows
-- ---------------------------------------------------------------------------

\echo 'Isolation — writes'

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

do $$
declare
  blocked boolean := false;
begin
  -- Forging a row owned by B must fail the WITH CHECK clause.
  begin
    insert into accounts (user_id, name, class, type)
    values ('bbbbbbbb-0000-0000-0000-000000000002', 'Sneaky', 'asset', 'cash');
  exception when insufficient_privilege then
    blocked := true;
  end;
  perform test_assert(blocked, 'A cannot insert a row owned by B');
end $$;

do $$
declare
  affected integer;
begin
  update accounts set name = 'Hijacked'
  where id = 'b0000000-0000-0000-0000-0000000000b1';
  get diagnostics affected = row_count;
  perform test_assert(affected = 0, 'A cannot update B''s account');

  delete from accounts where id = 'b0000000-0000-0000-0000-0000000000b1';
  get diagnostics affected = row_count;
  perform test_assert(affected = 0, 'A cannot delete B''s account');

  delete from transactions where dedupe_hash = 'hash-b';
  get diagnostics affected = row_count;
  perform test_assert(affected = 0, 'A cannot delete B''s transactions');
end $$;

do $$
declare
  affected integer;
begin
  -- A can still operate on their own rows.
  update accounts set name = 'A Savings Renamed'
  where id = 'a0000000-0000-0000-0000-0000000000a1';
  get diagnostics affected = row_count;
  perform test_assert(affected = 1, 'A can update their own account');
end $$;
rollback;

-- B's row must be untouched after all that.
do $$
begin
  perform test_assert(
    (select name from accounts where id = 'b0000000-0000-0000-0000-0000000000b1') = 'B Savings',
    'B''s account survived A''s attempts');
end $$;

-- ---------------------------------------------------------------------------
-- Anonymous callers get nothing
-- ---------------------------------------------------------------------------

\echo 'Isolation — anonymous'

begin;
set local role anon;

do $$
declare
  blocked boolean := false;
begin
  begin
    perform count(*) from accounts;
  exception when insufficient_privilege then
    blocked := true;
  end;
  perform test_assert(blocked, 'anon has no privileges on accounts');
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- A user with no JWT sees nothing even with the authenticated role
-- ---------------------------------------------------------------------------

begin;
set local role authenticated;

do $$
begin
  perform test_assert((select count(*) from accounts) = 0, 'no JWT means no rows');
end $$;
rollback;

\echo 'All RLS tests passed.'
