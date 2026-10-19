-- Run once in the Supabase SQL Editor. No billing or extensions required.
create table if not exists public.nf_documents (
  owner_id uuid not null references auth.users(id) on delete cascade,
  path text not null check (length(path) between 1 and 500),
  revision integer not null check (revision > 0),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, path),
  check (octet_length(data::text) <= 900000)
);
alter table public.nf_documents enable row level security;
revoke all on public.nf_documents from anon, authenticated;
-- Only the trusted Worker may access documents. Browsers call its validated API.
grant all on public.nf_documents to service_role;

create table if not exists public.nf_storage_reservations (
  path text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  bytes bigint not null check (bytes between 1 and 8388608),
  created_at timestamptz not null default now()
);
alter table public.nf_storage_reservations enable row level security;
revoke all on public.nf_storage_reservations from anon, authenticated;
grant all on public.nf_storage_reservations to service_role;

-- Every batch locks in a fixed order and commits all revisions/audits together.
-- Locking also serializes global free-tier quota reservations.
create or replace function public.nf_commit(p_owner uuid, p_operations jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare op jsonb; old_rev int; next_rev int; doc_path text; payload jsonb;
        total_bytes bigint; old_size bigint; new_size bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(728410001);
  if jsonb_array_length(p_operations) not between 1 and 30 then
    raise exception 'INVALID_BATCH';
  end if;
  select coalesce(sum(octet_length(data::text) + 256),0) into total_bytes from public.nf_documents;
  for op in select value from jsonb_array_elements(p_operations) loop
    doc_path := op->>'path';
    if doc_path is null or length(doc_path) > 500 or doc_path !~ '^[A-Za-z0-9_/-]+$' then raise exception 'INVALID_PATH'; end if;
    select revision, octet_length(data::text) + 256 into old_rev, old_size
      from public.nf_documents where owner_id=p_owner and path=doc_path for update;
    if coalesce(old_rev,0) <> (op->>'expected')::int or op->>'expected' is null then
      raise exception 'REVISION_CONFLICT' using errcode='40001';
    end if;
    if coalesce((op->>'guard')::boolean,false) then continue; end if;
    payload := op->'data';
    next_rev := coalesce(old_rev,0)+1;
    if payload is null or jsonb_typeof(payload) <> 'object' or
       payload->>'ownerUid' is distinct from p_owner::text then raise exception 'INVALID_OWNER'; end if;
    payload := payload || jsonb_build_object('revision',next_rev);
    new_size := octet_length(payload::text) + 256;
    if new_size > 850000 then raise exception 'DOCUMENT_TOO_LARGE'; end if;
    total_bytes := total_bytes - coalesce(old_size,0) + new_size;
    -- Leave headroom under the Free database allowance for indexes/auth/system tables.
    if total_bytes > 100000000 then raise exception 'FREE_STORAGE_LIMIT'; end if;
    insert into public.nf_documents(owner_id,path,revision,data) values(p_owner,doc_path,next_rev,payload)
    on conflict(owner_id,path) do update set revision=excluded.revision,data=excluded.data,updated_at=now();
  end loop;
end $$;
revoke all on function public.nf_commit(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.nf_commit(uuid,jsonb) to service_role;

create or replace function public.nf_reserve_storage(p_owner uuid,p_path text,p_bytes bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare used_bytes bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(728410002);
  if p_path not like 'users/' || p_owner::text || '/%' then raise exception 'INVALID_OWNER'; end if;
  select coalesce(sum(bytes),0) into used_bytes from public.nf_storage_reservations;
  if used_bytes+p_bytes > 600000000 then raise exception 'FREE_STORAGE_LIMIT'; end if;
  insert into public.nf_storage_reservations(path,owner_id,bytes) values(p_path,p_owner,p_bytes);
end $$;
revoke all on function public.nf_reserve_storage(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.nf_reserve_storage(uuid,text,bigint) to service_role;

insert into storage.buckets(id,name,public,file_size_limit)
values('novelforge','novelforge',false,8388608)
on conflict(id) do nothing;
-- No browser Storage policies. Download/export goes through the authenticated Worker.
