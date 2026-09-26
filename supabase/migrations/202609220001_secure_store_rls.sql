-- TAHAKAM cloud sync tenant isolation (Phase 0 / batch 0.4)
-- Run with Supabase migrations, never paste an allow-all policy from the UI.
create extension if not exists pgcrypto;

create table if not exists public.stores (
  store_id text primary key,
  rev bigint not null default 0 check (rev >= 0),
  device_id text not null default '',
  updated_at timestamptz not null default now(),
  checksum text not null default '',
  data text not null default '',
  access_token_hash text
);

alter table public.stores add column if not exists access_token_hash text;
alter table public.stores enable row level security;
alter table public.stores force row level security;

-- Remove every known historical permissive policy.
drop policy if exists "stores anon access" on public.stores;
drop policy if exists "stores_tenant_select" on public.stores;
drop policy if exists "stores_tenant_insert" on public.stores;
drop policy if exists "stores_tenant_update" on public.stores;
drop policy if exists "stores_tenant_delete" on public.stores;

-- The access token is a random 256-bit base64url value, separate from the AES secret.
-- request.headers is supplied by PostgREST. Only its SHA-256 hash is persisted.
create or replace function public.request_store_token_hash()
returns text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.coalesce((pg_catalog.current_setting('request.headers', true)::jsonb ->> 'x-store-access-token'), ''),
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function public.request_store_token_hash() from public;
grant execute on function public.request_store_token_hash() to anon, authenticated;

grant select, insert, update on table public.stores to anon, authenticated;
revoke delete on table public.stores from anon, authenticated;

create policy "stores_tenant_select"
on public.stores for select
to anon, authenticated
using (
  access_token_hash = public.request_store_token_hash()
  -- One-time migration claim for rows created by the former allow-all policy.
  or (
    access_token_hash is null
    and store_id = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-store-id', '')
    and length(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-store-access-token', '')) = 43
  )
);

create policy "stores_tenant_insert"
on public.stores for insert
to anon, authenticated
with check (
  store_id = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-store-id', '')
  and length(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-store-access-token', '')) = 43
  and access_token_hash = public.request_store_token_hash()
);

create policy "stores_tenant_update"
on public.stores for update
to anon, authenticated
using (
  access_token_hash = public.request_store_token_hash()
  or (
    access_token_hash is null
    and store_id = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-store-id', '')
    and length(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-store-access-token', '')) = 43
  )
)
with check (
  store_id = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-store-id', '')
  and access_token_hash = public.request_store_token_hash()
);

comment on column public.stores.access_token_hash is
  'SHA-256 of a random per-store access token; never the AES encryption secret';
