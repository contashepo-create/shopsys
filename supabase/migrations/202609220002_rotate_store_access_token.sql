-- Safe RLS credential rotation with a 24-hour overlap for other devices.
alter table public.stores add column if not exists previous_access_token_hash text;
alter table public.stores add column if not exists previous_token_expires_at timestamptz;

create or replace function public.store_token_is_valid(
  current_hash text,
  previous_hash text,
  previous_expires_at timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_hash = public.request_store_token_hash()
    or (
      previous_hash = public.request_store_token_hash()
      and previous_expires_at is not null
      and previous_expires_at > pg_catalog.now()
    )
$$;

revoke all on function public.store_token_is_valid(text, text, timestamptz) from public;
grant execute on function public.store_token_is_valid(text, text, timestamptz) to anon, authenticated;

-- Replace policies so the previous credential remains valid only during the overlap.
drop policy if exists "stores_tenant_select" on public.stores;
drop policy if exists "stores_tenant_update" on public.stores;

create policy "stores_tenant_select"
on public.stores for select
to anon, authenticated
using (
  public.store_token_is_valid(access_token_hash, previous_access_token_hash, previous_token_expires_at)
  or (
    access_token_hash is null
    and store_id = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-store-id', '')
    and length(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-store-access-token', '')) = 43
  )
);

create policy "stores_tenant_update"
on public.stores for update
to anon, authenticated
using (
  public.store_token_is_valid(access_token_hash, previous_access_token_hash, previous_token_expires_at)
  or (
    access_token_hash is null
    and store_id = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-store-id', '')
    and length(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-store-access-token', '')) = 43
  )
)
with check (
  store_id = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-store-id', '')
  and public.store_token_is_valid(access_token_hash, previous_access_token_hash, previous_token_expires_at)
);

-- Rotation must be atomic. The current token authorizes it; the new token arrives in a
-- separate header and only its SHA-256 hash is persisted.
create or replace function public.rotate_store_access_token(p_store_id text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  headers jsonb := pg_catalog.current_setting('request.headers', true)::jsonb;
  old_token text := pg_catalog.coalesce(headers ->> 'x-store-access-token', '');
  new_token text := pg_catalog.coalesce(headers ->> 'x-new-store-access-token', '');
  old_hash text;
  new_hash text;
  overlap_until timestamptz := pg_catalog.now() + interval '24 hours';
begin
  if length(old_token) <> 43 or length(new_token) <> 43 or old_token = new_token then
    raise exception 'invalid rotation credentials' using errcode = '22023';
  end if;
  old_hash := pg_catalog.encode(extensions.digest(old_token, 'sha256'), 'hex');
  new_hash := pg_catalog.encode(extensions.digest(new_token, 'sha256'), 'hex');

  update public.stores
     set previous_access_token_hash = access_token_hash,
         previous_token_expires_at = overlap_until,
         access_token_hash = new_hash
   where store_id = p_store_id
     and access_token_hash = old_hash;

  if not found then
    raise exception 'store not found or current credential rejected' using errcode = '42501';
  end if;
  return overlap_until;
end
$$;

revoke all on function public.rotate_store_access_token(text) from public;
grant execute on function public.rotate_store_access_token(text) to anon, authenticated;
