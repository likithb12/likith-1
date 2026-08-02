-- Minimal local stand-in for the parts of Supabase the migrations depend on.
-- Used only by `supabase/tests/run_tests.sh` so the schema and its RLS
-- policies can be verified against a real Postgres without a cloud project.
-- This file is NEVER applied to a Supabase project — it recreates objects
-- Supabase already provides.

create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Faithful to Supabase: the user id comes from the request's JWT claims,
-- which PostgREST sets as a GUC per request.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  -- nullif before the cast: an unset GUC reads back as '' in some contexts,
  -- and ''::json throws rather than yielding null.
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema auth to authenticated, anon;
grant select on auth.users to authenticated;
